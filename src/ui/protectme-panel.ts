import { readFile } from "node:fs/promises";
import { homedir } from "node:os";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import {
  loadProtectMeConfig,
  mutateGlobalProtectMeConfig,
  mutateProjectProtectMeConfig,
  normalizeConfigAllowList,
  normalizeConfigAllowListEntry,
  type ParsedProtectMeConfig,
  type ProtectMeConfigFile,
  type ProtectMeConfigLoadResult,
  type ProtectMeConfigMutation,
  type ProtectMeConfigPathInput,
  type ProtectMeConfigSource,
  type ProtectMeMode,
} from "../config/index.ts";
import { EXTENSION_DISPLAY_NAME, PROTECTME_COMMAND_NAME } from "../constants.ts";
import { suggestCleanAllowListEntry } from "../policy/index.ts";

const WIDE_MODE_MIN_WIDTH = 72;
const TINY_MODE_MAX_WIDTH = 23;
const MAX_VISIBLE_SETTINGS = 10;
const MAX_RECENT_BLOCKED_HOSTS = 5;
const PANEL_TITLE = EXTENSION_DISPLAY_NAME;
const REQUIRED_TUI_MESSAGE = "/protectme requires Pi TUI mode.";
const DEFAULT_WRITE_TARGET: ProtectMePanelWriteTarget = "project";
const PROJECT_WRITE_TARGET_LABEL = "Project config";
const GLOBAL_WRITE_TARGET_LABEL = "Global config";
const WRITE_TARGET_CHOICES = [PROJECT_WRITE_TARGET_LABEL, GLOBAL_WRITE_TARGET_LABEL];

export interface ProtectMeCommandDependencies {
  getHomeDir(): string;
  loadConfig(input: ProtectMeConfigPathInput): Promise<ProtectMeConfigLoadResult>;
  readRecentBlockedHosts(logPath: string): Promise<string[]>;
  mutateProjectConfig(
    paths: Pick<ProtectMeConfigLoadResult["paths"], "projectConfigPath">,
    mutation: ProtectMeConfigMutation,
  ): Promise<ProtectMeConfigFile>;
  mutateGlobalConfig(
    paths: Pick<ProtectMeConfigLoadResult["paths"], "globalConfigPath">,
    mutation: ProtectMeConfigMutation,
  ): Promise<ProtectMeConfigFile>;
}

export interface ProtectMePanelState {
  config: ProtectMeConfigLoadResult;
  recentBlockedHosts: string[];
}

export interface ProtectMePanelTheme {
  fg(role: ProtectMeThemeRole, text: string): string;
  bold(text: string): string;
}

export interface ProtectMePanelActionUI {
  select?(title: string, options: string[]): Promise<string | undefined>;
  editor?(title: string, prefill?: string): Promise<string | undefined>;
  notify?(message: string, type?: "info" | "warning" | "error"): void;
}

export interface ProtectMePanelActionDependencies extends Omit<ProtectMeCommandDependencies, "getHomeDir"> {
  cwd: string;
  homeDir: string;
  projectTrusted?: boolean;
  ui: ProtectMePanelActionUI | null;
}

export type ProtectMePanelWriteTarget = ProtectMeConfigSource;

type ProtectMeThemeRole = "accent" | "dim" | "muted" | "success" | "warning";
type ProtectMePanelAction = "addEntry" | "chooseWriteTarget" | "removeEntry" | "toggleMode";
type ProtectMePanelActionStatus = "cancelled" | "error" | "success";
type SettingValueKind = "action" | "count" | "mode" | "path" | "target" | "text";

interface ProtectMeCommandContextLike {
  cwd: string;
  mode: string;
  hasUI?: boolean;
  ui?: unknown;
  isProjectTrusted?: () => boolean;
}

interface ProtectMeCommandUI extends ProtectMePanelActionUI {
  custom<T>(
    factory: (
      tui: { requestRender(): void },
      theme: ProtectMePanelTheme,
      keybindings: unknown,
      done: (result: T) => void,
    ) => ProtectMePanelComponent,
  ): Promise<T>;
}

interface ProtectMePanelSetting {
  label: string;
  value: string;
  description: string;
  kind: SettingValueKind;
  action?: ProtectMePanelAction;
}

interface ProtectMePanelActionResult {
  status: ProtectMePanelActionStatus;
  message: string;
  nextWriteTarget?: ProtectMePanelWriteTarget;
}

interface ProtectMePanelStatusMessage {
  text: string;
  type: "error" | "info";
}

interface ProtectMePanelCategory {
  label: string;
  description: string;
  settings: ProtectMePanelSetting[];
}

export function createDefaultProtectMeCommandDependencies(): ProtectMeCommandDependencies {
  return {
    getHomeDir: homedir,
    loadConfig: loadProtectMeConfig,
    readRecentBlockedHosts,
    mutateProjectConfig: mutateProjectProtectMeConfig,
    mutateGlobalConfig: mutateGlobalProtectMeConfig,
  };
}

