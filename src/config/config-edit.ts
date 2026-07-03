import { normalizeConfigAllowList, normalizeConfigAllowListEntry } from "./config-loader.ts";
import type {
  ParsedProtectMeConfig,
  ProtectMeConfigFile,
  ProtectMeConfigLoadResult,
  ProtectMeConfigSource,
  ProtectMeMode,
} from "./config-types.ts";

export type ProtectMeConfigEditTarget = ProtectMeConfigSource;

export type ProtectMeAllowListEntryEditPlan =
  | {
      ok: true;
      entry: string;
    }
  | {
      ok: false;
      reason: string;
    };

export function selectProtectMeConfigEditSource(
  config: ProtectMeConfigLoadResult,
  target: ProtectMeConfigEditTarget,
): ParsedProtectMeConfig {
  if (target === "project") return config.projectConfig;

  return config.globalConfig;
}

export function buildProtectMeConfigEditSourceError(configSource: ParsedProtectMeConfig): string | null {
  if (configSource.status !== "invalid" && configSource.status !== "unreadable" && configSource.status !== "ignored") return null;

  const detail = configSource.message ? `: ${configSource.message}` : "";

  return `${configSource.source} config is ${configSource.status}${detail}`;
}

export function planProtectMeConfigAllowListAppend(
  configSource: ParsedProtectMeConfig,
  editedEntry: string | undefined,
): ProtectMeAllowListEntryEditPlan {
  if (editedEntry === undefined) return { ok: false, reason: "No allow-list entry was confirmed." };

  const sourceError = buildProtectMeConfigEditSourceError(configSource);
  if (sourceError) return { ok: false, reason: sourceError };

  const normalizedEntry = normalizeConfigAllowListEntry(editedEntry);
  if (!normalizedEntry) return { ok: false, reason: `Invalid allow-list entry: ${JSON.stringify(editedEntry)}` };

  return {
    ok: true,
    entry: normalizedEntry,
  };
}

export function readProtectMeConfigSourceAllowListEntries(configSource: ParsedProtectMeConfig): string[] {
  return normalizeConfigAllowList(configSource.config?.allowList ?? []);
}

export function setProtectMeConfigMode(config: ProtectMeConfigFile, mode: ProtectMeMode): ProtectMeConfigFile {
  const nextConfig: ProtectMeConfigFile = { mode };
  if (config.allowList) nextConfig.allowList = config.allowList;

  return nextConfig;
}

export function appendProtectMeConfigAllowListEntry(config: ProtectMeConfigFile, entry: string): ProtectMeConfigFile {
  const rawAllowList = config.allowList ?? [];
  const normalizedEntry = normalizeConfigAllowListEntry(entry);
  if (!normalizedEntry) return buildProtectMeConfigWithAllowList(config, rawAllowList);

  const normalizedAllowList = normalizeConfigAllowList(rawAllowList);
  const allowList = normalizedAllowList.includes(normalizedEntry) ? rawAllowList : [...rawAllowList, normalizedEntry];

  return buildProtectMeConfigWithAllowList(config, allowList);
}

export function removeProtectMeConfigAllowListEntry(config: ProtectMeConfigFile, entry: string): ProtectMeConfigFile {
  const rawAllowList = config.allowList ?? [];
  const normalizedEntry = normalizeConfigAllowListEntry(entry);
  if (!normalizedEntry) return buildProtectMeConfigWithAllowList(config, rawAllowList);

  const allowList = rawAllowList.filter((allowListEntry) => normalizeConfigAllowListEntry(allowListEntry) !== normalizedEntry);

  return buildProtectMeConfigWithAllowList(config, allowList);
}

function buildProtectMeConfigWithAllowList(config: ProtectMeConfigFile, allowList: string[]): ProtectMeConfigFile {
  const nextConfig: ProtectMeConfigFile = { allowList };
  if (config.mode) nextConfig.mode = config.mode;

  return nextConfig;
}
