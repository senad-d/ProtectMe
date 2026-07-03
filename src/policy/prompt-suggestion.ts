import { getDomain } from "tldts";

import { normalizeHostInput, type HostNormalizationWarning, type NormalizedHostKind } from "./host-normalization.ts";

export type PromptSuggestionSource = "registrable_domain" | "exact_host" | "invalid";

export interface CleanPromptSuggestion {
  input: string;
  blockedHost: string | null;
  suggestedEntry: string | null;
  editable: boolean;
  source: PromptSuggestionSource;
  warnings: HostNormalizationWarning[];
}

export function suggestCleanAllowListEntry(input: string): CleanPromptSuggestion {
  const normalizedHost = normalizeHostInput(input);
  if (!normalizedHost.host || !normalizedHost.kind) {
    return {
      input,
      blockedHost: null,
      suggestedEntry: null,
      editable: false,
      source: "invalid",
      warnings: normalizedHost.warnings,
    };
  }

  const registrableDomain = detectRegistrableDomain(normalizedHost.host, normalizedHost.kind);
  if (registrableDomain) {
    return buildPromptSuggestion(input, normalizedHost.host, registrableDomain, "registrable_domain", normalizedHost.warnings);
  }

  return buildPromptSuggestion(input, normalizedHost.host, normalizedHost.host, "exact_host", normalizedHost.warnings);
}

function detectRegistrableDomain(host: string, kind: NormalizedHostKind): string | null {
  if (kind !== "dns" || !host.includes(".")) return null;

  try {
    return getDomain(host, {
      allowPrivateDomains: true,
      detectIp: false,
      extractHostname: false,
      validateHostname: true,
    });
  } catch {
    return null;
  }
}

function buildPromptSuggestion(
  input: string,
  blockedHost: string,
  suggestedEntry: string,
  source: PromptSuggestionSource,
  warnings: HostNormalizationWarning[],
): CleanPromptSuggestion {
  return {
    input,
    blockedHost,
    suggestedEntry,
    editable: true,
    source,
    warnings,
  };
}
