import { isIP } from "node:net";

import { parse } from "tldts";

export type NormalizedHostKind = "dns" | "ip" | "localhost";
export type HostNormalizationWarningReason = "empty" | "parse_failed" | "invalid_host" | "public_suffix";

export interface HostNormalizationWarning {
  input: string;
  reason: HostNormalizationWarningReason;
  message: string;
}

export interface HostNormalizationResult {
  input: string;
  host: string | null;
  kind: NormalizedHostKind | null;
  warnings: HostNormalizationWarning[];
}

export function normalizeHostInput(input: string): HostNormalizationResult {
  const trimmedInput = input.trim();
  if (trimmedInput.length === 0) return buildHostNormalizationFailure(input, "empty", "Host entry is empty.");

  const hostCandidate = extractHostCandidate(trimmedInput);
  if (!hostCandidate) return buildHostNormalizationFailure(input, "parse_failed", "Host entry could not be parsed.");

  return normalizeHostCandidate(input, hostCandidate);
}

export function isExactOnlyHostKind(kind: NormalizedHostKind): boolean {
  return kind === "ip" || kind === "localhost";
}

export function isChildSubdomainHostKind(kind: NormalizedHostKind): boolean {
  return kind === "dns";
}

export function isSingleLabelDnsHost(host: string, kind: NormalizedHostKind): boolean {
  return kind === "dns" && !host.includes(".");
}

export function isPublicSuffixDnsHost(host: string, kind: NormalizedHostKind): boolean {
  if (kind !== "dns") return false;

  return detectPublicSuffix(host) === host;
}

export function buildPublicSuffixHostWarning(input: string): HostNormalizationWarning {
  return {
    input,
    reason: "public_suffix",
    message: "Public suffix entries such as com or co.uk cannot be used as allow-list entries.",
  };
}

function extractHostCandidate(input: string): string | null {
  if (hasUrlScheme(input)) return extractHostnameFromUrl(input);
  if (input.startsWith("[")) return extractBracketedHost(input) ?? extractHostnameFromUrl(`https://${input}`);
  if (isRawIpv6HostInput(input)) return extractRawHostBeforePath(input);

  return extractHostnameFromUrl(`https://${input}`) ?? parseFallbackHost(input);
}

function hasUrlScheme(input: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//iu.test(input);
}

function extractHostnameFromUrl(input: string): string | null {
  try {
    const url = new URL(input);
    return url.hostname.length > 0 ? url.hostname : null;
  } catch {
    return null;
  }
}

function extractBracketedHost(input: string): string | null {
  const closingBracketIndex = input.indexOf("]");
  if (closingBracketIndex === -1) return null;

  return input.slice(0, closingBracketIndex + 1);
}

function isRawIpv6HostInput(input: string): boolean {
  const rawHost = stripIpv6Brackets(stripPort(extractRawHostBeforePath(input)));

  return input.includes(":") && isIP(rawHost) === 6;
}

function extractRawHostBeforePath(input: string): string {
  return input.split(/[/?#]/u, 1)[0] ?? "";
}

function parseFallbackHost(input: string): string | null {
  const host = stripPort(extractRawHostBeforePath(input));

  return host.length > 0 ? host : null;
}

function stripPort(host: string): string {
  if (host.startsWith("[") && host.includes("]")) return host.slice(0, host.indexOf("]") + 1);

  const firstColonIndex = host.indexOf(":");
  const lastColonIndex = host.lastIndexOf(":");
  if (firstColonIndex !== -1 && firstColonIndex === lastColonIndex) return host.slice(0, firstColonIndex);

  return host;
}

function normalizeHostCandidate(input: string, hostCandidate: string): HostNormalizationResult {
  const host = stripTrailingDots(stripIpv6Brackets(hostCandidate.trim().toLowerCase()));
  const kind = classifyNormalizedHost(host);
  if (!kind) return buildHostNormalizationFailure(input, "invalid_host", "Host entry is not a valid DNS name, localhost, or IP address.");

  return {
    input,
    host,
    kind,
    warnings: [],
  };
}

function stripIpv6Brackets(host: string): string {
  if (host.startsWith("[") && host.endsWith("]")) return host.slice(1, -1);

  return host;
}

function stripTrailingDots(host: string): string {
  let endIndex = host.length;

  while (endIndex > 0 && host[endIndex - 1] === ".") endIndex -= 1;

  return host.slice(0, endIndex);
}

function classifyNormalizedHost(host: string): NormalizedHostKind | null {
  if (host.length === 0 || /\s/u.test(host)) return null;
  if (host === "localhost") return "localhost";
  if (isIP(host) !== 0) return "ip";
  if (isValidDnsHost(host)) return "dns";

  return null;
}

function isValidDnsHost(host: string): boolean {
  if (host.length > 253) return false;

  const labels = host.split(".");
  if (labels.length === 0) return false;

  for (const label of labels) {
    if (!isValidDnsLabel(label)) return false;
  }

  return true;
}

function isValidDnsLabel(label: string): boolean {
  if (label.length < 1 || label.length > 63) return false;

  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label);
}

function detectPublicSuffix(host: string): string | null {
  try {
    const result = parse(host, {
      allowPrivateDomains: true,
      detectIp: false,
      extractHostname: false,
      validateHostname: true,
    });
    const isKnownPublicSuffix = result.isIcann === true || result.isPrivate === true;

    return isKnownPublicSuffix ? result.publicSuffix : null;
  } catch {
    return null;
  }
}

function buildHostNormalizationFailure(
  input: string,
  reason: HostNormalizationWarningReason,
  message: string,
): HostNormalizationResult {
  return {
    input,
    host: null,
    kind: null,
    warnings: [
      {
        input,
        reason,
        message,
      },
    ],
  };
}
