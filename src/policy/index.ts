import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export {
  SUPPORTED_BASH_NETWORK_CLIS,
  extractBashNetworkRequestCandidates,
  extractToolCallNetworkRequestCandidates,
  splitBashCommandSegments,
  tokenizeBashSegment,
} from "./bash-url-extractor.ts";
export {
  buildProtectMeBlockReason,
  buildProtectMeConfigWriteFailedBlockReason,
  buildProtectMeFirstBlockGuidance,
  buildProtectMePromptDeniedBlockReason,
  buildProtectMePromptErrorBlockReason,
  buildProtectMePromptUnavailableBlockReason,
  buildProtectMeUnsupportedNetworkOptionBlockReason,
} from "./block-message.ts";
export {
  buildPublicSuffixHostWarning,
  isChildSubdomainHostKind,
  isExactOnlyHostKind,
  isPublicSuffixDnsHost,
  isSingleLabelDnsHost,
  normalizeHostInput,
} from "./host-normalization.ts";
export {
  doesAllowEntryMatchHost,
  isHostAllowed,
  matchAllowedHost,
  normalizeAllowListEntries,
} from "./host-matcher.ts";
export { suggestCleanAllowListEntry } from "./prompt-suggestion.ts";
export type { BashNetworkRequestCandidate, SupportedBashNetworkCli } from "./bash-url-extractor.ts";
export type {
  HostNormalizationResult,
  HostNormalizationWarning,
  HostNormalizationWarningReason,
  NormalizedHostKind,
} from "./host-normalization.ts";
export type { HostMatchResult, NormalizedAllowListEntry, NormalizedAllowListResult } from "./host-matcher.ts";
export type { CleanPromptSuggestion, PromptSuggestionSource } from "./prompt-suggestion.ts";

/**
 * Register the ProtectMe policy helper module with the composition root.
 *
 * Bash request extraction, host normalization, allow-list matching, and prompt
 * suggestions are exposed as pure helpers above. This module has no Pi runtime
 * hooks to attach at startup.
 */
export function registerProtectMePolicy(_pi: ExtensionAPI) {
  // Policy helpers are imported by runtime modules; no Pi hooks are required here.
}
