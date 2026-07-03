import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export {
  createDefaultEffectiveProtectMeConfig,
  createMissingProtectMeConfigSource,
  resolveMissingProtectMeConfig,
} from "./config-defaults.ts";
export {
  loadProtectMeConfig,
  mergeProtectMeConfigs,
  normalizeConfigAllowList,
  normalizeConfigAllowListEntry,
  parseProtectMeConfigText,
  readProtectMeConfigSource,
  writeGlobalProtectMeConfig,
  writeProjectProtectMeConfig,
  writeProtectMeConfigFile,
} from "./config-loader.ts";
export {
  resolveBlockedAttemptLogPath,
  resolveGlobalConfigPath,
  resolveProjectConfigPath,
  resolveProtectMeConfigPaths,
} from "./config-paths.ts";
export {
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
 * Placeholder for future ProtectMe config setup.
 *
 * Config parsing, merging, and write-back are implemented by later tasks. This
 * hook intentionally registers no runtime behavior yet.
 */
export function registerProtectMeConfig(_pi: ExtensionAPI) {
  // No config runtime behavior is registered in the scaffold task.
}
