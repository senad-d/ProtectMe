import type {
  ProtectMeConfigFile,
  ProtectMeConfigLoadResult,
  ProtectMeConfigMutation,
  ProtectMeConfigPathInput,
  ProtectMeConfigSource,
} from "../../config/index.ts";

export interface ProtectMeCommandDependencies {
  getHomeDir(): string;
  getAgentDir(): string;
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
  setStatus?(key: string, text: string | undefined): void;
  notify?(message: string, type?: "info" | "warning" | "error"): void;
}

export interface ProtectMePanelActionDependencies extends Omit<ProtectMeCommandDependencies, "getHomeDir" | "getAgentDir"> {
  cwd: string;
  homeDir: string;
  agentDir: string;
  projectTrusted?: boolean;
  ui: ProtectMePanelActionUI | null;
}

export interface ProtectMePanelSetting {
  label: string;
  value: string;
  description: string;
  kind: SettingValueKind;
  action?: ProtectMePanelAction;
}

export interface ProtectMePanelActionResult {
  status: ProtectMePanelActionStatus;
  message: string;
  nextWriteTarget?: ProtectMePanelWriteTarget;
}

export interface ProtectMePanelStatusMessage {
  text: string;
  type: "error" | "info";
}

export interface ProtectMePanelCategory {
  label: string;
  description: string;
  settings: ProtectMePanelSetting[];
}

export type ProtectMePanelWriteTarget = ProtectMeConfigSource;
export type ProtectMeThemeRole = "accent" | "dim" | "muted" | "success" | "warning";
export type ProtectMePanelAction = "addEntry" | "chooseWriteTarget" | "removeEntry" | "toggleMode";
export type ProtectMePanelActionStatus = "cancelled" | "error" | "success";
export type SettingValueKind = "action" | "count" | "mode" | "path" | "target" | "text";
