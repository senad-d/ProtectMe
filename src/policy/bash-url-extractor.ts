import { normalizeHostInput } from "./host-normalization.ts";

export const SUPPORTED_BASH_NETWORK_CLIS = ["curl", "wget", "http", "https"] as const;

export type SupportedBashNetworkCli = (typeof SUPPORTED_BASH_NETWORK_CLIS)[number];

export interface BashNetworkRequestCandidate {
  cli: SupportedBashNetworkCli;
  rawTarget: string;
  host: string;
  segment: string;
  segmentIndex: number;
  tokenIndex: number;
}

interface CliInvocation {
  cli: SupportedBashNetworkCli;
  tokenIndex: number;
}

interface TargetToken {
  token: string;
  tokenIndex: number;
}

const SUPPORTED_CLI_SET = new Set<string>(SUPPORTED_BASH_NETWORK_CLIS);
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE", "CONNECT"]);
const COMMAND_PREFIX_TOKENS = new Set(["command", "exec", "sudo"]);
const CURL_LONG_URL_VALUE_FLAGS = new Set(["--url"]);
const CURL_LONG_VALUE_FLAGS = new Set([
  "--abstract-unix-socket",
  "--aws-sigv4",
  "--cacert",
  "--capath",
  "--cert",
  "--config",
  "--connect-timeout",
  "--cookie",
  "--cookie-jar",
  "--data",
  "--data-ascii",
  "--data-binary",
  "--data-raw",
  "--data-urlencode",
  "--dns-interface",
  "--dns-ipv4-addr",
  "--dns-ipv6-addr",
  "--dns-servers",
  "--form",
  "--form-string",
  "--header",
  "--hostpubmd5",
  "--interface",
  "--key",
  "--limit-rate",
  "--max-time",
  "--output",
  "--proxy",
  "--proxy-header",
  "--referer",
  "--request",
  "--resolve",
  "--unix-socket",
  "--user",
  "--user-agent",
]);
const WGET_LONG_VALUE_FLAGS = new Set([
  "--body-data",
  "--body-file",
  "--ca-certificate",
  "--certificate",
  "--directory-prefix",
  "--header",
  "--input-file",
  "--load-cookies",
  "--method",
  "--output-document",
  "--page-requisites",
  "--post-data",
  "--post-file",
  "--referer",
  "--save-cookies",
  "--user-agent",
]);
const HTTPIE_LONG_VALUE_FLAGS = new Set([
  "--auth",
  "--cert",
  "--cert-key",
  "--chunked",
  "--download-resume",
  "--form",
  "--headers",
  "--multipart",
  "--output",
  "--pretty",
  "--print",
  "--proxy",
  "--session",
  "--session-read-only",
  "--style",
  "--timeout",
  "--verify",
]);
const CURL_SHORT_VALUE_FLAGS = new Set(["A", "b", "c", "d", "e", "F", "H", "K", "m", "o", "O", "u", "x", "X", "y", "z"]);
const WGET_SHORT_VALUE_FLAGS = new Set(["A", "D", "e", "h", "i", "O", "P", "Q", "T", "U"]);
const HTTPIE_SHORT_VALUE_FLAGS = new Set(["a", "A", "c", "o", "p", "s"]);

export function extractBashNetworkRequestCandidates(command: string): BashNetworkRequestCandidate[] {
  const candidates: BashNetworkRequestCandidate[] = [];
  const segments = splitBashCommandSegments(command);

  segments.forEach((segment, segmentIndex) => {
    const tokens = tokenizeBashSegment(segment);
    const invocation = findSupportedCliInvocation(tokens);
    if (!invocation) return;

    for (const target of extractTargetTokens(invocation.cli, tokens, invocation.tokenIndex + 1)) {
      const normalizedHost = normalizeHostInput(target.token).host;
      if (!normalizedHost) continue;

      candidates.push({
        cli: invocation.cli,
        rawTarget: target.token,
        host: normalizedHost,
        segment,
        segmentIndex,
        tokenIndex: target.tokenIndex,
      });
    }
  });

  return candidates;
}

export function extractToolCallNetworkRequestCandidates(toolName: string, input: unknown): BashNetworkRequestCandidate[] {
  if (toolName !== "bash") return [];

  const command = extractCommandString(input);
  if (!command) return [];

  return extractBashNetworkRequestCandidates(command);
}

