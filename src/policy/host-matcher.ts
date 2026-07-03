import {
  buildPublicSuffixHostWarning,
  isChildSubdomainHostKind,
  isExactOnlyHostKind,
  isPublicSuffixDnsHost,
  isSingleLabelDnsHost,
  normalizeHostInput,
  type HostNormalizationWarning,
  type NormalizedHostKind,
} from "./host-normalization.ts";

export interface NormalizedAllowListEntry {
  input: string;
  host: string;
  kind: NormalizedHostKind;
}

export interface NormalizedAllowListResult {
  entries: string[];
  normalizedEntries: NormalizedAllowListEntry[];
  warnings: HostNormalizationWarning[];
}

export interface HostMatchResult {
  allowed: boolean;
  host: string | null;
  matchedEntry: string | null;
  warnings: HostNormalizationWarning[];
}

export function normalizeAllowListEntries(entries: string[]): NormalizedAllowListResult {
  const normalizedEntries: NormalizedAllowListEntry[] = [];
  const warnings: HostNormalizationWarning[] = [];
  const seenHosts = new Set<string>();

  for (const entry of entries) {
    const result = normalizeHostInput(entry);
    warnings.push(...result.warnings);
    if (!result.host || !result.kind || seenHosts.has(result.host)) continue;
    if (isPublicSuffixDnsHost(result.host, result.kind)) {
      warnings.push(buildPublicSuffixHostWarning(entry));
      continue;
    }

    seenHosts.add(result.host);
    normalizedEntries.push({ input: entry, host: result.host, kind: result.kind });
  }

  return {
    entries: normalizedEntries.map((entry) => entry.host),
    normalizedEntries,
    warnings,
  };
}

export function isHostAllowed(hostOrUrl: string, allowList: string[]): boolean {
  return matchAllowedHost(hostOrUrl, allowList).allowed;
}

export function matchAllowedHost(hostOrUrl: string, allowList: string[]): HostMatchResult {
  const requestHost = normalizeHostInput(hostOrUrl);
  const normalizedAllowList = normalizeAllowListEntries(allowList);
  const warnings = [...requestHost.warnings, ...normalizedAllowList.warnings];

  if (!requestHost.host || !requestHost.kind) {
    return {
      allowed: false,
      host: null,
      matchedEntry: null,
      warnings,
    };
  }

  for (const allowEntry of normalizedAllowList.normalizedEntries) {
    if (!doesAllowEntryMatchHost(requestHost.host, requestHost.kind, allowEntry.host, allowEntry.kind)) continue;

    return {
      allowed: true,
      host: requestHost.host,
      matchedEntry: allowEntry.host,
      warnings,
    };
  }

  return {
    allowed: false,
    host: requestHost.host,
    matchedEntry: null,
    warnings,
  };
}

export function doesAllowEntryMatchHost(
  requestHost: string,
  requestKind: NormalizedHostKind,
  allowHost: string,
  allowKind: NormalizedHostKind,
): boolean {
  if (requestHost === allowHost) return true;
  if (isExactOnlyHostKind(allowKind) || isExactOnlyHostKind(requestKind)) return false;
  if (!isChildSubdomainHostKind(allowKind)) return false;
  if (isSingleLabelDnsHost(allowHost, allowKind)) return false;
  if (isPublicSuffixDnsHost(allowHost, allowKind)) return false;

  return requestHost.endsWith(`.${allowHost}`);
}
