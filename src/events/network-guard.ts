import { homedir } from "node:os";

import { getAgentDir as getPiAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  appendProtectMeConfigListEntry,
  buildProtectMeConfigEditSourceError,
  loadProtectMeConfigWithGlobalDefault,
  mutateGlobalProtectMeConfig,
  mutateProjectProtectMeConfig,
  mutateProtectMeConfigFile,
  readProtectMeConfigSource,
  selectProtectMeConfigEditSource,
  type ParsedProtectMeConfig,
  type ProtectMeConfigFile,
  type ProtectMeConfigLoadResult,
  type ProtectMeConfigMutation,
  type ProtectMeConfigPathInput,
  type ProtectMeConfigSourceMetadata,
} from "../config/index.ts";
import {
  appendBlockedAttemptLog,
  redactSensitiveLogText,
  redactSensitiveLogValue,
  type AppendBlockedAttemptLogInput,
  type BlockedAttemptLogEntry,
  type ProtectMeRequestAttemptOutcome,
} from "../logging/blocked-attempt-log.ts";
import {
  buildProtectMeBlockReason,
  buildProtectMeConfigWriteFailedBlockReason,
  buildProtectMeDeniedBlockReason,
  buildProtectMeFirstBlockGuidance,
  buildProtectMePromptDeniedBlockReason,
  buildProtectMePromptErrorBlockReason,
  buildProtectMePromptUnavailableBlockReason,
  buildProtectMeUnsupportedNetworkOptionBlockReason,
  extractBashNetworkRequestCandidates,
  extractToolCallNetworkRequestCandidates,
  isReadOnlyRequest,
  matchAllowedHost,
  suggestCleanAllowListEntry,
  type BashNetworkRequestCandidate,
} from "../policy/index.ts";
import {
  clearProtectMeSessionStatusFromContext,
  syncProtectMeSessionStatusFromContext,
} from "./protectme-session-status.ts";
export {
  buildProtectMeConfigWarningMessage,
  buildProtectMeStatusText,
  clearProtectMeSessionStatus,
  clearProtectMeSessionStatusFromContext,
  syncProtectMeSessionStatus,
  syncProtectMeSessionStatusFromContext,
} from "./protectme-session-status.ts";

// Session reads (PROTECTME_SESSION_READS): a host that runs research sets it for that
// session. "ask" prompts on the first try of a read-only request and adds one choice;
// "open" lets read-only requests through unasked. A request that sends data keeps the normal flow.
export const PROTECTME_SESSION_READS_ENV = "PROTECTME_SESSION_READS";
export const PROTECTME_SESSION_READS_ALL_CHOICE = "Allow all read-only requests for this session";
// Names a JSON file ({ allowList, denyList }) that holds the session lists, so several sessions can share them.
export const PROTECTME_SESSION_CONFIG_ENV = "PROTECTME_SESSION_CONFIG";
export const PROTECTME_BLOCKED_EVENT = "herdr:blocked";

const PROMPT_SCOPE_LABELS = { once: "once", session: "for session", project: "for project", global: "globally" } as const;
const BLOCKED_EVENT_COMMAND_MAX_LENGTH = 4000;
let blockedPromptCounter = 0;

export const PROTECTME_GUIDANCE_CUSTOM_MESSAGE_TYPE = "protectme-guidance";

const PROTECTME_USER_BASH_LOG_TOOL_NAME = "user_bash";
const PROTECTME_PROMPT_ERROR_NOTIFICATION = [
  "ProtectMe blocked this repeated network request because the confirmation prompt failed.",
  "No config was changed; update the allow list manually before retrying.",
].join(" ");

export interface NetworkGuardState {
  blockedHostAttempts: Map<string, number>;
  // Session allow and deny lists, used when PROTECTME_SESSION_CONFIG names no file.
  session: ProtectMeConfigFile;
  // The user allowed every read-only request for this session (session reads "ask").
  sessionReadsAll: boolean;
}

export interface NetworkGuardGuidanceOptions {
  deliverAs?: "steer" | "nextTurn";
}