export function splitBashCommandSegments(command: string): string[] {
  const segments: string[] = [];
  let currentSegment = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index] ?? "";
    const nextCharacter = command[index + 1] ?? "";

    if (escaped) {
      currentSegment += character;
      escaped = false;
      continue;
    }

    if (character === "\\" && quote !== "'") {
      currentSegment += character;
      escaped = true;
      continue;
    }

    if (quote) {
      if (character === quote) quote = null;
      currentSegment += character;
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      currentSegment += character;
      continue;
    }

    if (isSegmentSeparator(character, nextCharacter)) {
      appendSegment(segments, currentSegment);
      currentSegment = "";
      if (isTwoCharacterSeparator(character, nextCharacter)) index += 1;
      continue;
    }

    currentSegment += character;
  }

  appendSegment(segments, currentSegment);

  return segments;
}

export function tokenizeBashSegment(segment: string): string[] {
  const tokens: string[] = [];
  let currentToken = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const character of segment) {
    if (escaped) {
      currentToken += character;
      escaped = false;
      continue;
    }

    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        currentToken += character;
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (/\s/u.test(character)) {
      appendToken(tokens, currentToken);
      currentToken = "";
      continue;
    }

    currentToken += character;
  }

  if (escaped) currentToken += "\\";
  appendToken(tokens, currentToken);

  return tokens;
}

function extractCommandString(input: unknown): string | null {
  if (typeof input === "string") return input;
  if (!isRecord(input)) return null;

  return typeof input.command === "string" ? input.command : null;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}

function isSegmentSeparator(character: string, nextCharacter: string): boolean {
  return character === ";" || character === "\n" || character === "|" || (character === "&" && nextCharacter === "&");
}

function isTwoCharacterSeparator(character: string, nextCharacter: string): boolean {
  return (character === "&" && nextCharacter === "&") || (character === "|" && nextCharacter === "|");
}

function appendSegment(segments: string[], segment: string): void {
  const trimmedSegment = segment.trim();
  if (trimmedSegment.length > 0) segments.push(trimmedSegment);
}

function appendToken(tokens: string[], token: string): void {
  if (token.length > 0) tokens.push(token);
}

function findSupportedCliInvocation(tokens: string[]): CliInvocation | null {
  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex] ?? "";
    if (isVariableAssignment(token) || COMMAND_PREFIX_TOKENS.has(token)) continue;

    const cli = parseSupportedCliToken(token);
    if (!cli) return null;

    return { cli, tokenIndex };
  }

  return null;
}

function isVariableAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/u.test(token);
}

function parseSupportedCliToken(token: string): SupportedBashNetworkCli | null {
  const commandName = token.split("/").pop()?.toLowerCase() ?? token.toLowerCase();

  return SUPPORTED_CLI_SET.has(commandName) ? (commandName as SupportedBashNetworkCli) : null;
}

function extractTargetTokens(cli: SupportedBashNetworkCli, tokens: string[], startIndex: number): TargetToken[] {
  if (cli === "curl") return extractCurlOrWgetTargetTokens(tokens, startIndex, CURL_LONG_URL_VALUE_FLAGS, CURL_LONG_VALUE_FLAGS, CURL_SHORT_VALUE_FLAGS);
  if (cli === "wget") return extractCurlOrWgetTargetTokens(tokens, startIndex, new Set(), WGET_LONG_VALUE_FLAGS, WGET_SHORT_VALUE_FLAGS);

  return extractHttpieTargetTokens(tokens, startIndex);
}

function extractCurlOrWgetTargetTokens(
  tokens: string[],
  startIndex: number,
  longUrlValueFlags: Set<string>,
  longValueFlags: Set<string>,
  shortValueFlags: Set<string>,
): TargetToken[] {
  const targets: TargetToken[] = [];
  let optionParsing = true;

  for (let tokenIndex = startIndex; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex] ?? "";

    if (optionParsing && token === "--") {
      optionParsing = false;
      continue;
    }

    if (optionParsing && token.startsWith("--")) {
      tokenIndex = handleLongOption(tokens, tokenIndex, targets, longUrlValueFlags, longValueFlags);
      continue;
    }

    if (optionParsing && isShortOptionToken(token)) {
      tokenIndex = handleShortOption(tokens, tokenIndex, targets, new Set(), shortValueFlags);
      continue;
    }

    appendUrlLikeTarget(targets, token, tokenIndex);
  }

  return targets;
}

