import { Key, matchesKey } from "@earendil-works/pi-tui";

import { normalizeConfigAllowListEntry, type ProtectMeMode } from "../../config/index.ts";
import { suggestCleanAllowListEntry } from "../../policy/index.ts";
import { saveProtectMePanelAllowListEntry, saveProtectMePanelMode } from "./actions.ts";
import {
  buildProtectMePanelSettings,
  clamp,
  renderProtectMePanel,
  renderProtectMePanelDialog,
} from "./rendering.ts";
import type {
  ProtectMePanelActionDependencies,
  ProtectMePanelActionResult,
  ProtectMePanelDialog,
  ProtectMePanelState,
  ProtectMePanelStatusMessage,
  ProtectMePanelTheme,
  ProtectMePanelWriteTarget,
} from "./types.ts";

const DEFAULT_WRITE_TARGET: ProtectMePanelWriteTarget = "project";
const SAVE_PROJECT_VALUE = "save-project";
const SAVE_GLOBAL_VALUE = "save-global";
const CANCEL_VALUE = "cancel";
const CONFIRM_DIALOG_OPTION_COUNT = 3;

type ProtectMePanelView = EntryConfirmView | EntryInputView | MainView | ModeConfirmView | RecentHostsView;

interface MainView {
  kind: "main";
}

interface ModeConfirmView {
  kind: "modeConfirm";
  nextMode: ProtectMeMode;
  selectedOptionIndex: number;
}

interface EntryInputView {
  kind: "entryInput";
  value: string;
}

interface EntryConfirmView {
  kind: "entryConfirm";
  entry: string;
  selectedOptionIndex: number;
}

interface RecentHostsView {
  kind: "recentHosts";
}

export class ProtectMePanelComponent {
  private readonly state: ProtectMePanelState;
  private readonly theme: ProtectMePanelTheme;
  private readonly done: () => void;
  private readonly requestRender: () => void;
  private readonly actionDependencies: ProtectMePanelActionDependencies | undefined;
  private selectedSettingIndex = 0;
  private readonly writeTarget: ProtectMePanelWriteTarget = DEFAULT_WRITE_TARGET;
  private actionInFlight = false;
  private statusMessage: ProtectMePanelStatusMessage | undefined;
  private cachedWidth: number | undefined;
  private cachedLines: string[] | undefined;
  private view: ProtectMePanelView = { kind: "main" };

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
    if (this.view.kind === "main") {
      this.handleMainInput(data);
      return;
    }

    if (this.view.kind === "modeConfirm") {
      this.handleModeConfirmInput(data, this.view);
      return;
    }

    if (this.view.kind === "entryInput") {
      this.handleEntryInput(data, this.view);
      return;
    }

    if (this.view.kind === "entryConfirm") {
      this.handleEntryConfirmInput(data, this.view);
      return;
    }

