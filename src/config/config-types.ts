export const PROTECTME_MODES = ["block", "allow"] as const;
export const PROTECTME_CONFIG_SOURCES = ["global", "project"] as const;
export const PROTECTME_CONFIG_STATUSES = ["missing", "valid", "invalid", "unreadable", "ignored"] as const;
export const DEFAULT_PROTECTME_MODE: ProtectMeMode = "block";
export const DEFAULT_PROTECTME_ALLOW_LIST = [
  "localhost",
  "127.0.0.1",
  "::1",
  "pi.dev",
  "github.com",
  "npmjs.com",
  "registry.npmjs.org",
  "nodejs.org",
] as const;

export type ProtectMeMode = (typeof PROTECTME_MODES)[number];
export type ProtectMeConfigSource = (typeof PROTECTME_CONFIG_SOURCES)[number];
export type ProtectMeConfigStatus = (typeof PROTECTME_CONFIG_STATUSES)[number];
export type ProtectMeModeSource = ProtectMeConfigSource | "default";

export interface ProtectMeConfig {
  mode: ProtectMeMode;
  allowList: string[];
}

export interface ProtectMeConfigFile {
  mode?: ProtectMeMode;
  allowList?: string[];
}

export interface ProtectMeConfigSourceMetadata {
  source: ProtectMeConfigSource;
  path: string;
  status: ProtectMeConfigStatus;
  message?: string;
}

export interface ParsedProtectMeConfig extends ProtectMeConfigSourceMetadata {
  config: ProtectMeConfigFile | null;
}

export interface EffectiveProtectMeConfig extends ProtectMeConfig {
  modeSource: ProtectMeModeSource;
  allowListSources: ProtectMeConfigSource[];
  configSources: ParsedProtectMeConfig[];
  warnings: string[];
}

export interface ProtectMeConfigPathSummary {
  cwd?: string;
  homeDir?: string;
  agentDir?: string;
  globalConfigPath: string;
  projectConfigPath: string;
  blockedAttemptLogPath: string;
}

export interface ProtectMeConfigLoadResult {
  paths: ProtectMeConfigPathSummary;
  globalConfig: ParsedProtectMeConfig;
  projectConfig: ParsedProtectMeConfig;
  effective: EffectiveProtectMeConfig;
}

export function createDefaultProtectMeConfig(): ProtectMeConfig {
  return {
    mode: DEFAULT_PROTECTME_MODE,
    allowList: [...DEFAULT_PROTECTME_ALLOW_LIST],
  };
}