export interface NetworkGuardDependencies {
  getHomeDir(): string;
  getAgentDir(): string;
  loadConfig(input: ProtectMeConfigPathInput): Promise<ProtectMeConfigLoadResult>;
  appendBlockedAttemptLog(input: AppendBlockedAttemptLogInput): Promise<BlockedAttemptLogEntry>;
  mutateProjectConfig(
    paths: Pick<ProtectMeConfigLoadResult["paths"], "projectConfigPath">,
    mutation: ProtectMeConfigMutation,
  ): Promise<ProtectMeConfigFile>;
  mutateGlobalConfig(
    paths: Pick<ProtectMeConfigLoadResult["paths"], "globalConfigPath">,
    mutation: ProtectMeConfigMutation,
  ): Promise<ProtectMeConfigFile>;
  sendGuidance(message: string, options?: NetworkGuardGuidanceOptions): void;
  // Tells other extensions that the approval prompt opened or closed (herdr:blocked).
  emitBlocked(event: unknown): void;
  // The session-reads mode; defaults to the PROTECTME_SESSION_READS environment variable.
  getSessionReads?(): string | undefined;
}

export interface ToolCallBlockResult {
  block: true;
  reason: string;
}

export interface UserBashBlockResult {
  result: {
    output: string;
    exitCode: number | undefined;
    cancelled: boolean;
    truncated: boolean;
  };
}

interface ToolCallEventLike {
  toolName: string;
  input: unknown;
}

interface UserBashEventLike {
  command: string;
}

interface NetworkGuardPromptUI {
  select(title: string, options: string[]): Promise<string | undefined>;
  notify?(message: string, type?: "info" | "warning" | "error"): void;
}

interface NetworkGuardContextLike {
  cwd: string;
  hasUI?: boolean;
  ui?: unknown;
  isProjectTrusted?: () => boolean;
}

type PromptScope = keyof typeof PROMPT_SCOPE_LABELS;
type SessionReadsMode = "ask" | "open" | undefined;

interface DisallowedRequest {
  // The first unlisted request: it decides between the first block and the prompt.
  candidate: BashNetworkRequestCandidate;
  // Every unlisted request of the command.
  candidates: BashNetworkRequestCandidate[];
  attempt: number;
  readOnly: boolean;
  // Session reads "ask" and only read-only requests: ask on the first try and offer the all-reads choice.
  askReads: boolean;
}

interface PromptChoice {
  label: string;
  list: "allowList" | "denyList";
  scope: PromptScope;
}

interface SavedEntry {
  entry: string;
  subdomains: boolean;
}

interface DecisionLog {
  outcome: ProtectMeRequestAttemptOutcome;
  // One log line each.
  candidates: BashNetworkRequestCandidate[];
}

interface AllowDecision extends DecisionLog {
  action: "allow";
}

interface BlockDecision extends DecisionLog {
  action: "block";
  reason: string;
  firstAttemptGuidance?: string;
}

type NetworkGuardDecision = AllowDecision | BlockDecision;

export function createNetworkGuardState(): NetworkGuardState {
  return {
    blockedHostAttempts: new Map(),
    session: {},
    sessionReadsAll: false,
  };
}

export function resetNetworkGuardSessionState(state: NetworkGuardState): void {
  state.blockedHostAttempts.clear();
  state.session = {};
  state.sessionReadsAll = false;
}

function sessionReadsMode(dependencies: NetworkGuardDependencies): SessionReadsMode {
  const value = dependencies.getSessionReads ? dependencies.getSessionReads() : process.env[PROTECTME_SESSION_READS_ENV];

  return value === "ask" || value === "open" ? value : undefined;
}

// A read-only request the session already covers: every one in "open" mode, or in "ask" mode once the user allowed all of them.
function isSessionRead(candidate: BashNetworkRequestCandidate, state: NetworkGuardState, mode: SessionReadsMode): boolean {
  if (mode === undefined || !isReadOnlyRequest(candidate)) return false;

  return mode === "open" || state.sessionReadsAll;
}

// Read on every call: another session that shares the file may have saved an entry since.
async function loadSessionLists(state: NetworkGuardState): Promise<ProtectMeConfigFile> {
  const path = process.env[PROTECTME_SESSION_CONFIG_ENV];
  if (!path) return state.session;

  return (await readProtectMeConfigSource("global", path)).config ?? {};
}