    if (this.view.kind === "recentHosts") this.handleRecentHostsInput(data);
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width);
    if (this.cachedLines && this.cachedWidth === safeWidth) return this.cachedLines;

    this.cachedWidth = safeWidth;
    this.cachedLines = this.renderFresh(safeWidth);

    return this.cachedLines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  private renderFresh(width: number): string[] {
    if (this.view.kind === "main") {
      return renderProtectMePanel(width, this.state, this.selectedSettingIndex, this.writeTarget, this.statusMessage, this.theme);
    }

    return renderProtectMePanelDialog(width, this.state, buildDialog(this.view, this.state), this.statusMessage, this.theme);
  }

  private handleMainInput(data: string): void {
    if (isCancelInput(data) || isQuitInput(data)) {
      this.done();
      return;
    }

    if (matchesKey(data, Key.up)) this.moveSelection(-1);
    if (matchesKey(data, Key.down)) this.moveSelection(1);
    if (matchesKey(data, Key.enter)) this.runSelectedAction();
  }

  private handleModeConfirmInput(data: string, view: ModeConfirmView): void {
    if (isCancelInput(data)) {
      this.cancelToMain("Mode change cancelled.");
      return;
    }

    if (isQuitInput(data)) {
      this.done();
      return;
    }

    if (matchesKey(data, Key.up)) this.moveDialogOption(view, -1);
    if (matchesKey(data, Key.down)) this.moveDialogOption(view, 1);
    if (matchesKey(data, Key.enter)) this.resolveModeConfirmation(view);
  }

  private handleEntryInput(data: string, view: EntryInputView): void {
    if (isCancelInput(data)) {
      this.cancelToMain("Allow-list edit cancelled.");
      return;
    }

    if (matchesKey(data, Key.enter)) {
      this.reviewEntryInput(view);
      return;
    }

    if (matchesKey(data, Key.backspace)) {
      this.updateEntryInput(view.value.slice(0, -1));
      return;
    }

    this.appendEntryInput(data, view);
  }

  private handleEntryConfirmInput(data: string, view: EntryConfirmView): void {
    if (isCancelInput(data)) {
      this.cancelToMain("Allow-list edit cancelled.");
      return;
    }

    if (isQuitInput(data)) {
      this.done();
      return;
    }

    if (matchesKey(data, Key.up)) this.moveDialogOption(view, -1);
    if (matchesKey(data, Key.down)) this.moveDialogOption(view, 1);
    if (matchesKey(data, Key.enter)) this.resolveEntryConfirmation(view);
  }

  private handleRecentHostsInput(data: string): void {
    if (isCancelInput(data) || matchesKey(data, Key.enter)) {
      this.returnToMain();
      return;
    }

    if (isQuitInput(data)) this.done();
  }

  private moveSelection(delta: number): void {
    const settings = buildProtectMePanelSettings(this.state, this.writeTarget);
    const maxIndex = Math.max(0, settings.length - 1);
    this.selectedSettingIndex = clamp(this.selectedSettingIndex + delta, 0, maxIndex);
    this.invalidate();
    this.requestRender();
  }

  private runSelectedAction(): void {
    const settings = buildProtectMePanelSettings(this.state, this.writeTarget);
    const selectedSetting = settings[clamp(this.selectedSettingIndex, 0, Math.max(0, settings.length - 1))];
    if (!selectedSetting?.action) return;

    if (selectedSetting.action === "toggleMode") this.startModeConfirmation();
    if (selectedSetting.action === "addEntry") this.startEntryEditor();
    if (selectedSetting.action === "showRecentBlockedHosts") this.openRecentHosts();
  }

  private startModeConfirmation(): void {
    this.statusMessage = undefined;
    this.view = {
      kind: "modeConfirm",
      nextMode: getNextProtectMeMode(this.state.config.effective.mode),
      selectedOptionIndex: 0,
    };
    this.invalidateAndRender();
  }

  private startEntryEditor(): void {
    this.statusMessage = undefined;
    this.view = {
      kind: "entryInput",
      value: buildAddEntryPrefill(this.state),
    };
    this.invalidateAndRender();
  }

  private openRecentHosts(): void {
    this.statusMessage = undefined;
    this.view = { kind: "recentHosts" };
    this.invalidateAndRender();
  }

  private moveDialogOption(view: EntryConfirmView | ModeConfirmView, delta: number): void {
    view.selectedOptionIndex = clamp(view.selectedOptionIndex + delta, 0, CONFIRM_DIALOG_OPTION_COUNT - 1);
    this.invalidateAndRender();
  }

  private resolveModeConfirmation(view: ModeConfirmView): void {
    const target = readConfirmDialogWriteTarget(view.selectedOptionIndex);
    if (!target) {
      this.cancelToMain("Mode change cancelled.");
      return;
    }

    this.saveModeChange(target, view.nextMode);
  }

  private reviewEntryInput(view: EntryInputView): void {
    const entry = normalizeConfigAllowListEntry(view.value);
    if (!entry) {
      this.setStatus(`Invalid allow-list entry: ${JSON.stringify(view.value)}`, "error");
      return;
    }

    this.statusMessage = undefined;
    this.view = {
      kind: "entryConfirm",
      entry,
      selectedOptionIndex: 0,
    };
    this.invalidateAndRender();
  }

  private resolveEntryConfirmation(view: EntryConfirmView): void {
    const target = readConfirmDialogWriteTarget(view.selectedOptionIndex);
    if (!target) {
      this.cancelToMain("Allow-list edit cancelled.");
      return;
    }

    this.saveAllowListEntry(target, view.entry);
  }

  private saveModeChange(writeTarget: ProtectMePanelWriteTarget, nextMode: ProtectMeMode): void {
    if (!this.startSave()) return;

    void this.performModeSave(writeTarget, nextMode);
  }

  private saveAllowListEntry(writeTarget: ProtectMePanelWriteTarget, entry: string): void {
    if (!this.startSave()) return;

    void this.performEntrySave(writeTarget, entry);
  }

  private startSave(): boolean {
    if (this.actionInFlight) return false;
    if (!this.actionDependencies) {
      this.setStatus("Editing is unavailable in this panel instance.", "error");
      return false;
    }

    this.actionInFlight = true;
    this.setStatus("Saving ProtectMe config…", "info");

    return true;
  }

  private async performModeSave(writeTarget: ProtectMePanelWriteTarget, nextMode: ProtectMeMode): Promise<void> {
    try {
      const result = await saveProtectMePanelMode(writeTarget, this.state, this.actionDependencies!, nextMode);
      this.finishAction(result);
    } catch (error) {
      this.failAction(error);
    }
  }

  private async performEntrySave(writeTarget: ProtectMePanelWriteTarget, entry: string): Promise<void> {
    try {
      const result = await saveProtectMePanelAllowListEntry(writeTarget, this.state, this.actionDependencies!, entry);
      this.finishAction(result);
    } catch (error) {
      this.failAction(error);
    }
  }

  private finishAction(result: ProtectMePanelActionResult): void {
    this.actionInFlight = false;
    this.returnToMain(result.message, result.status === "error" ? "error" : "info");
  }

  private failAction(error: unknown): void {
    this.actionInFlight = false;
    this.returnToMain(`ProtectMe config edit failed: ${buildErrorMessage(error)}`, "error");
  }

  private appendEntryInput(data: string, view: EntryInputView): void {
    const text = extractPrintableInput(data);
    if (!text) return;

    this.updateEntryInput(`${view.value}${text}`);
  }

  private updateEntryInput(value: string): void {
    this.statusMessage = undefined;
    this.view = { kind: "entryInput", value };
    this.invalidateAndRender();
  }

  private cancelToMain(message: string): void {
    this.returnToMain(message, "info");
  }

  private returnToMain(text?: string, type: ProtectMePanelStatusMessage["type"] = "info"): void {
    this.view = { kind: "main" };
    this.selectedSettingIndex = 0;
    this.statusMessage = text ? { text, type } : undefined;
    this.invalidateAndRender();
  }

  private setStatus(text: string, type: ProtectMePanelStatusMessage["type"]): void {
    this.statusMessage = { text, type };
    this.invalidateAndRender();
  }

  private invalidateAndRender(): void {
    this.invalidate();
    this.requestRender();
  }
}

