import {
  appendProtectMeConfigAllowListEntry,
  buildProtectMeConfigEditSourceError,
  normalizeConfigAllowListEntry,
  planProtectMeConfigAllowListAppend,
  readProtectMeConfigSourceAllowListEntries,
  removeProtectMeConfigAllowListEntry,
  selectProtectMeConfigEditSource,
  setProtectMeConfigMode,
  type ParsedProtectMeConfig,
  type ProtectMeConfigFile,
  type ProtectMeConfigMutation,
  type ProtectMeConfigPathInput,
  type ProtectMeMode,
} from "../../config/index.ts";
import { syncProtectMeSessionStatus } from "../../events/protectme-session-status.ts";
import { suggestCleanAllowListEntry } from "../../policy/index.ts";
import type {
  ProtectMePanelAction,
  ProtectMePanelActionDependencies,
  ProtectMePanelActionResult,
  ProtectMePanelActionUI,
  ProtectMePanelState,
  ProtectMePanelWriteTarget,
} from "./types.ts";

const PROJECT_WRITE_TARGET_LABEL = "Project config";
const GLOBAL_WRITE_TARGET_LABEL = "Global config";
const WRITE_TARGET_CHOICES = [PROJECT_WRITE_TARGET_LABEL, GLOBAL_WRITE_TARGET_LABEL];

export async function executeProtectMePanelAction(
  action: ProtectMePanelAction,
  writeTarget: ProtectMePanelWriteTarget,
  state: ProtectMePanelState,
  dependencies: ProtectMePanelActionDependencies,
): Promise<ProtectMePanelActionResult> {
  if (action === "chooseWriteTarget") return chooseProtectMePanelWriteTarget(dependencies);
  if (action === "toggleMode") return toggleProtectMePanelMode(writeTarget, state, dependencies);
  if (action === "addEntry") return addProtectMePanelEntry(writeTarget, state, dependencies);
  if (action === "removeEntry") return removeProtectMePanelEntry(writeTarget, state, dependencies);

  return cancelProtectMePanelAction("Recent blocked hosts opened.");
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
  return saveProtectMePanelMode(writeTarget, state, dependencies, getNextProtectMeMode(state.config.effective.mode));
}

async function addProtectMePanelEntry(
  writeTarget: ProtectMePanelWriteTarget,
  state: ProtectMePanelState,
  dependencies: ProtectMePanelActionDependencies,
): Promise<ProtectMePanelActionResult> {
  const ui = dependencies.ui;
  if (!hasPanelEditor(ui)) return failProtectMePanelAction(dependencies, "Allow-list entry editor is unavailable.");

  const source = selectProtectMeConfigEditSource(state.config, writeTarget);
  const unsafeResult = buildUnsafeSourceActionResult(source, dependencies);
  if (unsafeResult) return unsafeResult;

  const editedEntry = await ui.editor(`ProtectMe add ${writeTarget} allow-list entry`, buildAddEntryPrefill(state));
  if (editedEntry === undefined) return cancelProtectMePanelAction("Add entry cancelled.");

  return saveProtectMePanelAllowListEntry(writeTarget, state, dependencies, editedEntry);
}

async function removeProtectMePanelEntry(
  writeTarget: ProtectMePanelWriteTarget,
  state: ProtectMePanelState,
  dependencies: ProtectMePanelActionDependencies,
): Promise<ProtectMePanelActionResult> {
  const ui = dependencies.ui;
  if (!hasPanelSelect(ui)) return failProtectMePanelAction(dependencies, "Allow-list entry selection is unavailable.");

  const source = selectProtectMeConfigEditSource(state.config, writeTarget);
  const unsafeResult = buildUnsafeSourceActionResult(source, dependencies);
  if (unsafeResult) return unsafeResult;

  const entries = readProtectMeConfigSourceAllowListEntries(source);
  if (entries.length === 0) return cancelProtectMePanelAction(`No ${writeTarget} entries to remove.`);

  const selectedEntry = await ui.select(`ProtectMe remove ${writeTarget} allow-list entry`, entries);
  if (!selectedEntry) return cancelProtectMePanelAction("Remove entry cancelled.");

  const mutation = (currentConfig: ProtectMeConfigFile) => removeProtectMeConfigAllowListEntry(currentConfig, selectedEntry);

  return saveProtectMePanelConfig(writeTarget, state, dependencies, mutation, `Removed ${selectedEntry} from ${writeTarget} config.`);
}

