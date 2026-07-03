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
 * Placeholder for future ProtectMe policy setup.
 *
 * Bash request extraction and runtime policy registration are implemented by
 * later tasks. This hook intentionally registers no runtime behavior yet.
 */
export function registerProtectMePolicy(_pi: ExtensionAPI) {
  // No policy runtime behavior is registered in the scaffold task.
}
