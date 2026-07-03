import { homedir } from "node:os";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { EXTENSION_DISPLAY_NAME, EXTENSION_STATUS_KEY } from "../constants.ts";
import {
  loadProtectMeConfig,
  normalizeConfigAllowList,
  normalizeConfigAllowListEntry,
  type ParsedProtectMeConfig,
  type ProtectMeConfigFile,
  type ProtectMeConfigLoadResult,
  type ProtectMeConfigPathInput,
  type ProtectMeConfigSourceMetadata,
  writeGlobalProtectMeConfig,
  writeProjectProtectMeConfig,
} from "../config/index.ts";
import {
  appendBlockedAttemptLog,
  type AppendBlockedAttemptLogInput,
  type BlockedAttemptLogEntry,
  type BlockedAttemptLogOutcome,
} from "../logging/blocked-attempt-log.ts";
import {
  buildProtectMeBlockReason,
  buildProtectMeConfigWriteFailedBlockReason,
  buildProtectMeFirstBlockGuidance,
  buildProtectMePromptDeniedBlockReason,
  buildProtectMePromptUnavailableBlockReason,
  extractToolCallNetworkRequestCandidates,
  matchAllowedHost,
  suggestCleanAllowListEntry,
  type BashNetworkRequestCandidate,
} from "../policy/index.ts";

export const PROTECTME_SECOND_ATTEMPT_CHOICES = {
  allowOnce: "Allow once",
  addProject: "Add to project config and allow this call",
  addGlobal: "Add to global config and allow this call",
  keepBlocked: "Keep blocked",
} as const;

const PROTECTME_SECOND_ATTEMPT_CHOICE_VALUES = Object.values(PROTECTME_SECOND_ATTEMPT_CHOICES);

export interface NetworkGuardState {
  blockedHostAttempts: Map<string, number>;
}

export interface NetworkGuardGuidanceOptions {
  deliverAs?: "followUp" | "steer";
}

export interface NetworkGuardDependencies {
  getHomeDir(): string;
  loadConfig(input: ProtectMeConfigPathInput): Promise<ProtectMeConfigLoadResult>;
  appendBlockedAttemptLog(input: AppendBlockedAttemptLogInput): Promise<BlockedAttemptLogEntry>;
  writeProjectConfig(paths: Pick<ProtectMeConfigLoadResult["paths"], "projectConfigPath">, config: ProtectMeConfigFile): Promise<void>;
  writeGlobalConfig(paths: Pick<ProtectMeConfigLoadResult["paths"], "globalConfigPath">, config: ProtectMeConfigFile): Promise<void>;
  sendGuidance(message: string, options?: NetworkGuardGuidanceOptions): void;
}

export interface ToolCallBlockResult {
  block: true;
  reason: string;
}

interface ToolCallEventLike {
  toolName: string;
  input: unknown;
}

interface NetworkGuardPromptUI {
  select(title: string, options: string[]): Promise<string | undefined>;
  editor(title: string, prefill?: string): Promise<string | undefined>;
  notify?(message: string, type?: "info" | "warning" | "error"): void;
}

interface NetworkGuardStatusUI {
  setStatus(key: string, text: string | undefined): void;
  notify?(message: string, type?: "info" | "warning" | "error"): void;
}

interface NetworkGuardContextLike {
  cwd: string;
  hasUI?: boolean;
  ui?: unknown;
  isProjectTrusted?: () => boolean;
}

interface DisallowedRequest {
  candidate: BashNetworkRequestCandidate;
  attempt: number;
}

interface AllowDecision {
  action: "allow";
}

interface BlockDecision {
  action: "block";
  outcome: BlockedAttemptLogOutcome;
  reason: string;
  sendFirstAttemptGuidance?: boolean;
}

type NetworkGuardDecision = AllowDecision | BlockDecision;
type ConfigPromptTarget = "project" | "global";

interface ConfigWritePlan {
  ok: boolean;
  config?: ProtectMeConfigFile;
  reason?: string;
}

export function createNetworkGuardState(): NetworkGuardState {
  return {
    blockedHostAttempts: new Map(),
  };
}