export function registerProtectMeCommand(
  pi: ExtensionAPI,
  dependencies: ProtectMeCommandDependencies = createDefaultProtectMeCommandDependencies(),
) {
  pi.registerCommand(PROTECTME_COMMAND_NAME, {
    description: "Show ProtectMe configuration state.",
    handler: async (_args, ctx) => {
      await handleProtectMeCommand(ctx, dependencies);
    },
  });
}

export async function handleProtectMeCommand(
  ctx: ProtectMeCommandContextLike,
  dependencies: ProtectMeCommandDependencies,
): Promise<boolean> {
  const ui = readCommandUI(ctx.ui);
  if (ctx.mode !== "tui" || !ui) {
    explainTuiRequirement(ctx.ui);
    return false;
  }

  const homeDir = dependencies.getHomeDir();
  const projectTrusted = readProjectTrusted(ctx);
  const config = await dependencies.loadConfig(buildProtectMeConfigLoadInput(ctx.cwd, homeDir, projectTrusted));
  const recentBlockedHosts = await dependencies.readRecentBlockedHosts(config.paths.blockedAttemptLogPath);
  const state = { config, recentBlockedHosts };
  const actionDependencies = buildProtectMePanelActionDependencies(ctx.cwd, homeDir, projectTrusted, ui, dependencies);

  await ui.custom<void>((tui, theme, _keybindings, done) => {
    return new ProtectMePanelComponent(state, theme, done, () => tui.requestRender(), actionDependencies);
  });

  return true;
}

export async function readRecentBlockedHosts(logPath: string, limit = MAX_RECENT_BLOCKED_HOSTS): Promise<string[]> {
  try {
    const text = await readFile(logPath, "utf8");
    return extractRecentBlockedHosts(text, limit);
  } catch (error) {
    if (isMissingFileError(error)) return [];
    return [];
  }
}

export function extractRecentBlockedHosts(jsonlText: string, limit = MAX_RECENT_BLOCKED_HOSTS): string[] {
  const hosts: string[] = [];
  const seenHosts = new Set<string>();
  const lines = jsonlText.trim().split("\n").filter(Boolean).reverse();

  for (const line of lines) {
    const host = readHostFromLogLine(line);
    if (!host || seenHosts.has(host)) continue;

    seenHosts.add(host);
    hosts.push(host);
    if (hosts.length >= limit) break;
  }

  return hosts;
}

export class ProtectMePanelComponent {
  private readonly state: ProtectMePanelState;
  private readonly theme: ProtectMePanelTheme;
  private readonly done: () => void;
  private readonly requestRender: () => void;
  private readonly actionDependencies: ProtectMePanelActionDependencies | undefined;
  private selectedSettingIndex = 0;
  private writeTarget: ProtectMePanelWriteTarget = DEFAULT_WRITE_TARGET;
  private actionInFlight = false;
  private statusMessage: ProtectMePanelStatusMessage | undefined;
  private cachedWidth: number | undefined;
  private cachedLines: string[] | undefined;

  constructor(
    state: ProtectMePanelState,
    theme: ProtectMePanelTheme,
    done: () => void,
    requestRender: () => void,
    actionDependencies?: ProtectMePanelActionDependencies,
  ) {
    this.state = state;
    this.theme = theme;
    this.done = done;
    this.requestRender = requestRender;
    this.actionDependencies = actionDependencies;
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || data === "q" || data === "Q") {
      this.done();
      return;
    }

