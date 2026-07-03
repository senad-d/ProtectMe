import { Key, matchesKey } from "@earendil-works/pi-tui";

import { executeProtectMePanelAction } from "./actions.ts";
import { buildProtectMePanelSettings, clamp, renderProtectMePanel } from "./rendering.ts";
import type {
  ProtectMePanelAction,
  ProtectMePanelActionDependencies,
  ProtectMePanelState,
  ProtectMePanelStatusMessage,
  ProtectMePanelTheme,
  ProtectMePanelWriteTarget,
} from "./types.ts";

const DEFAULT_WRITE_TARGET: ProtectMePanelWriteTarget = "project";

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

    this.cachedWidth = safeWidth;
    this.cachedLines = renderProtectMePanel(safeWidth, this.state, this.selectedSettingIndex, this.writeTarget, this.statusMessage, this.theme);

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

function buildErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;

  return String(error);
}