async function saveSessionEntries(state: NetworkGuardState, list: PromptChoice["list"], entries: string[]): Promise<void> {
  const path = process.env[PROTECTME_SESSION_CONFIG_ENV];
  if (path) {
    await mutateProtectMeConfigFile("global", path, (current) => appendConfigListEntries(current, list, entries));
    return;
  }

  state.session = appendConfigListEntries(state.session, list, entries);
}

function appendConfigListEntries(config: ProtectMeConfigFile, list: PromptChoice["list"], entries: string[]): ProtectMeConfigFile {
  return entries.reduce((next, entry) => appendProtectMeConfigListEntry(next, list, entry), config);
}

export function createDefaultNetworkGuardDependencies(pi: ExtensionAPI): NetworkGuardDependencies {
  return {
    getHomeDir: homedir,
    getAgentDir: getPiAgentDir,
    loadConfig: loadProtectMeConfigWithGlobalDefault,
    appendBlockedAttemptLog,
    mutateProjectConfig: mutateProjectProtectMeConfig,
    mutateGlobalConfig: mutateGlobalProtectMeConfig,
    sendGuidance(message, options) {
      pi.sendMessage(
        {
          customType: PROTECTME_GUIDANCE_CUSTOM_MESSAGE_TYPE,
          content: message,
          display: false,
          details: { source: "network_guard" },
        },
        { deliverAs: options?.deliverAs ?? "steer" },
      );
    },
    emitBlocked(event) {
      try {
        pi.events?.emit(PROTECTME_BLOCKED_EVENT, event);
      } catch {
        // A failing listener must not change the ProtectMe decision.
      }
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
  pi.on("user_bash", (event, ctx) => handleNetworkGuardUserBash(event, ctx, state, dependencies));

  return state;
}

export async function handleNetworkGuardSessionStart(
  ctx: NetworkGuardContextLike,
  state: NetworkGuardState,
  dependencies: NetworkGuardDependencies,
): Promise<void> {
  resetNetworkGuardSessionState(state);

  const config = await dependencies.loadConfig(buildNetworkGuardConfigLoadInput(ctx, dependencies));
  syncProtectMeSessionStatusFromContext(ctx, config);
}

export function handleNetworkGuardSessionShutdown(ctx: NetworkGuardContextLike): void {
  clearProtectMeSessionStatusFromContext(ctx);
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

  const decision = await guardNetworkRequests(toolCallEvent, candidates, ctx, state, dependencies, sessionReadsMode(dependencies));
  if (decision?.action !== "block") return undefined;
  if (decision.firstAttemptGuidance) dependencies.sendGuidance(decision.firstAttemptGuidance, { deliverAs: "steer" });

  return {
    block: true,
    reason: decision.reason,
  };
}

export async function handleNetworkGuardUserBash(
  event: unknown,
  ctx: NetworkGuardContextLike,
  state: NetworkGuardState,
  dependencies: NetworkGuardDependencies,
): Promise<UserBashBlockResult | undefined> {
  const userBashEvent = parseUserBashEvent(event);
  if (!userBashEvent) return undefined;

  const candidates = extractBashNetworkRequestCandidates(userBashEvent.command);
  if (candidates.length === 0) return undefined;

  // The user's own bash commands are not the session's research: no session reads here.
  const decision = await guardNetworkRequests(buildUserBashLogEvent(userBashEvent), candidates, ctx, state, dependencies, undefined);
  if (decision?.action !== "block") return undefined;

  return buildUserBashBlockResult(decision.reason);
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

function parseUserBashEvent(event: unknown): UserBashEventLike | null {
  if (!isRecord(event)) return null;
  if (typeof event.command !== "string") return null;

  return {
    command: event.command,
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
  const agentDir = dependencies.getAgentDir();
  const projectTrusted = readProjectTrusted(ctx);
  if (projectTrusted) return { cwd: ctx.cwd, homeDir, agentDir };

  return { cwd: ctx.cwd, homeDir, agentDir, projectTrusted: false };
}

function readProjectTrusted(ctx: NetworkGuardContextLike): boolean {
  if (typeof ctx.isProjectTrusted !== "function") return true;

  return ctx.isProjectTrusted();
}

// Decides one command's network requests and logs the outcome. Null: every request goes to a listed host, or mode is "allow".
async function guardNetworkRequests(
  event: ToolCallEventLike,
  candidates: BashNetworkRequestCandidate[],
  ctx: NetworkGuardContextLike,
  state: NetworkGuardState,
  dependencies: NetworkGuardDependencies,
  sessionReads: SessionReadsMode,
): Promise<NetworkGuardDecision | null> {
  const config = await dependencies.loadConfig(buildNetworkGuardConfigLoadInput(ctx, dependencies));
  if (config.effective.mode === "allow") return null;

  const decision = await decideNetworkRequests(event, candidates, ctx, config, state, dependencies, sessionReads);
  if (!decision) return null;

  // Chain writes to the same JSONL file so records stay in candidate order.
  let logged = Promise.resolve();
  for (const candidate of decision.candidates) {
    logged = logged.then(() =>
      logRequestAttempt(event, ctx, config, candidate, state.blockedHostAttempts.get(candidate.host) ?? 1, dependencies, decision.outcome),
    );
  }
  await logged;

  return decision;
}

async function decideNetworkRequests(
  event: ToolCallEventLike,
  candidates: BashNetworkRequestCandidate[],
  ctx: NetworkGuardContextLike,
  config: ProtectMeConfigLoadResult,
  state: NetworkGuardState,
  dependencies: NetworkGuardDependencies,
  sessionReads: SessionReadsMode,
): Promise<NetworkGuardDecision | null> {
  const session = await loadSessionLists(state);

  // Deny wins: over the allow lists, and over every other request of the command.
  const denyList = [...config.effective.denyList, ...(session.denyList ?? [])];
  const denied = candidates.find((candidate) => matchAllowedHost(candidate.host, denyList).allowed);
  if (denied) return buildDeniedDecision(denied, state);

  const allowList = [...config.effective.allowList, ...(session.allowList ?? [])];
  const unlisted = candidates.filter(
    (candidate) => !matchAllowedHost(candidate.host, allowList).allowed && !isSessionRead(candidate, state, sessionReads),
  );
  const first = unlisted[0];
  if (!first) return null;

  const readOnly = unlisted.every(isReadOnlyRequest);
  const request: DisallowedRequest = {
    candidate: first,
    candidates: unlisted,
    attempt: incrementBlockedHostAttempt(state, first.host),
    readOnly,
    askReads: readOnly && sessionReads === "ask",
  };

  const unsupported = unlisted.find((candidate) => candidate.unsupportedReason);
  if (unsupported) return buildUnsupportedNetworkOptionBlockDecision(unsupported);
  if (request.attempt === 1 && !(request.askReads && hasPromptUI(ctx))) return buildFirstAttemptBlockDecision(first, hasPromptUI(ctx));
  if (!hasPromptUI(ctx)) return buildPromptUnavailableDecision(first);

  return promptForBlockedRequest(event, ctx.ui, config, request, dependencies, state);
}

function buildDeniedDecision(candidate: BashNetworkRequestCandidate, state: NetworkGuardState): BlockDecision {
  incrementBlockedHostAttempt(state, candidate.host);

  return {
    action: "block",
    outcome: "denied",
    candidates: [candidate],
    reason: buildProtectMeDeniedBlockReason(candidate.host),
  };
}

function buildUnsupportedNetworkOptionBlockDecision(candidate: BashNetworkRequestCandidate): BlockDecision {
  return {
    action: "block",
    outcome: "blocked",
    candidates: [candidate],
    reason: buildProtectMeUnsupportedNetworkOptionBlockReason(candidate.cli, candidate.rawTarget, candidate.unsupportedReason ?? "unknown reason"),
  };
}

function buildFirstAttemptBlockDecision(candidate: BashNetworkRequestCandidate, promptAvailable: boolean): BlockDecision {
  return {
    action: "block",
    outcome: "blocked",
    candidates: [candidate],
    reason: buildProtectMeBlockReason(candidate.host, promptAvailable),
    firstAttemptGuidance: buildProtectMeFirstBlockGuidance(candidate.host, promptAvailable),
  };
}

function buildPromptUnavailableDecision(candidate: BashNetworkRequestCandidate): BlockDecision {
  return {
    action: "block",
    outcome: "prompt_unavailable",
    candidates: [candidate],
    reason: buildProtectMePromptUnavailableBlockReason(candidate.host),
  };
}

// One prompt for every unlisted host of the command; the choice applies to all of them.
async function promptForBlockedRequest(
  event: ToolCallEventLike,
  ui: NetworkGuardPromptUI,
  config: ProtectMeConfigLoadResult,
  request: DisallowedRequest,
  dependencies: NetworkGuardDependencies,
  state: NetworkGuardState,
): Promise<NetworkGuardDecision> {
  const candidates = request.candidates.filter((candidate, index, all) => all.findIndex((other) => other.host === candidate.host) === index);
  const hosts = candidates.map((candidate) => candidate.host).join(", ");
  const saved = buildSavedEntries(candidates);
  const scopes = buildPromptScopes(config);
  const choices = buildPromptChoices(scopes);
  const options = [...choices.map((choice) => choice.label), ...(request.askReads ? [PROTECTME_SESSION_READS_ALL_CHOICE] : [])];
  const kind = request.readOnly ? "read-only network request" : "network request that sends data";
  const id = (blockedPromptCounter += 1);
  let label: string | undefined;

  dependencies.emitBlocked({
    active: true,
    id,
    label: `ProtectMe approval: ${hosts}`,
    guard: {
      name: "protectme",
      kind: "network",
      title: "Network request blocked",
      tool: event.toolName,
      command: redactSensitiveLogText(extractCommandForLog(event.input)).slice(0, BLOCKED_EVENT_COMMAND_MAX_LENGTH),
      subject: hosts,
      reason: `This ${kind} goes to hosts that are not on the allow list: ${hosts}.`,
      rule: {
        pattern: saved.map((item) => item.entry).join(", "),
        covers: saved.map((item) => (item.subdomains ? `${item.entry} and its subdomains` : `${item.entry} only`)).join(", "),
        exact: false,
        scopes,
      },
      options,
    },
  });

  try {
    label = await ui.select(buildPromptTitle(kind, hosts, saved), options);
  } catch {
    notifyPromptError(ui);
    return { action: "block", outcome: "prompt_error", candidates, reason: buildProtectMePromptErrorBlockReason(hosts) };
  } finally {
    dependencies.emitBlocked({ active: false, id });
  }

  if (label === PROTECTME_SESSION_READS_ALL_CHOICE && request.askReads) {
    state.sessionReadsAll = true;
    return { action: "allow", outcome: "prompt_allowed_session", candidates };
  }

  // A cancelled prompt, or a label that is not on the list, is "Deny once".
  const choice = choices.find((item) => item.label === label) ?? { list: "denyList", scope: "once" };

  try {
    await saveChoice(choice, saved.map((item) => item.entry), config, state, dependencies);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notifyPromptUser(ui, `ProtectMe could not save this choice: ${message}`);

    return { action: "block", outcome: "prompt_error", candidates, reason: buildProtectMeConfigWriteFailedBlockReason(hosts, message) };
  }

  if (choice.list === "allowList") return { action: "allow", outcome: `prompt_allowed_${choice.scope}`, candidates };

  return { action: "block", outcome: `prompt_denied_${choice.scope}`, candidates, reason: buildProtectMePromptDeniedBlockReason(hosts) };
}

// What a saved choice writes per host: the registrable domain, or the exact host when there is none (an IP address, localhost).
function buildSavedEntries(candidates: BashNetworkRequestCandidate[]): SavedEntry[] {
  const saved: SavedEntry[] = [];

  for (const candidate of candidates) {
    const suggestion = suggestCleanAllowListEntry(candidate.rawTarget);
    const entry = suggestion.suggestedEntry ?? candidate.host;
    if (!saved.some((item) => item.entry === entry)) saved.push({ entry, subdomains: suggestion.source === "registrable_domain" });
  }

  return saved;
}

// Project and global are offered only when that config can be written: not for an untrusted project, not for a broken file.
function buildPromptScopes(config: ProtectMeConfigLoadResult): PromptScope[] {
  const scopes: PromptScope[] = ["once", "session"];
  if (buildProtectMeConfigEditSourceError(selectProtectMeConfigEditSource(config, "project")) === null) scopes.push("project");
  if (buildProtectMeConfigEditSourceError(selectProtectMeConfigEditSource(config, "global")) === null) scopes.push("global");

  return scopes;
}

function buildPromptChoices(scopes: PromptScope[]): PromptChoice[] {
  return [
    ...scopes.map((scope): PromptChoice => ({ label: `Allow ${PROMPT_SCOPE_LABELS[scope]}`, list: "allowList", scope })),
    ...scopes.map((scope): PromptChoice => ({ label: `Deny ${PROMPT_SCOPE_LABELS[scope]}`, list: "denyList", scope })),
  ];
}

function buildPromptTitle(kind: string, hosts: string, saved: SavedEntry[]): string {
  const savedEntries = saved.map((item) => (item.subdomains ? `${item.entry} (and its subdomains)` : item.entry)).join(", ");

  return [
    `ProtectMe blocked a ${kind}.`,
    `Hosts: ${hosts}`,
    `Saves: ${savedEntries}`,
  ].join("\n");
}

async function saveChoice(
  choice: Pick<PromptChoice, "list" | "scope">,
  entries: string[],
  config: ProtectMeConfigLoadResult,
  state: NetworkGuardState,
  dependencies: NetworkGuardDependencies,
): Promise<void> {
  if (choice.scope === "once") return;
  if (choice.scope === "session") {
    await saveSessionEntries(state, choice.list, entries);
    return;
  }
  if (choice.scope === "project") {
    await dependencies.mutateProjectConfig(config.paths, (current) => appendConfigListEntries(current, choice.list, entries));
    return;
  }

  await dependencies.mutateGlobalConfig(config.paths, (current) => appendConfigListEntries(current, choice.list, entries));
}

function hasPromptUI(ctx: NetworkGuardContextLike): ctx is NetworkGuardContextLike & { ui: NetworkGuardPromptUI } {
  return ctx.hasUI === true && isPromptUI(ctx.ui);
}

function isPromptUI(value: unknown): value is NetworkGuardPromptUI {
  if (!isRecord(value)) return false;
  return typeof value.select === "function";
}

function notifyPromptError(ui: NetworkGuardPromptUI): void {
  notifyPromptUser(ui, PROTECTME_PROMPT_ERROR_NOTIFICATION);
}

function notifyPromptUser(ui: NetworkGuardPromptUI, message: string): void {
  try {
    ui.notify?.(message, "error");
  } catch {
    // Notification failures must not replace the primary ProtectMe fail-closed decision.
  }
}

function buildUserBashLogEvent(event: UserBashEventLike): ToolCallEventLike {
  return {
    toolName: PROTECTME_USER_BASH_LOG_TOOL_NAME,
    input: { command: event.command },
  };
}

function buildUserBashBlockResult(reason: string): UserBashBlockResult {
  return {
    result: {
      output: `${reason}\n`,
      exitCode: 1,
      cancelled: false,
      truncated: false,
    },
  };
}

async function logRequestAttempt(
  event: ToolCallEventLike,
  ctx: NetworkGuardContextLike,
  config: ProtectMeConfigLoadResult,
  candidate: BashNetworkRequestCandidate,
  attempt: number,
  dependencies: NetworkGuardDependencies,
  outcome: ProtectMeRequestAttemptOutcome,
): Promise<void> {
  await dependencies.appendBlockedAttemptLog({
    logPath: config.paths.blockedAttemptLogPath,
    cwd: ctx.cwd,
    toolName: event.toolName,
    command: redactSensitiveLogText(extractCommandForLog(event.input)),
    rawUrl: redactSensitiveLogValue(candidate.rawTarget),
    normalizedUrl: redactSensitiveLogValue(candidate.rawTarget),
    host: candidate.host,
    attempt,
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