function extractHttpieTargetTokens(tokens: string[], startIndex: number): TargetToken[] {
  const targets: TargetToken[] = [];
  let optionParsing = true;

  for (let tokenIndex = startIndex; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex] ?? "";

    if (optionParsing && token === "--") {
      optionParsing = false;
      continue;
    }

    if (optionParsing && token.startsWith("--")) {
      tokenIndex = handleLongOption(tokens, tokenIndex, targets, new Set(), HTTPIE_LONG_VALUE_FLAGS);
      continue;
    }

    if (optionParsing && isShortOptionToken(token)) {
      tokenIndex = handleShortOption(tokens, tokenIndex, targets, new Set(), HTTPIE_SHORT_VALUE_FLAGS);
      continue;
    }

    if (HTTP_METHODS.has(token.toUpperCase())) continue;
    appendUrlLikeTarget(targets, token, tokenIndex);
  }

  return targets;
}

function handleLongOption(
  tokens: string[],
  tokenIndex: number,
  targets: TargetToken[],
  urlValueFlags: Set<string>,
  valueFlags: Set<string>,
): number {
  const token = tokens[tokenIndex] ?? "";
  const separatorIndex = token.indexOf("=");
  const optionName = separatorIndex === -1 ? token : token.slice(0, separatorIndex);
  const inlineValue = separatorIndex === -1 ? null : token.slice(separatorIndex + 1);

  if (urlValueFlags.has(optionName)) return handleOptionUrlValue(tokens, tokenIndex, targets, inlineValue);
  if (valueFlags.has(optionName)) return inlineValue === null ? tokenIndex + 1 : tokenIndex;

  return tokenIndex;
}

function handleShortOption(
  tokens: string[],
  tokenIndex: number,
  targets: TargetToken[],
  urlValueFlags: Set<string>,
  valueFlags: Set<string>,
): number {
  const token = tokens[tokenIndex] ?? "";
  const optionLetters = token.slice(1);

  for (let index = 0; index < optionLetters.length; index += 1) {
    const optionName = optionLetters[index] ?? "";
    const inlineValue = optionLetters.slice(index + 1);

    if (urlValueFlags.has(optionName)) return handleOptionUrlValue(tokens, tokenIndex, targets, inlineValue || null);
    if (valueFlags.has(optionName)) return inlineValue.length > 0 ? tokenIndex : tokenIndex + 1;
  }

  return tokenIndex;
}

function handleOptionUrlValue(
  tokens: string[],
  tokenIndex: number,
  targets: TargetToken[],
  inlineValue: string | null,
): number {
  if (inlineValue !== null) {
    appendUrlLikeTarget(targets, inlineValue, tokenIndex);
    return tokenIndex;
  }

  const nextToken = tokens[tokenIndex + 1];
  if (nextToken) appendUrlLikeTarget(targets, nextToken, tokenIndex + 1);

  return tokenIndex + 1;
}

function isShortOptionToken(token: string): boolean {
  return /^-[^-\s].*/u.test(token);
}

function appendUrlLikeTarget(targets: TargetToken[], token: string, tokenIndex: number): void {
  if (!isUrlLikeRequestTargetToken(token)) return;

  targets.push({ token, tokenIndex });
}

function isUrlLikeRequestTargetToken(token: string): boolean {
  const trimmedToken = token.trim();
  if (trimmedToken.length === 0) return false;
  if (trimmedToken.startsWith("-") || trimmedToken.startsWith("@")) return false;
  if (/[`$]/u.test(trimmedToken)) return false;
  if (hasAssignmentPrefix(trimmedToken)) return false;
  if (hasUrlScheme(trimmedToken)) return normalizeHostInput(trimmedToken).host !== null;

  const normalizedHost = normalizeHostInput(trimmedToken);
  if (!normalizedHost.host || !normalizedHost.kind) return false;
  if (normalizedHost.kind === "ip" || normalizedHost.kind === "localhost") return true;

  return normalizedHost.host.includes(".");
}

function hasAssignmentPrefix(token: string): boolean {
  return /^[^/?#=]+=.+/u.test(token);
}

function hasUrlScheme(token: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//iu.test(token);
}
