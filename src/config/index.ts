import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export {
  appendProtectMeConfigAllowListEntry,
  buildProtectMeConfigEditSourceError,
  planProtectMeConfigAllowListAppend,
  readProtectMeConfigSourceAllowListEntries,
  removeProtectMeConfigAllowListEntry,
  selectProtectMeConfigEditSource,
  setProtectMeConfigMode,
} from "./config-edit.ts";
export type { ProtectMeAllowListEntryEditPlan, ProtectMeConfigEditTarget } from "./config-edit.ts";
export {
  createDefaultEffectiveProtectMeConfig,
  createMissingProtectMeConfigSource,
  resolveMissingProtectMeConfig,
} from "./config-defaults.ts";
export {
  ensureGlobalProtectMeConfig,
  loadProtectMeConfig,
  loadProtectMeConfigWithGlobalDefault,
  mergeProtectMeConfigs,
  mutateGlobalProtectMeConfig,
  mutateProjectProtectMeConfig,
  mutateProtectMeConfigFile,
  normalizeConfigAllowList,
  normalizeConfigAllowListEntry,
  parseProtectMeConfigText,
  readProtectMeConfigSource,
  writeGlobalProtectMeConfig,
  writeProjectProtectMeConfig,
  writeProtectMeConfigFile,
} from "./config-loader.ts";
export type { ProtectMeConfigMutation } from "./config-loader.ts";
export {
  resolveBlockedAttemptLogPath,
  resolveDefaultAgentDir,
  resolveGlobalConfigPath,
  resolveProjectConfigPath,
  resolveProtectMeConfigPaths,
} from "./config-paths.ts";
export {
  DEFAULT_PROTECTME_ALLOW_LIST,
  DEFAULT_PROTECTME_MODE,
  PROTECTME_CONFIG_SOURCES,
  PROTECTME_CONFIG_STATUSES,
  PROTECTME_MODES,
  createDefaultProtectMeConfig,
} from "./config-types.ts";
export type { ProtectMeConfigPathInput, ProtectMeConfigPaths } from "./config-paths.ts";
export type {
  EffectiveProtectMeConfig,
  ParsedProtectMeConfig,
  ProtectMeConfig,
  ProtectMeConfigFile,
  ProtectMeConfigLoadResult,
  ProtectMeConfigPathSummary,
  ProtectMeConfigSource,
  ProtectMeConfigSourceMetadata,
  ProtectMeConfigStatus,
  ProtectMeMode,
  ProtectMeModeSource,
} from "./config-types.ts";

/**
 * Register the ProtectMe config helper module with the composition root.
 *
 * Config parsing, merging, path resolution, and write-back are exposed as pure
 * helpers above. This module has no Pi runtime hooks to attach at startup.
 */
export function registerProtectMeConfig(_pi: ExtensionAPI) {
  // Config helpers are imported by runtime modules; no Pi hooks are required here.
}