export async function saveProtectMePanelMode(
  writeTarget: ProtectMePanelWriteTarget,
  state: ProtectMePanelState,
  dependencies: ProtectMePanelActionDependencies,
  nextMode: ProtectMeMode,
): Promise<ProtectMePanelActionResult> {
  const source = selectProtectMeConfigEditSource(state.config, writeTarget);
  const unsafeResult = buildUnsafeSourceActionResult(source, dependencies);
  if (unsafeResult) return unsafeResult;

  const mutation = (currentConfig: ProtectMeConfigFile) => setProtectMeConfigMode(currentConfig, nextMode);

  return saveProtectMePanelConfig(writeTarget, state, dependencies, mutation, `Saved ${writeTarget} mode ${nextMode}.`);
}

export async function saveProtectMePanelAllowListEntry(
  writeTarget: ProtectMePanelWriteTarget,
  state: ProtectMePanelState,
  dependencies: ProtectMePanelActionDependencies,
  editedEntry: string | undefined,
): Promise<ProtectMePanelActionResult> {
  const source = selectProtectMeConfigEditSource(state.config, writeTarget);
  const unsafeResult = buildUnsafeSourceActionResult(source, dependencies);
  if (unsafeResult) return unsafeResult;

  const appendPlan = planProtectMeConfigAllowListAppend(source, editedEntry);
  if (!appendPlan.ok) return failProtectMePanelAction(dependencies, appendPlan.reason);

  const mutation = (currentConfig: ProtectMeConfigFile) => appendProtectMeConfigAllowListEntry(currentConfig, appendPlan.entry);

  return saveProtectMePanelConfig(writeTarget, state, dependencies, mutation, `Saved ${appendPlan.entry} to ${writeTarget} config.`);
}

function hasPanelSelect(ui: ProtectMePanelActionUI | null): ui is ProtectMePanelActionUI & { select: NonNullable<ProtectMePanelActionUI["select"]> } {
  return typeof ui?.select === "function";
}

function hasPanelEditor(ui: ProtectMePanelActionUI | null): ui is ProtectMePanelActionUI & { editor: NonNullable<ProtectMePanelActionUI["editor"]> } {
  return typeof ui?.editor === "function";
}

function buildUnsafeSourceActionResult(
  configSource: ParsedProtectMeConfig,
  dependencies: ProtectMePanelActionDependencies,
): ProtectMePanelActionResult | null {
  const message = buildProtectMeConfigEditSourceError(configSource);
  if (!message) return null;

  return failProtectMePanelAction(dependencies, message);
}

function getNextProtectMeMode(mode: ProtectMeMode): ProtectMeMode {
  return mode === "block" ? "allow" : "block";
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
    syncProtectMeSessionStatus(dependencies.ui, state.config);
    notifyProtectMePanelInfo(dependencies, successMessage);

    return { status: "success", message: successMessage };
  } catch (error) {
    const message = `Failed to write ${writeTarget} config: ${buildErrorMessage(error)}`;

    return failProtectMePanelAction(dependencies, message);
  }
}

async function mutateTargetConfig(
  writeTarget: ProtectMePanelWriteTarget,
  config: ProtectMePanelState["config"],
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
    buildProtectMeConfigLoadInput(dependencies.cwd, dependencies.homeDir, dependencies.agentDir, dependencies.projectTrusted ?? true),
  );
  const recentBlockedHosts = await dependencies.readRecentBlockedHosts(config.paths.blockedAttemptLogPath);

  state.config = config;
  state.recentBlockedHosts = recentBlockedHosts;
}

function buildProtectMeConfigLoadInput(cwd: string, homeDir: string, agentDir: string, projectTrusted: boolean): ProtectMeConfigPathInput {
  if (projectTrusted) return { cwd, homeDir, agentDir };

  return { cwd, homeDir, agentDir, projectTrusted: false };
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