    if (matchesKey(data, Key.up)) this.moveSelection(-1);
    if (matchesKey(data, Key.down)) this.moveSelection(1);
    if (matchesKey(data, Key.enter)) this.runSelectedAction();
    if (data === "p" || data === "P") this.setWriteTarget("project");
    if (data === "g" || data === "G") this.setWriteTarget("global");
    if (data === "m" || data === "M") this.runAction("toggleMode");
    if (data === "a" || data === "A") this.runAction("addEntry");
    if (data === "r" || data === "R") this.runAction("removeEntry");
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width);
    if (this.cachedLines && this.cachedWidth === safeWidth) return this.cachedLines;

    const lines = this.renderFresh(safeWidth);
    this.cachedWidth = safeWidth;
    this.cachedLines = lines.map((line) => fitLine(line, safeWidth));

    return this.cachedLines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  private moveSelection(delta: number): void {
    const settings = buildProtectMePanelSettings(this.state, this.writeTarget);
    const maxIndex = Math.max(0, settings.length - 1);
    this.selectedSettingIndex = clamp(this.selectedSettingIndex + delta, 0, maxIndex);
    this.invalidate();
    this.requestRender();
  }

  private renderFresh(width: number): string[] {
    if (width <= TINY_MODE_MAX_WIDTH) return renderTinyPanel(width, this.state, this.theme);
    if (width >= WIDE_MODE_MIN_WIDTH) {
      return renderWidePanel(width, this.state, this.selectedSettingIndex, this.writeTarget, this.statusMessage, this.theme);
    }

    return renderNarrowPanel(width, this.state, this.selectedSettingIndex, this.writeTarget, this.statusMessage, this.theme);
  }

  private runSelectedAction(): void {
    const settings = buildProtectMePanelSettings(this.state, this.writeTarget);
    const selectedSetting = settings[clamp(this.selectedSettingIndex, 0, Math.max(0, settings.length - 1))];
    if (!selectedSetting?.action) return;

    this.runAction(selectedSetting.action);
  }

  private runAction(action: ProtectMePanelAction): void {
    if (this.actionInFlight) return;
    if (!this.actionDependencies) {
      this.setStatus("Editing is unavailable in this panel instance.", "error");
      return;
    }

    this.actionInFlight = true;
    this.setStatus("Saving ProtectMe config…", "info");
    void this.performAction(action);
  }

  private async performAction(action: ProtectMePanelAction): Promise<void> {
    try {
      const result = await executeProtectMePanelAction(action, this.writeTarget, this.state, this.actionDependencies!);
      if (result.nextWriteTarget) this.writeTarget = result.nextWriteTarget;
      this.actionInFlight = false;
      this.setStatus(result.message, result.status === "error" ? "error" : "info");
    } catch (error) {
      this.actionInFlight = false;
      this.setStatus(`ProtectMe config edit failed: ${buildErrorMessage(error)}`, "error");
    }
  }

  private setWriteTarget(writeTarget: ProtectMePanelWriteTarget): void {
    this.writeTarget = writeTarget;
    this.setStatus(`Writing ${writeTarget} config.`, "info");
  }

  private setStatus(text: string, type: ProtectMePanelStatusMessage["type"]): void {
    this.statusMessage = { text, type };
    this.invalidate();
    this.requestRender();
  }
}

function buildProtectMePanelActionDependencies(
  cwd: string,
  homeDir: string,
  projectTrusted: boolean,
  ui: ProtectMeCommandUI,
  dependencies: ProtectMeCommandDependencies,
): ProtectMePanelActionDependencies {
  return {
    cwd,
    homeDir,
    projectTrusted,
    ui: readPanelActionUI(ui),
    loadConfig: dependencies.loadConfig,
    readRecentBlockedHosts: dependencies.readRecentBlockedHosts,
    mutateProjectConfig: dependencies.mutateProjectConfig,
    mutateGlobalConfig: dependencies.mutateGlobalConfig,
  };
}

function readPanelActionUI(value: unknown): ProtectMePanelActionUI | null {
  if (!isRecord(value)) return null;

  return value as ProtectMePanelActionUI;
}

async function executeProtectMePanelAction(
  action: ProtectMePanelAction,
  writeTarget: ProtectMePanelWriteTarget,
  state: ProtectMePanelState,
  dependencies: ProtectMePanelActionDependencies,
): Promise<ProtectMePanelActionResult> {
  if (action === "chooseWriteTarget") return chooseProtectMePanelWriteTarget(dependencies);
  if (action === "toggleMode") return toggleProtectMePanelMode(writeTarget, state, dependencies);
  if (action === "addEntry") return addProtectMePanelEntry(writeTarget, state, dependencies);

  return removeProtectMePanelEntry(writeTarget, state, dependencies);
}

async function chooseProtectMePanelWriteTarget(dependencies: ProtectMePanelActionDependencies): Promise<ProtectMePanelActionResult> {
  const ui = dependencies.ui;
  if (!hasPanelSelect(ui)) return failProtectMePanelAction(dependencies, "Write target selection is unavailable.");

  const choice = await ui.select("ProtectMe write target", WRITE_TARGET_CHOICES);
  if (!choice) return cancelProtectMePanelAction("Write target unchanged.");

  const nextWriteTarget = choice === GLOBAL_WRITE_TARGET_LABEL ? "global" : "project";
  notifyProtectMePanelInfo(dependencies, `ProtectMe will write ${nextWriteTarget} config.`);

  return {
    status: "success",
    message: `Writing ${nextWriteTarget} config.`,
    nextWriteTarget,
  };
}

async function toggleProtectMePanelMode(
  writeTarget: ProtectMePanelWriteTarget,
  state: ProtectMePanelState,
  dependencies: ProtectMePanelActionDependencies,
): Promise<ProtectMePanelActionResult> {
  const source = selectConfigSource(state.config, writeTarget);
  const unsafeResult = buildUnsafeSourceActionResult(source, dependencies);
  if (unsafeResult) return unsafeResult;

  const nextMode = getNextProtectMeMode(state.config.effective.mode);
  const mutation = (currentConfig: ProtectMeConfigFile) => buildConfigWithMode(currentConfig, nextMode);

  return saveProtectMePanelConfig(writeTarget, state, dependencies, mutation, `Saved ${writeTarget} mode ${nextMode}.`);
}