function buildDialog(view: ProtectMePanelView, state: ProtectMePanelState): ProtectMePanelDialog {
  if (view.kind === "modeConfirm") return buildModeConfirmDialog(view, state);
  if (view.kind === "entryInput") return buildEntryInputDialog(view);
  if (view.kind === "entryConfirm") return buildEntryConfirmDialog(view);
  if (view.kind === "recentHosts") return buildRecentHostsDialog(state);

  return buildEntryInputDialog({ kind: "entryInput", value: "" });
}

function buildModeConfirmDialog(view: ModeConfirmView, state: ProtectMePanelState): ProtectMePanelDialog {
  return {
    title: "Confirm mode change",
    lines: [
      `Switch effective mode from ${state.config.effective.mode} to ${view.nextMode}?`,
      "Choose the config file to save before confirmation.",
    ],
    footer: "↑↓ choose • Enter confirm • Esc cancel",
    options: [
      { label: `Save ${view.nextMode} to project config`, value: SAVE_PROJECT_VALUE },
      { label: `Save ${view.nextMode} to global config`, value: SAVE_GLOBAL_VALUE },
      { label: "Cancel", value: CANCEL_VALUE },
    ],
    selectedOptionIndex: view.selectedOptionIndex,
  };
}

function buildEntryInputDialog(view: EntryInputView): ProtectMePanelDialog {
  return {
    title: "Edit allow-list entry",
    lines: ["Add a host to an allow-list.", "Entry is normalized before saving."],
    footer: "Type host • Enter review • Esc cancel",
    input: view.value,
    inputLabel: "Host",
  };
}

function buildEntryConfirmDialog(view: EntryConfirmView): ProtectMePanelDialog {
  return {
    title: "Confirm allow-list entry",
    lines: [`Save ${view.entry} to which allow-list?`, "No file is changed until you choose a config and confirm."],
    footer: "↑↓ choose • Enter confirm • Esc cancel",
    options: [
      { label: `Save ${view.entry} to project config`, value: SAVE_PROJECT_VALUE },
      { label: `Save ${view.entry} to global config`, value: SAVE_GLOBAL_VALUE },
      { label: "Cancel", value: CANCEL_VALUE },
    ],
    selectedOptionIndex: view.selectedOptionIndex,
  };
}

function buildRecentHostsDialog(state: ProtectMePanelState): ProtectMePanelDialog {
  return {
    title: "Recent blocked hosts",
    lines: buildRecentHostLines(state.recentBlockedHosts),
    footer: "Enter/Esc back • q quit",
  };
}

function readConfirmDialogWriteTarget(selectedOptionIndex: number): ProtectMePanelWriteTarget | null {
  if (selectedOptionIndex === 0) return "project";
  if (selectedOptionIndex === 1) return "global";

  return null;
}

function buildRecentHostLines(hosts: string[]): string[] {
  if (hosts.length === 0) return ["No blocked attempts logged."];

  return hosts.map(formatRecentHostLine);
}

function formatRecentHostLine(host: string, index: number): string {
  return `${index + 1}. ${host}`;
}

function buildAddEntryPrefill(state: ProtectMePanelState): string {
  const recentBlockedHost = state.recentBlockedHosts[0];
  if (!recentBlockedHost) return "";

  const suggestion = suggestCleanAllowListEntry(recentBlockedHost);

  return suggestion.suggestedEntry ?? normalizeConfigAllowListEntry(recentBlockedHost) ?? recentBlockedHost;
}

function getNextProtectMeMode(mode: ProtectMeMode): ProtectMeMode {
  return mode === "block" ? "allow" : "block";
}

function extractPrintableInput(data: string): string {
  let text = "";

  for (const character of data) {
    if (isPrintableCharacter(character)) text += character;
  }

  return text;
}

function isPrintableCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0;

  return codePoint >= 32 && codePoint !== 127;
}

function isCancelInput(data: string): boolean {
  return matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"));
}

function isQuitInput(data: string): boolean {
  return data === "q" || data === "Q";
}

function buildErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;

  return String(error);
}
