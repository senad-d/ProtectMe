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
  return { ...config, mode };
}

export function appendProtectMeConfigAllowListEntry(config: ProtectMeConfigFile, entry: string): ProtectMeConfigFile {
  return appendProtectMeConfigListEntry(config, "allowList", entry);
}

export function appendProtectMeConfigListEntry(
  config: ProtectMeConfigFile,
  list: "allowList" | "denyList",
  entry: string,
): ProtectMeConfigFile {
  const rawList = config[list] ?? [];
  const normalizedEntry = normalizeConfigAllowListEntry(entry);
  if (!normalizedEntry || normalizeConfigAllowList(rawList).includes(normalizedEntry)) return { ...config, [list]: rawList };

  return { ...config, [list]: [...rawList, normalizedEntry] };
}

export function removeProtectMeConfigAllowListEntry(config: ProtectMeConfigFile, entry: string): ProtectMeConfigFile {
  const rawAllowList = config.allowList ?? [];
  const normalizedEntry = normalizeConfigAllowListEntry(entry);
  if (!normalizedEntry) return { ...config, allowList: rawAllowList };

  return { ...config, allowList: rawAllowList.filter((allowListEntry) => normalizeConfigAllowListEntry(allowListEntry) !== normalizedEntry) };
}