async function addProtectMePanelEntry(
  writeTarget: ProtectMePanelWriteTarget,
  state: ProtectMePanelState,
  dependencies: ProtectMePanelActionDependencies,
): Promise<ProtectMePanelActionResult> {
  const ui = dependencies.ui;
  if (!hasPanelEditor(ui)) return failProtectMePanelAction(dependencies, "Allow-list entry editor is unavailable.");

  const source = selectConfigSource(state.config, writeTarget);
  const unsafeResult = buildUnsafeSourceActionResult(source, dependencies);
  if (unsafeResult) return unsafeResult;

  const editedEntry = await ui.editor(`ProtectMe add ${writeTarget} allow-list entry`, buildAddEntryPrefill(state));
  if (editedEntry === undefined) return cancelProtectMePanelAction("Add entry cancelled.");

  const normalizedEntry = normalizeConfigAllowListEntry(editedEntry);
  if (!normalizedEntry) return failProtectMePanelAction(dependencies, `Invalid allow-list entry: ${JSON.stringify(editedEntry)}`);

  const mutation = (currentConfig: ProtectMeConfigFile) => appendAllowListEntry(currentConfig, normalizedEntry);

  return saveProtectMePanelConfig(writeTarget, state, dependencies, mutation, `Saved ${normalizedEntry} to ${writeTarget} config.`);
}

async function removeProtectMePanelEntry(
  writeTarget: ProtectMePanelWriteTarget,
  state: ProtectMePanelState,
  dependencies: ProtectMePanelActionDependencies,
): Promise<ProtectMePanelActionResult> {
  const ui = dependencies.ui;
  if (!hasPanelSelect(ui)) return failProtectMePanelAction(dependencies, "Allow-list entry selection is unavailable.");

  const source = selectConfigSource(state.config, writeTarget);
  const unsafeResult = buildUnsafeSourceActionResult(source, dependencies);
  if (unsafeResult) return unsafeResult;

  const entries = normalizeConfigAllowList(source.config?.allowList ?? []);
  if (entries.length === 0) return cancelProtectMePanelAction(`No ${writeTarget} entries to remove.`);

  const selectedEntry = await ui.select(`ProtectMe remove ${writeTarget} allow-list entry`, entries);
  if (!selectedEntry) return cancelProtectMePanelAction("Remove entry cancelled.");

  const mutation = (currentConfig: ProtectMeConfigFile) => removeAllowListEntry(currentConfig, selectedEntry);

  return saveProtectMePanelConfig(writeTarget, state, dependencies, mutation, `Removed ${selectedEntry} from ${writeTarget} config.`);
}

function hasPanelSelect(ui: ProtectMePanelActionUI | null): ui is ProtectMePanelActionUI & { select: NonNullable<ProtectMePanelActionUI["select"]> } {
  return typeof ui?.select === "function";
}

function hasPanelEditor(ui: ProtectMePanelActionUI | null): ui is ProtectMePanelActionUI & { editor: NonNullable<ProtectMePanelActionUI["editor"]> } {
  return typeof ui?.editor === "function";
}

function selectConfigSource(config: ProtectMeConfigLoadResult, writeTarget: ProtectMePanelWriteTarget): ParsedProtectMeConfig {
  if (writeTarget === "project") return config.projectConfig;

  return config.globalConfig;
}

function buildUnsafeSourceActionResult(
  configSource: ParsedProtectMeConfig,
  dependencies: ProtectMePanelActionDependencies,
): ProtectMePanelActionResult | null {
  const message = buildUnsafeConfigSourceMessage(configSource);
  if (!message) return null;

  return failProtectMePanelAction(dependencies, message);
}

function buildUnsafeConfigSourceMessage(configSource: ParsedProtectMeConfig): string | null {
  if (configSource.status !== "invalid" && configSource.status !== "unreadable" && configSource.status !== "ignored") return null;

  const detail = configSource.message ? `: ${configSource.message}` : "";

  return `${configSource.source} config is ${configSource.status}${detail}`;
}

function getNextProtectMeMode(mode: ProtectMeMode): ProtectMeMode {
  return mode === "block" ? "allow" : "block";
}

function buildConfigWithMode(config: ProtectMeConfigFile, mode: ProtectMeMode): ProtectMeConfigFile {
  const nextConfig: ProtectMeConfigFile = { mode };
  if (config.allowList) nextConfig.allowList = config.allowList;

  return nextConfig;
}

function appendAllowListEntry(config: ProtectMeConfigFile, normalizedEntry: string): ProtectMeConfigFile {
  const rawAllowList = config.allowList ?? [];
  const normalizedAllowList = normalizeConfigAllowList(rawAllowList);
  const allowList = normalizedAllowList.includes(normalizedEntry) ? rawAllowList : [...rawAllowList, normalizedEntry];

  return buildConfigWithAllowList(config, allowList);
}