export function resetNetworkGuardSessionState(state: NetworkGuardState): void {
  state.blockedHostAttempts.clear();
}

export function createDefaultNetworkGuardDependencies(pi: ExtensionAPI): NetworkGuardDependencies {
  return {
    getHomeDir: homedir,
    loadConfig: loadProtectMeConfig,
    appendBlockedAttemptLog,
    writeProjectConfig: writeProjectProtectMeConfig,
    writeGlobalConfig: writeGlobalProtectMeConfig,
    sendGuidance(message, options) {
      pi.sendUserMessage(message, options);
    },
  };
}

export function registerNetworkGuardEvents(
  pi: ExtensionAPI,
  dependencies: NetworkGuardDependencies = createDefaultNetworkGuardDependencies(pi),
): NetworkGuardState {
  const state = createNetworkGuardState();

  pi.on("session_start", (_event, ctx) => handleNetworkGuardSessionStart(ctx, state, dependencies));
  pi.on("session_shutdown", (_event, ctx) => handleNetworkGuardSessionShutdown(ctx));
  pi.on("tool_call", (event, ctx) => handleNetworkGuardToolCall(event, ctx, state, dependencies));

  return state;
}

export async function handleNetworkGuardSessionStart(
  ctx: NetworkGuardContextLike,
  state: NetworkGuardState,
  dependencies: NetworkGuardDependencies,
): Promise<void> {
  resetNetworkGuardSessionState(state);

  const config = await dependencies.loadConfig(buildNetworkGuardConfigLoadInput(ctx, dependencies));
  updateNetworkGuardStatus(ctx, config);
  notifyNetworkGuardConfigWarnings(ctx, config);
}

export function handleNetworkGuardSessionShutdown(ctx: NetworkGuardContextLike): void {
  clearNetworkGuardStatus(ctx);
}

export function buildProtectMeStatusText(config: ProtectMeConfigLoadResult): string {
  const projectConfigStatus = formatIgnoredProjectConfigStatus(config);

  return `${EXTENSION_DISPLAY_NAME}: ${config.effective.mode} · ${formatSiteCount(config.effective.allowList.length)}${projectConfigStatus}`;
}

export function buildProtectMeConfigWarningMessage(warnings: string[]): string | null {
  if (warnings.length === 0) return null;

  const visibleWarnings = warnings.slice(0, 3);
  const overflow = warnings.length > visibleWarnings.length ? `; +${warnings.length - visibleWarnings.length} more` : "";

  return `${EXTENSION_DISPLAY_NAME} config warning: ${visibleWarnings.join("; ")}${overflow}`;
}

export async function handleNetworkGuardToolCall(
  event: unknown,
  ctx: NetworkGuardContextLike,
  state: NetworkGuardState,
  dependencies: NetworkGuardDependencies,
): Promise<ToolCallBlockResult | undefined> {
  const toolCallEvent = parseToolCallEvent(event);
  if (!toolCallEvent) return undefined;

  const candidates = extractToolCallNetworkRequestCandidates(toolCallEvent.toolName, toolCallEvent.input);
  if (candidates.length === 0) return undefined;

  const config = await dependencies.loadConfig(buildNetworkGuardConfigLoadInput(ctx, dependencies));
  if (config.effective.mode === "allow") return undefined;

  const disallowedRequest = findFirstDisallowedRequest(candidates, config, state);
  if (!disallowedRequest) return undefined;

  const decision = await decideDisallowedRequest(ctx, config, disallowedRequest, dependencies);
  if (decision.action === "allow") return undefined;

  await logBlockedRequest(toolCallEvent, ctx, config, disallowedRequest, dependencies, decision.outcome);
  if (decision.sendFirstAttemptGuidance) sendFirstAttemptGuidance(disallowedRequest, dependencies);

  return {
    block: true,
    reason: decision.reason,
  };
}

export function incrementBlockedHostAttempt(state: NetworkGuardState, host: string): number {
  const attempt = (state.blockedHostAttempts.get(host) ?? 0) + 1;
  state.blockedHostAttempts.set(host, attempt);

  return attempt;
}

