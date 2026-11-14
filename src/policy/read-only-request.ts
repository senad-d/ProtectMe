import { tokenizeBashSegment, type BashNetworkRequestCandidate } from "./bash-url-extractor.ts";

// Long options that send a body or pick the method: --data*, --form*, --upload-file,
// --request, --json (curl); --post-data, --post-file, --method, --body-* (wget).
const SENDING_LONG_OPTION = /^--(?:data|form|upload|request|json|post|method|body)/u;
// curl's short forms -d, -F, -T and -X, alone or inside a cluster such as -sSd.
const SENDING_CURL_SHORT_OPTION = /^-[A-Za-z]*[dFTX]/u;

/**
 * True when a curl or wget request only fetches: no body, form, upload or method
 * option. A session may allow such reads from unlisted hosts (session reads); a
 * request that sends data never qualifies and keeps the per-host prompt. Anything
 * unsure is not read-only: other CLIs, uninspectable options, and a curl short
 * option that merely contains one of the sending letters.
 */
export function isReadOnlyRequest(candidate: BashNetworkRequestCandidate): boolean {
  if (candidate.unsupportedReason || (candidate.cli !== "curl" && candidate.cli !== "wget")) return false;

  for (const token of tokenizeBashSegment(candidate.segment)) {
    if (SENDING_LONG_OPTION.test(token)) return false;
    if (candidate.cli === "curl" && !token.startsWith("--") && SENDING_CURL_SHORT_OPTION.test(token)) return false;
  }

  return true;
}