function removeAllowListEntry(config: ProtectMeConfigFile, normalizedEntry: string): ProtectMeConfigFile {
  const rawAllowList = config.allowList ?? [];
  const allowList = rawAllowList.filter((entry) => normalizeConfigAllowListEntry(entry) !== normalizedEntry);

  return buildConfigWithAllowList(config, allowList);
}

function buildConfigWithAllowList(config: ProtectMeConfigFile, allowList: string[]): ProtectMeConfigFile {
  const nextConfig: ProtectMeConfigFile = { allowList };
  if (config.mode) nextConfig.mode = config.mode;

  return nextConfig;
}

function buildAddEntryPrefill(state: ProtectMePanelState): string {
  const recentBlockedHost = state.recentBlockedHosts[0];
  if (!recentBlockedHost) return "";

  const suggestion = suggestCleanAllowListEntry(recentBlockedHost);

  return suggestion.suggestedEntry ?? normalizeConfigAllowListEntry(recentBlockedHost) ?? recentBlockedHost;
}

async function saveProtectMePanelConfig(
  writeTarget: ProtectMePanelWriteTarget,
  state: ProtectMePanelState,
  dependencies: ProtectMePanelActionDependencies,
  mutation: ProtectMeConfigMutation,
  successMessage: string,
): Promise<ProtectMePanelActionResult> {
  try {
    await mutateTargetConfig(writeTarget, state.config, dependencies, mutation);
    await refreshProtectMePanelState(state, dependencies);
    notifyProtectMePanelInfo(dependencies, successMessage);

    return { status: "success", message: successMessage };
  } catch (error) {
    const message = `Failed to write ${writeTarget} config: ${buildErrorMessage(error)}`;

    return failProtectMePanelAction(dependencies, message);
  }
}

async function mutateTargetConfig(
  writeTarget: ProtectMePanelWriteTarget,
  config: ProtectMeConfigLoadResult,
  dependencies: ProtectMePanelActionDependencies,
  mutation: ProtectMeConfigMutation,
): Promise<void> {
  if (writeTarget === "project") {
    await dependencies.mutateProjectConfig(config.paths, mutation);
    return;
  }

  await dependencies.mutateGlobalConfig(config.paths, mutation);
}

async function refreshProtectMePanelState(
  state: ProtectMePanelState,
  dependencies: ProtectMePanelActionDependencies,
): Promise<void> {
  const config = await dependencies.loadConfig(
    buildProtectMeConfigLoadInput(dependencies.cwd, dependencies.homeDir, dependencies.projectTrusted ?? true),
  );
  const recentBlockedHosts = await dependencies.readRecentBlockedHosts(config.paths.blockedAttemptLogPath);

  state.config = config;
  state.recentBlockedHosts = recentBlockedHosts;
}

function cancelProtectMePanelAction(message: string): ProtectMePanelActionResult {
  return { status: "cancelled", message };
}

function failProtectMePanelAction(dependencies: ProtectMePanelActionDependencies, message: string): ProtectMePanelActionResult {
  notifyProtectMePanelError(dependencies, message);

  return { status: "error", message };
}

function notifyProtectMePanelInfo(dependencies: ProtectMePanelActionDependencies, message: string): void {
  dependencies.ui?.notify?.(message, "info");
}

function notifyProtectMePanelError(dependencies: ProtectMePanelActionDependencies, message: string): void {
  dependencies.ui?.notify?.(`ProtectMe config edit failed: ${message}`, "error");
}

function buildErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;

  return String(error);
}

function readCommandUI(value: unknown): ProtectMeCommandUI | null {
  if (!isRecord(value)) return null;
  if (typeof value.custom !== "function") return null;

  return value as unknown as ProtectMeCommandUI;
}

function explainTuiRequirement(ui: unknown): void {
  if (!isRecord(ui)) return;
  if (typeof ui.notify !== "function") return;

  ui.notify(REQUIRED_TUI_MESSAGE, "warning");
}

function buildProtectMeConfigLoadInput(cwd: string, homeDir: string, projectTrusted: boolean): ProtectMeConfigPathInput {
  if (projectTrusted) return { cwd, homeDir };

  return { cwd, homeDir, projectTrusted: false };
}

