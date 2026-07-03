import { homedir } from "node:os";

import { getAgentDir as getPiAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  loadProtectMeConfigWithGlobalDefault,
  mutateGlobalProtectMeConfig,
  mutateProjectProtectMeConfig,
  type ProtectMeConfigPathInput,
} from "../config/index.ts";
import { PROTECTME_COMMAND_NAME } from "../constants.ts";
import { readRecentBlockedHosts } from "../logging/blocked-attempt-log.ts";
import { ProtectMePanelComponent } from "./protectme-panel/component.ts";
import type {
  ProtectMeCommandDependencies,
  ProtectMePanelActionDependencies,
  ProtectMePanelActionUI,
  ProtectMePanelTheme,
} from "./protectme-panel/types.ts";

export { ProtectMePanelComponent } from "./protectme-panel/component.ts";
export { executeProtectMePanelAction } from "./protectme-panel/actions.ts";
export { buildProtectMePanelSettings, fitLine, renderProtectMePanel } from "./protectme-panel/rendering.ts";
export type {
  ProtectMeCommandDependencies,
  ProtectMePanelActionDependencies,
  ProtectMePanelActionResult,
  ProtectMePanelActionUI,
  ProtectMePanelState,
  ProtectMePanelTheme,
  ProtectMePanelWriteTarget,
} from "./protectme-panel/types.ts";
export { extractRecentBlockedHosts, readRecentBlockedHosts } from "../logging/blocked-attempt-log.ts";

const REQUIRED_TUI_MESSAGE = "/protectme requires Pi TUI mode.";

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

export function createDefaultProtectMeCommandDependencies(): ProtectMeCommandDependencies {
  return {
    getHomeDir: homedir,
    getAgentDir: getPiAgentDir,
    loadConfig: loadProtectMeConfigWithGlobalDefault,
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
  const agentDir = dependencies.getAgentDir();
  const projectTrusted = readProjectTrusted(ctx);
  const config = await dependencies.loadConfig(buildProtectMeConfigLoadInput(ctx.cwd, homeDir, agentDir, projectTrusted));
  const recentBlockedHosts = await dependencies.readRecentBlockedHosts(config.paths.blockedAttemptLogPath);
  const state = { config, recentBlockedHosts };
  const actionDependencies = buildProtectMePanelActionDependencies(ctx.cwd, homeDir, agentDir, projectTrusted, ui, dependencies);

  await ui.custom<void>((tui, theme, _keybindings, done) => {
    return new ProtectMePanelComponent(state, theme, done, () => tui.requestRender(), actionDependencies);
  });

  return true;
}

function buildProtectMePanelActionDependencies(
  cwd: string,
  homeDir: string,
  agentDir: string,
  projectTrusted: boolean,
  ui: ProtectMeCommandUI,
  dependencies: ProtectMeCommandDependencies,
): ProtectMePanelActionDependencies {
  return {
    cwd,
    homeDir,
    agentDir,
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

function buildProtectMeConfigLoadInput(cwd: string, homeDir: string, agentDir: string, projectTrusted: boolean): ProtectMeConfigPathInput {
  if (projectTrusted) return { cwd, homeDir, agentDir };

  return { cwd, homeDir, agentDir, projectTrusted: false };
}

function readProjectTrusted(ctx: ProtectMeCommandContextLike): boolean {
  if (typeof ctx.isProjectTrusted !== "function") return true;

  return ctx.isProjectTrusted();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