function parseToolCallEvent(event: unknown): ToolCallEventLike | null {
  if (!isRecord(event)) return null;
  if (typeof event.toolName !== "string") return null;

  return {
    toolName: event.toolName,
    input: event.input,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function buildNetworkGuardConfigLoadInput(
  ctx: NetworkGuardContextLike,
  dependencies: NetworkGuardDependencies,
): ProtectMeConfigPathInput {
  const homeDir = dependencies.getHomeDir();
  const projectTrusted = readProjectTrusted(ctx);
  if (projectTrusted) return { cwd: ctx.cwd, homeDir };

  return { cwd: ctx.cwd, homeDir, projectTrusted: false };
}

function readProjectTrusted(ctx: NetworkGuardContextLike): boolean {
  if (typeof ctx.isProjectTrusted !== "function") return true;

  return ctx.isProjectTrusted();
}

function updateNetworkGuardStatus(ctx: NetworkGuardContextLike, config: ProtectMeConfigLoadResult): void {
  const ui = readStatusUI(ctx);
  if (!ui) return;

  ui.setStatus(EXTENSION_STATUS_KEY, buildProtectMeStatusText(config));
}

function notifyNetworkGuardConfigWarnings(ctx: NetworkGuardContextLike, config: ProtectMeConfigLoadResult): void {
  const ui = readStatusUI(ctx);
  if (!ui?.notify) return;

  const message = buildProtectMeConfigWarningMessage(config.effective.warnings);
  if (message) ui.notify(message, "warning");
}

function clearNetworkGuardStatus(ctx: NetworkGuardContextLike): void {
  const ui = readStatusUI(ctx);
  if (!ui) return;

  ui.setStatus(EXTENSION_STATUS_KEY, undefined);
}

function readStatusUI(ctx: NetworkGuardContextLike): NetworkGuardStatusUI | null {
  if (ctx.hasUI !== true) return null;
  if (!isStatusUI(ctx.ui)) return null;

  return ctx.ui;
}

function isStatusUI(value: unknown): value is NetworkGuardStatusUI {
  if (!isRecord(value)) return false;

  return typeof value.setStatus === "function";
}

function formatSiteCount(count: number): string {
  const label = count === 1 ? "site" : "sites";

  return `${count} ${label}`;
}

function formatIgnoredProjectConfigStatus(config: ProtectMeConfigLoadResult): string {
  if (config.projectConfig.status !== "ignored") return "";

  return " · project config ignored";
}

function findFirstDisallowedRequest(
  candidates: BashNetworkRequestCandidate[],
  config: ProtectMeConfigLoadResult,
  state: NetworkGuardState,
): DisallowedRequest | null {
  for (const candidate of candidates) {
    if (matchAllowedHost(candidate.host, config.effective.allowList).allowed) continue;

    return {
      candidate,
      attempt: incrementBlockedHostAttempt(state, candidate.host),
    };
  }

  return null;
}

async function decideDisallowedRequest(
  ctx: NetworkGuardContextLike,
  config: ProtectMeConfigLoadResult,
  request: DisallowedRequest,
  dependencies: NetworkGuardDependencies,
): Promise<NetworkGuardDecision> {
  if (request.attempt === 1) return buildFirstAttemptBlockDecision(request.candidate.host);
  if (!hasPromptUI(ctx)) return buildPromptUnavailableDecision(request.candidate.host);

  return promptForRepeatedBlockedRequest(ctx.ui, config, request, dependencies);
}

function buildFirstAttemptBlockDecision(host: string): BlockDecision {
  return {
    action: "block",
    outcome: "blocked",
    reason: buildProtectMeBlockReason(host),
    sendFirstAttemptGuidance: true,
  };
}

function buildPromptUnavailableDecision(host: string): BlockDecision {
  return {
    action: "block",
    outcome: "prompt_unavailable",
    reason: buildProtectMePromptUnavailableBlockReason(host),
  };
}

async function promptForRepeatedBlockedRequest(
  ui: NetworkGuardPromptUI,
  config: ProtectMeConfigLoadResult,
  request: DisallowedRequest,
  dependencies: NetworkGuardDependencies,
): Promise<NetworkGuardDecision> {
  const choice = await ui.select(buildRepeatedAttemptPrompt(config, request), PROTECTME_SECOND_ATTEMPT_CHOICE_VALUES);

  if (choice === PROTECTME_SECOND_ATTEMPT_CHOICES.allowOnce) return { action: "allow" };
  if (choice === PROTECTME_SECOND_ATTEMPT_CHOICES.addProject) return allowViaConfigWrite("project", ui, config, request, dependencies);
  if (choice === PROTECTME_SECOND_ATTEMPT_CHOICES.addGlobal) return allowViaConfigWrite("global", ui, config, request, dependencies);

  return buildPromptDeniedDecision(request.candidate.host);
}

async function allowViaConfigWrite(
  target: ConfigPromptTarget,
  ui: NetworkGuardPromptUI,
  config: ProtectMeConfigLoadResult,
  request: DisallowedRequest,
  dependencies: NetworkGuardDependencies,
): Promise<NetworkGuardDecision> {
  const configSource = selectConfigSource(config, target);
  const unsafeReason = buildUnsafeConfigSourceWriteReason(configSource);
  if (unsafeReason) {
    notifyPromptFailure(ui, unsafeReason);
    return buildPromptDeniedDecision(request.candidate.host);
  }

  const suggestedEntry = buildSuggestedAllowListEntry(request);
  const editedEntry = await ui.editor(buildAllowListEntryEditorTitle(target, request.candidate.host), suggestedEntry);
  const writePlan = buildConfigWritePlan(configSource, editedEntry);

  if (!writePlan.ok || !writePlan.config) {
    notifyPromptFailure(ui, writePlan.reason ?? "No allow-list entry was confirmed.");
    return buildPromptDeniedDecision(request.candidate.host);
  }

  try {
    await writeTargetConfig(target, config, writePlan.config, dependencies);
  } catch (error) {
    const message = buildErrorMessage(error);
    notifyPromptFailure(ui, message);

    return {
      action: "block",
      outcome: "prompt_denied",
      reason: buildProtectMeConfigWriteFailedBlockReason(request.candidate.host, message),
    };
  }

  return { action: "allow" };
}

function hasPromptUI(ctx: NetworkGuardContextLike): ctx is NetworkGuardContextLike & { ui: NetworkGuardPromptUI } {
  return ctx.hasUI === true && isPromptUI(ctx.ui);
}

function isPromptUI(value: unknown): value is NetworkGuardPromptUI {
  if (!isRecord(value)) return false;
  if (typeof value.select !== "function") return false;
  if (typeof value.editor !== "function") return false;

  return true;
}

function buildRepeatedAttemptPrompt(config: ProtectMeConfigLoadResult, request: DisallowedRequest): string {
  const suggestedEntry = buildSuggestedAllowListEntry(request);

  return [
    `ProtectMe blocked repeated network request to ${request.candidate.host}.`,
    `Attempt: ${request.attempt}`,
    `Suggested allow-list entry: ${suggestedEntry}`,
    `Project config: ${formatConfigSourceForPrompt(config.projectConfig)}`,
    `Global config: ${formatConfigSourceForPrompt(config.globalConfig)}`,
    "Choose how to handle this tool call.",
  ].join("\n");
}

function formatConfigSourceForPrompt(configSource: ParsedProtectMeConfig): string {
  if (configSource.status === "valid" || configSource.status === "missing") return configSource.path;

  const detail = configSource.message ? `: ${configSource.message}` : "";

  return `${configSource.path} (${configSource.status}${detail})`;
}

function buildSuggestedAllowListEntry(request: DisallowedRequest): string {
  const suggestion = suggestCleanAllowListEntry(request.candidate.rawTarget);

  return suggestion.suggestedEntry ?? request.candidate.host;
}

function buildAllowListEntryEditorTitle(target: ConfigPromptTarget, host: string): string {
  return `ProtectMe ${target} allow-list entry for ${host}`;
}

function selectConfigSource(config: ProtectMeConfigLoadResult, target: ConfigPromptTarget): ParsedProtectMeConfig {
  if (target === "project") return config.projectConfig;

  return config.globalConfig;
}

function buildConfigWritePlan(configSource: ParsedProtectMeConfig, editedEntry: string | undefined): ConfigWritePlan {
  if (editedEntry === undefined) return { ok: false, reason: "No allow-list entry was confirmed." };

  const unsafeReason = buildUnsafeConfigSourceWriteReason(configSource);
  if (unsafeReason) return { ok: false, reason: unsafeReason };

  const normalizedEntry = normalizeConfigAllowListEntry(editedEntry);
  if (!normalizedEntry) return { ok: false, reason: `Invalid allow-list entry: ${JSON.stringify(editedEntry)}` };

  return {
    ok: true,
    config: appendAllowListEntry(configSource.config ?? {}, normalizedEntry),
  };
}

function buildUnsafeConfigSourceWriteReason(configSource: ParsedProtectMeConfig): string | null {
  if (configSource.status !== "invalid" && configSource.status !== "unreadable" && configSource.status !== "ignored") return null;

  const detail = configSource.message ? `: ${configSource.message}` : "";

  return `${configSource.source} config is ${configSource.status}${detail}`;
}

function appendAllowListEntry(config: ProtectMeConfigFile, normalizedEntry: string): ProtectMeConfigFile {
  const rawAllowList = config.allowList ?? [];
  const normalizedAllowList = normalizeConfigAllowList(rawAllowList);
  const allowList = normalizedAllowList.includes(normalizedEntry) ? rawAllowList : [...rawAllowList, normalizedEntry];

  return buildConfigFile(config, allowList);
}

function buildConfigFile(config: ProtectMeConfigFile, allowList: string[]): ProtectMeConfigFile {
  const nextConfig: ProtectMeConfigFile = { allowList };
  if (config.mode) nextConfig.mode = config.mode;

  return nextConfig;
}

async function writeTargetConfig(
  target: ConfigPromptTarget,
  config: ProtectMeConfigLoadResult,
  configFile: ProtectMeConfigFile,
  dependencies: NetworkGuardDependencies,
): Promise<void> {
  if (target === "project") {
    await dependencies.writeProjectConfig(config.paths, configFile);
    return;
  }

  await dependencies.writeGlobalConfig(config.paths, configFile);
}

function notifyPromptFailure(ui: NetworkGuardPromptUI, message: string): void {
  ui.notify?.(`ProtectMe could not allow this call: ${message}`, "error");
}

function buildPromptDeniedDecision(host: string): BlockDecision {
  return {
    action: "block",
    outcome: "prompt_denied",
    reason: buildProtectMePromptDeniedBlockReason(host),
  };
}

function buildErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;

  return String(error);
}

async function logBlockedRequest(
  event: ToolCallEventLike,
  ctx: NetworkGuardContextLike,
  config: ProtectMeConfigLoadResult,
  request: DisallowedRequest,
  dependencies: NetworkGuardDependencies,
  outcome: BlockedAttemptLogOutcome,
): Promise<void> {
  await dependencies.appendBlockedAttemptLog({
    logPath: config.paths.blockedAttemptLogPath,
    cwd: ctx.cwd,
    toolName: event.toolName,
    command: extractCommandForLog(event.input),
    rawUrl: request.candidate.rawTarget,
    normalizedUrl: request.candidate.rawTarget,
    host: request.candidate.host,
    attempt: request.attempt,
    mode: config.effective.mode,
    configSources: config.effective.configSources.map(toConfigSourceMetadata),
    outcome,
  });
}

function extractCommandForLog(input: unknown): string {
  if (typeof input === "string") return input;
  if (isRecord(input) && typeof input.command === "string") return input.command;

  return "";
}

function toConfigSourceMetadata(configSource: ParsedProtectMeConfig): ProtectMeConfigSourceMetadata {
  return {
    source: configSource.source,
    path: configSource.path,
    status: configSource.status,
    message: configSource.message,
  };
}

function sendFirstAttemptGuidance(request: DisallowedRequest, dependencies: NetworkGuardDependencies): void {
  dependencies.sendGuidance(buildProtectMeFirstBlockGuidance(request.candidate.host), { deliverAs: "followUp" });
}