function readProjectTrusted(ctx: ProtectMeCommandContextLike): boolean {
  if (typeof ctx.isProjectTrusted !== "function") return true;

  return ctx.isProjectTrusted();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function readHostFromLogLine(line: string): string | null {
  try {
    const value = JSON.parse(line) as unknown;
    if (!isRecord(value) || typeof value.host !== "string") return null;

    return sanitizeCellText(value.host);
  } catch {
    return null;
  }
}

function renderWidePanel(
  width: number,
  state: ProtectMePanelState,
  selectedSettingIndex: number,
  writeTarget: ProtectMePanelWriteTarget,
  statusMessage: ProtectMePanelStatusMessage | undefined,
  theme: ProtectMePanelTheme,
): string[] {
  const leftPaneWidth = Math.min(22, Math.max(16, Math.floor(width * 0.27)));
  const rightPaneWidth = Math.max(10, width - leftPaneWidth - 3);
  const categories = buildProtectMePanelCategories(state, writeTarget);
  const rightRows = renderSettingsRows(rightPaneWidth, state, selectedSettingIndex, writeTarget, theme);
  const bodyHeight = Math.max(categories.length, rightRows.length, 8);
  const lines = [renderTopBorder(width, PANEL_TITLE, buildScopeLabel(state), theme)];

  lines.push(renderFrameLine(width, buildSourceLine(state, writeTarget), theme));
  lines.push(renderFrameLine(width, "↑↓ move  Enter action  p/g target  q quit", theme));
  lines.push(renderWideSeparator(leftPaneWidth, rightPaneWidth, "┬", theme));

  for (let index = 0; index < bodyHeight; index += 1) {
    lines.push(renderWideBodyLine(leftPaneWidth, rightPaneWidth, renderCategoryCell(categories, index, theme), rightRows[index] ?? "", theme));
  }

  lines.push(renderWideSeparator(leftPaneWidth, rightPaneWidth, "┴", theme));
  lines.push(renderFrameLine(width, buildFooterText(state, selectedSettingIndex, writeTarget, statusMessage), theme));
  lines.push(renderBottomBorder(width, theme));

  return lines;
}

function renderNarrowPanel(
  width: number,
  state: ProtectMePanelState,
  selectedSettingIndex: number,
  writeTarget: ProtectMePanelWriteTarget,
  statusMessage: ProtectMePanelStatusMessage | undefined,
  theme: ProtectMePanelTheme,
): string[] {
  const innerWidth = width - 2;
  const rows = renderSettingsRows(innerWidth, state, selectedSettingIndex, writeTarget, theme);
  const bodyHeight = Math.max(rows.length, 8);
  const lines = [renderTopBorder(width, PANEL_TITLE, buildScopeLabel(state), theme)];

  lines.push(renderFrameLine(width, buildSourceLine(state, writeTarget), theme));
  lines.push(renderFrameLine(width, "↑↓ move  Enter action  p/g target  q quit", theme));
  lines.push(renderNarrowSeparator(width, theme));

  for (let index = 0; index < bodyHeight; index += 1) lines.push(renderFrameLine(width, rows[index] ?? "", theme));

  lines.push(renderNarrowSeparator(width, theme));
  lines.push(renderFrameLine(width, buildFooterText(state, selectedSettingIndex, writeTarget, statusMessage), theme));
  lines.push(renderBottomBorder(width, theme));

  return lines;
}

function renderTinyPanel(width: number, state: ProtectMePanelState, theme: ProtectMePanelTheme): string[] {
  const config = state.config;

  return [
    fitLine(theme.fg("accent", EXTENSION_DISPLAY_NAME), width),
    fitLine(`mode ${config.effective.mode}`, width),
    fitLine(`sites ${config.effective.allowList.length}`, width),
    fitLine("q quit", width),
  ];
}

function buildProtectMePanelCategories(state: ProtectMePanelState, writeTarget: ProtectMePanelWriteTarget): ProtectMePanelCategory[] {
  return [
    {
      label: "Configuration",
      description: "Current ProtectMe configuration state.",
      settings: buildProtectMePanelSettings(state, writeTarget),
    },
  ];
}

function buildProtectMePanelSettings(state: ProtectMePanelState, writeTarget: ProtectMePanelWriteTarget): ProtectMePanelSetting[] {
  const config = state.config;

  return [
    {
      label: "Effective mode",
      value: config.effective.mode,
      description: `Enter toggles ${writeTarget} mode between block and allow.`,
      kind: "mode",
      action: "toggleMode",
    },
    {
      label: "Write target",
      value: writeTarget,
      description: "Choose whether edits save to project or global config.",
      kind: "target",
      action: "chooseWriteTarget",
    },
    {
      label: "Add allow-list entry",
      value: `to ${writeTarget}`,
      description: `Add a cleaned editable host entry to ${writeTarget} config.`,
      kind: "action",
      action: "addEntry",
    },
    {
      label: "Remove allow-list entry",
      value: `${writeTarget} (${countTargetSites(config, writeTarget)})`,
      description: `Remove a host entry from ${writeTarget} config.`,
      kind: "action",
      action: "removeEntry",
    },
    {
      label: "Global config path",
      value: config.paths.globalConfigPath,
      description: "Global ProtectMe config path.",
      kind: "path",
    },
    {
      label: "Project config path",
      value: config.paths.projectConfigPath,
      description: "Project ProtectMe config path.",
      kind: "path",
    },
    {
      label: "Global site count",
      value: String(countConfigSites(config.globalConfig.config?.allowList)),
      description: "Normalized allow-list entry count from global config.",
      kind: "count",
    },
    {
      label: "Project site count",
      value: String(countConfigSites(config.projectConfig.config?.allowList)),
      description: "Normalized allow-list entry count from project config.",
      kind: "count",
    },
    {
      label: "Effective site count",
      value: String(config.effective.allowList.length),
      description: "Normalized effective allow-list entry count.",
      kind: "count",
    },
    {
      label: "Recent blocked hosts",
      value: formatRecentBlockedHosts(state.recentBlockedHosts),
      description: "Most recent blocked hosts recorded in the ProtectMe log.",
      kind: "text",
    },
  ];
}

function countTargetSites(config: ProtectMeConfigLoadResult, writeTarget: ProtectMePanelWriteTarget): number {
  return countConfigSites(selectConfigSource(config, writeTarget).config?.allowList);
}

function countConfigSites(allowList: string[] | undefined): number {
  if (!allowList) return 0;

  return normalizeConfigAllowList(allowList).length;
}

function formatRecentBlockedHosts(hosts: string[]): string {
  if (hosts.length === 0) return "none";

  return hosts.join(", ");
}

function renderSettingsRows(
  paneWidth: number,
  state: ProtectMePanelState,
  selectedSettingIndex: number,
  writeTarget: ProtectMePanelWriteTarget,
  theme: ProtectMePanelTheme,
): string[] {
  const settings = buildProtectMePanelSettings(state, writeTarget);
  const safeSelectedIndex = clamp(selectedSettingIndex, 0, Math.max(0, settings.length - 1));
  const windowStart = calculateWindowStart(settings.length, safeSelectedIndex);
  const visibleSettings = settings.slice(windowStart, windowStart + MAX_VISIBLE_SETTINGS);
  const counter = buildCounter(safeSelectedIndex, settings.length);
  const rows = [renderSettingsHeader(paneWidth, "Configuration", counter, theme)];

  for (let index = 0; index < visibleSettings.length; index += 1) {
    const settingIndex = windowStart + index;
    rows.push(renderSettingRow(paneWidth, visibleSettings[index]!, settingIndex === safeSelectedIndex, theme));
  }

  return rows;
}

function renderSettingsHeader(paneWidth: number, title: string, counter: string, theme: ProtectMePanelTheme): string {
  const safeWidth = Math.max(0, paneWidth);
  const styledCounter = theme.fg("dim", counter);
  const counterWidth = visibleWidth(counter);
  const titleWidth = Math.max(0, safeWidth - counterWidth - 1);
  const styledTitle = theme.fg("accent", theme.bold(fitLine(title.toUpperCase(), titleWidth)));
  const gap = Math.max(1, safeWidth - visibleWidth(styledTitle) - visibleWidth(styledCounter));

  return fitLine(`${styledTitle}${" ".repeat(gap)}${styledCounter}`, safeWidth);
}

function renderSettingRow(paneWidth: number, setting: ProtectMePanelSetting, selected: boolean, theme: ProtectMePanelTheme): string {
  const safeWidth = Math.max(0, paneWidth);
  const valueWidth = Math.max(0, Math.min(28, Math.floor(safeWidth * 0.4)));
  const labelWidth = Math.max(1, safeWidth - 2 - 1 - valueWidth);
  const prefix = selected ? theme.fg("accent", "▶ ") : "  ";
  const label = styleSettingLabel(fitLine(setting.label, labelWidth), selected, theme);
  const value = styleSettingValue(fitValue(setting.value, valueWidth, setting.kind), setting, theme);
  const labelPadding = " ".repeat(Math.max(0, labelWidth - visibleWidth(label)));
  const valuePadding = " ".repeat(Math.max(0, valueWidth - visibleWidth(value)));

  return fitLine(`${prefix}${label}${labelPadding} ${valuePadding}${value}`, safeWidth);
}

function styleSettingLabel(label: string, selected: boolean, theme: ProtectMePanelTheme): string {
  if (!selected) return label;

  return theme.fg("accent", theme.bold(label));
}

function styleSettingValue(value: string, setting: ProtectMePanelSetting, theme: ProtectMePanelTheme): string {
  if (setting.kind === "mode" && value === "allow") return theme.fg("success", value);
  if (setting.kind === "mode" && value === "block") return theme.fg("warning", value);
  if (setting.kind === "target") return theme.fg("accent", value);
  if (setting.kind === "action") return theme.fg("muted", value);
  if (value === "none") return theme.fg("dim", value);

  return value;
}

function renderCategoryCell(categories: ProtectMePanelCategory[], index: number, theme: ProtectMePanelTheme): string {
  const category = categories[index];
  if (!category) return "";

  return `${theme.fg("accent", "▶ ")}${theme.fg("accent", theme.bold(category.label))}`;
}

function buildFooterText(
  state: ProtectMePanelState,
  selectedSettingIndex: number,
  writeTarget: ProtectMePanelWriteTarget,
  statusMessage: ProtectMePanelStatusMessage | undefined,
): string {
  const settings = buildProtectMePanelSettings(state, writeTarget);
  const selectedSetting = settings[clamp(selectedSettingIndex, 0, Math.max(0, settings.length - 1))];
  const footer = selectedSetting
    ? `${buildCounter(selectedSettingIndex, settings.length)} • ${selectedSetting.description}`
    : "0/0 • Current ProtectMe configuration state.";

  if (!statusMessage) return footer;

  return `${statusMessage.text} • ${footer}`;
}

function buildCounter(selectedIndex: number, count: number): string {
  if (count === 0) return "0/0";

  return `${clamp(selectedIndex, 0, count - 1) + 1}/${count}`;
}

function calculateWindowStart(count: number, selectedIndex: number): number {
  if (count <= MAX_VISIBLE_SETTINGS) return 0;

  const centeredStart = selectedIndex - Math.floor(MAX_VISIBLE_SETTINGS / 2);
  return clamp(centeredStart, 0, count - MAX_VISIBLE_SETTINGS);
}

function buildSourceLine(state: ProtectMePanelState, writeTarget: ProtectMePanelWriteTarget): string {
  const projectStatus = formatIgnoredProjectConfigStatus(state.config);

  return `writes ${writeTarget} config • effective ${state.config.effective.mode}${projectStatus}`;
}

function buildScopeLabel(state: ProtectMePanelState): string {
  return `${state.config.effective.mode} mode`;
}

function formatIgnoredProjectConfigStatus(config: ProtectMeConfigLoadResult): string {
  if (config.projectConfig.status !== "ignored") return "";

  return " • project config ignored";
}

function renderTopBorder(width: number, title: string, scope: string, theme: ProtectMePanelTheme): string {
  const innerWidth = Math.max(0, width - 2);
  const leftText = `─ ${sanitizeCellText(title)} `;
  const rightText = ` ${sanitizeCellText(scope)} ─`;
  const fillWidth = innerWidth - visibleWidth(leftText) - visibleWidth(rightText);
  const inner = fillWidth >= 0 ? `${leftText}${"─".repeat(fillWidth)}${rightText}` : fitLine(`${leftText}${rightText}`, innerWidth, "─");

  return theme.fg("accent", `╭${inner}╮`);
}

function renderBottomBorder(width: number, theme: ProtectMePanelTheme): string {
  return theme.fg("accent", `╰${"─".repeat(Math.max(0, width - 2))}╯`);
}

function renderNarrowSeparator(width: number, theme: ProtectMePanelTheme): string {
  return theme.fg("accent", `├${"─".repeat(Math.max(0, width - 2))}┤`);
}

function renderWideSeparator(leftPaneWidth: number, rightPaneWidth: number, junction: "┬" | "┴", theme: ProtectMePanelTheme): string {
  return theme.fg("accent", `├${"─".repeat(leftPaneWidth)}${junction}${"─".repeat(rightPaneWidth)}┤`);
}

function renderFrameLine(width: number, content: string, theme: ProtectMePanelTheme): string {
  return `${theme.fg("accent", "│")}${fitLine(content, Math.max(0, width - 2))}${theme.fg("accent", "│")}`;
}

function renderWideBodyLine(
  leftPaneWidth: number,
  rightPaneWidth: number,
  leftContent: string,
  rightContent: string,
  theme: ProtectMePanelTheme,
): string {
  return [
    theme.fg("accent", "│"),
    fitLine(leftContent, leftPaneWidth),
    theme.fg("accent", "│"),
    fitLine(rightContent, rightPaneWidth),
    theme.fg("accent", "│"),
  ].join("");
}

function fitValue(value: string, width: number, kind: SettingValueKind): string {
  if (kind === "path") return fitTail(value, width);

  return fitLine(sanitizeCellText(value), width);
}

function fitTail(value: string, width: number): string {
  const sanitizedValue = sanitizeCellText(value);
  if (visibleWidth(sanitizedValue) <= width) return sanitizedValue;
  if (width <= 0) return "";
  if (width === 1) return "…";

  return `…${sliceTailToWidth(sanitizedValue, width - 1)}`;
}

function fitLine(value: string, width: number, ellipsis = "…"): string {
  const safeWidth = Math.max(0, width);
  if (safeWidth === 0) return "";

  const clipped = truncateToWidth(value, safeWidth, ellipsis);
  const padding = Math.max(0, safeWidth - visibleWidth(clipped));

  return `${clipped}${" ".repeat(padding)}`;
}

function sliceTailToWidth(value: string, width: number): string {
  let tail = value;

  while (visibleWidth(tail) > width && tail.length > 0) tail = tail.slice(1);

  return tail;
}

function sanitizeCellText(value: string): string {
  let sanitizedValue = "";

  for (const character of value) sanitizedValue += isControlCharacter(character) ? " " : character;

  return sanitizedValue.trim();
}

function isControlCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0;

  return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
