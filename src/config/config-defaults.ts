import type { ProtectMeConfigPaths } from "./config-paths.ts";
import {
  DEFAULT_PROTECTME_MODE,
  type EffectiveProtectMeConfig,
  type ParsedProtectMeConfig,
  type ProtectMeConfigLoadResult,
  type ProtectMeConfigSource,
} from "./config-types.ts";

export function createMissingProtectMeConfigSource(source: ProtectMeConfigSource, path: string): ParsedProtectMeConfig {
  return {
    source,
    path,
    status: "missing",
    config: null,
  };
}

export function createDefaultEffectiveProtectMeConfig(
  configSources: ParsedProtectMeConfig[] = [],
): EffectiveProtectMeConfig {
  return {
    mode: DEFAULT_PROTECTME_MODE,
    allowList: [],
    modeSource: "default",
    allowListSources: [],
    configSources,
    warnings: [],
  };
}

export function resolveMissingProtectMeConfig(paths: ProtectMeConfigPaths): ProtectMeConfigLoadResult {
  const globalConfig = createMissingProtectMeConfigSource("global", paths.globalConfigPath);
  const projectConfig = createMissingProtectMeConfigSource("project", paths.projectConfigPath);

  return {
    paths,
    globalConfig,
    projectConfig,
    effective: createDefaultEffectiveProtectMeConfig([globalConfig, projectConfig]),
  };
}
