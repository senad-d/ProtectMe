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
  unsupportedReason?: string;
}

interface CliInvocation {
  cli: SupportedBashNetworkCli;
  tokenIndex: number;
}

interface LongOptionDetails {
  optionName: string;
  inlineValue: string | null;
}

interface TargetToken {
  token: string;
  tokenIndex: number;
  unsupportedReason?: string;
}

interface BashSegmentScanState {
  currentSegment: string;
  quote: BashQuote | null;
  escaped: boolean;
  skipNextCharacter: boolean;
}

interface BashTokenScanState {
  currentToken: string;
  quote: BashQuote | null;
  escaped: boolean;
}

type BashQuote = "'" | '"';
type OptionValueHandling = "network" | "plain" | "unsupported" | "url";
type WrapperName = "command" | "env" | "exec" | "nice" | "sudo" | "time" | "timeout";

const SUPPORTED_CLI_SET = new Set<string>(SUPPORTED_BASH_NETWORK_CLIS);
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE", "CONNECT"]);
const WRAPPER_COMMANDS = new Set<WrapperName>(["command", "env", "exec", "nice", "sudo", "time", "timeout"]);
const UNSUPPORTED_NETWORK_OPTION_HOST = "unsupported static network option";
const CURL_CONFIG_UNSUPPORTED_REASON = "curl config files can contain additional URLs or network options that ProtectMe cannot inspect safely.";
const WGET_CONFIG_UNSUPPORTED_REASON = "wget config files can contain additional URLs or network options that ProtectMe cannot inspect safely.";
const WGET_INPUT_FILE_UNSUPPORTED_REASON = "wget input files can contain additional URLs that ProtectMe cannot inspect safely.";
const STATIC_NETWORK_OPTION_UNSUPPORTED_REASON = "Network option value could not be statically parsed safely.";
const CURL_LONG_URL_VALUE_FLAGS = new Set(["--doh-url", "--url"]);
const CURL_LONG_NETWORK_VALUE_FLAGS = new Set([
  "--connect-to",
  "--dns-servers",
  "--preproxy",
  "--proxy",
  "--resolve",
  "--socks4",
  "--socks4a",
  "--socks5",
  "--socks5-hostname",
]);
const CURL_LONG_UNSUPPORTED_VALUE_FLAGS = new Map([["--config", CURL_CONFIG_UNSUPPORTED_REASON]]);
const CURL_LONG_VALUE_FLAGS = new Set([
  "--abstract-unix-socket",
  "--aws-sigv4",
  "--cacert",
  "--capath",
  "--cert",
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
  "--form",
  "--form-string",
  "--header",
  "--hostpubmd5",
  "--interface",
  "--key",
  "--limit-rate",
  "--max-time",
  "--output",
  "--proxy-header",
  "--referer",
  "--request",
  "--unix-socket",
  "--user",
  "--user-agent",
]);
const WGET_LONG_NETWORK_VALUE_FLAGS = new Set(["--execute"]);
const WGET_LONG_UNSUPPORTED_VALUE_FLAGS = new Map([
  ["--config", WGET_CONFIG_UNSUPPORTED_REASON],
  ["--input-file", WGET_INPUT_FILE_UNSUPPORTED_REASON],
]);
const WGET_LONG_VALUE_FLAGS = new Set([
  "--body-data",
  "--body-file",
  "--ca-certificate",
  "--certificate",
  "--directory-prefix",
  "--header",
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
const HTTPIE_LONG_NETWORK_VALUE_FLAGS = new Set(["--proxy"]);
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
  "--session",
  "--session-read-only",
  "--style",
  "--timeout",
  "--verify",
]);
const CURL_SHORT_NETWORK_VALUE_FLAGS = new Set(["x"]);
const CURL_SHORT_UNSUPPORTED_VALUE_FLAGS = new Map([["K", CURL_CONFIG_UNSUPPORTED_REASON]]);
const CURL_SHORT_VALUE_FLAGS = new Set(["A", "b", "c", "d", "e", "F", "H", "m", "o", "O", "u", "X", "y", "z"]);
const WGET_SHORT_NETWORK_VALUE_FLAGS = new Set(["e"]);
const WGET_SHORT_UNSUPPORTED_VALUE_FLAGS = new Map([["i", WGET_INPUT_FILE_UNSUPPORTED_REASON]]);
const WGET_SHORT_VALUE_FLAGS = new Set(["A", "D", "h", "O", "P", "Q", "T", "U"]);
const HTTPIE_SHORT_VALUE_FLAGS = new Set(["a", "A", "c", "o", "p", "s"]);
const SUDO_LONG_VALUE_OPTIONS = new Set([
  "--chdir",
  "--close-from",
  "--command-timeout",
  "--group",
  "--host",
  "--login-class",
  "--other-user",
  "--prompt",
  "--role",
  "--type",
  "--user",
]);
const SUDO_SHORT_VALUE_OPTIONS = new Set(["C", "D", "g", "h", "p", "R", "r", "T", "t", "U", "u"]);
const ENV_LONG_VALUE_OPTIONS = new Set(["--argv0", "--chdir", "--split-string", "--unset"]);
const ENV_SHORT_VALUE_OPTIONS = new Set(["0", "C", "S", "u"]);
const TIME_LONG_VALUE_OPTIONS = new Set(["--format", "--output"]);
const TIME_SHORT_VALUE_OPTIONS = new Set(["f", "o"]);
const TIME_NO_COMMAND_OPTIONS = new Set(["--help", "--version"]);
const TIME_SHORT_NO_COMMAND_OPTIONS = new Set(["V"]);
const TIMEOUT_LONG_VALUE_OPTIONS = new Set(["--kill-after", "--signal"]);
const TIMEOUT_SHORT_VALUE_OPTIONS = new Set(["k", "s"]);
const NICE_LONG_VALUE_OPTIONS = new Set(["--adjustment"]);

export function extractBashNetworkRequestCandidates(command: string): BashNetworkRequestCandidate[] {
  const candidates: BashNetworkRequestCandidate[] = [];
  const segments = splitBashCommandSegments(command);

  segments.forEach((segment, segmentIndex) => {
    const tokens = tokenizeBashSegment(segment);
    const invocation = findSupportedCliInvocation(tokens);
    if (!invocation) return;

    for (const target of extractTargetTokens(invocation.cli, tokens, invocation.tokenIndex + 1)) {
      if (target.unsupportedReason) {
        candidates.push(buildUnsupportedCandidate(invocation.cli, segment, segmentIndex, target));
        continue;
      }

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
  let state = createInitialBashSegmentScanState();

  for (let index = 0; index < command.length; index += state.skipNextCharacter ? 2 : 1) {
    state = readNextBashSegmentState(command[index] ?? "", command[index + 1] ?? "", segments, state);
  }

  appendSegment(segments, state.currentSegment);

  return segments;
}

function createInitialBashSegmentScanState(): BashSegmentScanState {
  return {
    currentSegment: "",
    quote: null,
    escaped: false,
    skipNextCharacter: false,
  };
}

function readNextBashSegmentState(
  character: string,
  nextCharacter: string,
  segments: string[],
  state: BashSegmentScanState,
): BashSegmentScanState {
  if (state.escaped) return appendBashSegmentCharacter(state, character, { escaped: false });
  if (character === "\\" && state.quote !== "'") return appendBashSegmentCharacter(state, character, { escaped: true });
  if (state.quote) return appendBashSegmentCharacter(state, character, { quote: character === state.quote ? null : state.quote });
  if (isBashQuoteCharacter(character)) return appendBashSegmentCharacter(state, character, { quote: character });
  if (isSegmentSeparator(character, nextCharacter)) {
    return splitCurrentBashSegment(segments, state, isTwoCharacterSeparator(character, nextCharacter));
  }

  return appendBashSegmentCharacter(state, character);
}

function appendBashSegmentCharacter(
  state: BashSegmentScanState,
  character: string,
  updates: Partial<BashSegmentScanState> = {},
): BashSegmentScanState {
  return {
    currentSegment: `${state.currentSegment}${character}`,
    quote: state.quote,
    escaped: state.escaped,
    skipNextCharacter: false,
    ...updates,
  };
}

function splitCurrentBashSegment(
  segments: string[],
  state: BashSegmentScanState,
  skipNextCharacter: boolean,
): BashSegmentScanState {
  appendSegment(segments, state.currentSegment);

  return {
    currentSegment: "",
    quote: state.quote,
    escaped: false,
    skipNextCharacter,
  };
}

function isBashQuoteCharacter(character: string): character is BashQuote {
  return character === "'" || character === '"';
}

export function tokenizeBashSegment(segment: string): string[] {
  const tokens: string[] = [];
  let state = createInitialBashTokenScanState();

  for (const character of segment) state = readNextBashTokenState(character, tokens, state);

  if (state.escaped) state = appendBashTokenCharacter(state, "\\", { escaped: false });
  appendToken(tokens, state.currentToken);

  return tokens;
}

function createInitialBashTokenScanState(): BashTokenScanState {
  return {
    currentToken: "",
    quote: null,
    escaped: false,
  };
}

function readNextBashTokenState(character: string, tokens: string[], state: BashTokenScanState): BashTokenScanState {
  if (state.escaped) return appendBashTokenCharacter(state, character, { escaped: false });
  if (character === "\\" && state.quote !== "'") return { ...state, escaped: true };
  if (state.quote) return readQuotedBashTokenState(character, state);
  if (isBashQuoteCharacter(character)) return { ...state, quote: character };
  if (/\s/u.test(character)) return splitCurrentBashToken(tokens, state);

  return appendBashTokenCharacter(state, character);
}

function readQuotedBashTokenState(character: string, state: BashTokenScanState): BashTokenScanState {
  if (character === state.quote) return { ...state, quote: null };

  return appendBashTokenCharacter(state, character);
}

function appendBashTokenCharacter(
  state: BashTokenScanState,
  character: string,
  updates: Partial<BashTokenScanState> = {},
): BashTokenScanState {
  return {
    currentToken: `${state.currentToken}${character}`,
    quote: state.quote,
    escaped: state.escaped,
    ...updates,
  };
}

function splitCurrentBashToken(tokens: string[], state: BashTokenScanState): BashTokenScanState {
  appendToken(tokens, state.currentToken);

  return {
    currentToken: "",
    quote: state.quote,
    escaped: false,
  };
}

function buildUnsupportedCandidate(
  cli: SupportedBashNetworkCli,
  segment: string,
  segmentIndex: number,
  target: TargetToken,
): BashNetworkRequestCandidate {
  return {
    cli,
    rawTarget: target.token,
    host: UNSUPPORTED_NETWORK_OPTION_HOST,
    segment,
    segmentIndex,
    tokenIndex: target.tokenIndex,
    unsupportedReason: target.unsupportedReason,
  };
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
  let tokenIndex = 0;

  while (tokenIndex < tokens.length) {
    const token = tokens[tokenIndex] ?? "";
    if (isVariableAssignment(token)) {
      tokenIndex += 1;
      continue;
    }

    const cli = parseSupportedCliToken(token);
    if (cli) return { cli, tokenIndex };

    const wrapper = parseWrapperToken(token);
    if (!wrapper) return null;

    const nextTokenIndex = skipWrapperInvocation(tokens, tokenIndex, wrapper);
    if (nextTokenIndex <= tokenIndex) return null;
    tokenIndex = nextTokenIndex;
  }

  return null;
}

function isVariableAssignment(token: string): boolean {
  return /^[A-Za-z_]\w*=/u.test(token);
}

function parseSupportedCliToken(token: string): SupportedBashNetworkCli | null {
  const commandName = parseCommandName(token);

  return SUPPORTED_CLI_SET.has(commandName) ? (commandName as SupportedBashNetworkCli) : null;
}

function parseWrapperToken(token: string): WrapperName | null {
  const commandName = parseCommandName(token) as WrapperName;

  return WRAPPER_COMMANDS.has(commandName) ? commandName : null;
}

function parseCommandName(token: string): string {
  return token.split("/").pop()?.toLowerCase() ?? token.toLowerCase();
}

function skipWrapperInvocation(tokens: string[], wrapperIndex: number, wrapper: WrapperName): number {
  if (wrapper === "command") return skipCommandWrapper(tokens, wrapperIndex);
  if (wrapper === "env") return skipEnvWrapper(tokens, wrapperIndex);
  if (wrapper === "exec") return skipExecWrapper(tokens, wrapperIndex);
  if (wrapper === "nice") return skipNiceWrapper(tokens, wrapperIndex);
  if (wrapper === "sudo") return skipSudoWrapper(tokens, wrapperIndex);
  if (wrapper === "time") return skipTimeWrapper(tokens, wrapperIndex);

  return skipTimeoutWrapper(tokens, wrapperIndex);
}

function skipCommandWrapper(tokens: string[], wrapperIndex: number): number {
  let tokenIndex = wrapperIndex + 1;

  while (tokenIndex < tokens.length) {
    const token = tokens[tokenIndex] ?? "";
    if (token === "--") return tokenIndex + 1;
    if (token === "-p") {
      tokenIndex += 1;
      continue;
    }
    if (token === "-v" || token === "-V") return tokens.length;

    return tokenIndex;
  }

  return tokenIndex;
}

function skipExecWrapper(tokens: string[], wrapperIndex: number): number {
  let tokenIndex = wrapperIndex + 1;

  while (tokenIndex < tokens.length) {
    const token = tokens[tokenIndex] ?? "";
    if (token === "--") return tokenIndex + 1;
    if (token === "-a") return tokenIndex + 2;
    if (token === "-c" || token === "-l") {
      tokenIndex += 1;
      continue;
    }

    return tokenIndex;
  }

  return tokenIndex;
}

function skipSudoWrapper(tokens: string[], wrapperIndex: number): number {
  let tokenIndex = wrapperIndex + 1;

  while (tokenIndex < tokens.length) {
    const token = tokens[tokenIndex] ?? "";
    if (token === "--") return tokenIndex + 1;
    if (!token.startsWith("-") || token === "-") return tokenIndex;
    if (token.startsWith("--")) {
      tokenIndex = skipLongWrapperOption(token, tokenIndex, SUDO_LONG_VALUE_OPTIONS);
      continue;
    }

    tokenIndex = skipShortWrapperOption(token, tokenIndex, SUDO_SHORT_VALUE_OPTIONS);
  }

  return tokenIndex;
}

function skipEnvWrapper(tokens: string[], wrapperIndex: number): number {
  let tokenIndex = wrapperIndex + 1;

  while (tokenIndex < tokens.length) {
    const token = tokens[tokenIndex] ?? "";
    if (token === "--") {
      tokenIndex += 1;
      continue;
    }
    if (isVariableAssignment(token)) {
      tokenIndex += 1;
      continue;
    }
    if (!token.startsWith("-") || token === "-") return tokenIndex;
    if (token.startsWith("--")) {
      tokenIndex = skipLongWrapperOption(token, tokenIndex, ENV_LONG_VALUE_OPTIONS);
      continue;
    }

    tokenIndex = skipShortWrapperOption(token, tokenIndex, ENV_SHORT_VALUE_OPTIONS);
  }

  return tokenIndex;
}

function skipTimeWrapper(tokens: string[], wrapperIndex: number): number {
  let tokenIndex = wrapperIndex + 1;

  while (tokenIndex < tokens.length) {
    const token = tokens[tokenIndex] ?? "";
    if (token === "--") return tokenIndex + 1;
    if (TIME_NO_COMMAND_OPTIONS.has(token)) return tokens.length;
    if (!token.startsWith("-") || token === "-") return tokenIndex;
    if (token.startsWith("--")) {
      tokenIndex = skipLongWrapperOption(token, tokenIndex, TIME_LONG_VALUE_OPTIONS);
      continue;
    }

    if (hasShortWrapperNoCommandOption(token, TIME_SHORT_NO_COMMAND_OPTIONS)) return tokens.length;
    tokenIndex = skipShortWrapperOption(token, tokenIndex, TIME_SHORT_VALUE_OPTIONS);
  }

  return tokenIndex;
}

function skipTimeoutWrapper(tokens: string[], wrapperIndex: number): number {
  let tokenIndex = wrapperIndex + 1;

  while (tokenIndex < tokens.length) {
    const token = tokens[tokenIndex] ?? "";
    if (token === "--") {
      tokenIndex += 1;
      break;
    }
    if (!token.startsWith("-") || token === "-") break;
    if (token.startsWith("--")) {
      tokenIndex = skipLongWrapperOption(token, tokenIndex, TIMEOUT_LONG_VALUE_OPTIONS);
      continue;
    }

    tokenIndex = skipShortWrapperOption(token, tokenIndex, TIMEOUT_SHORT_VALUE_OPTIONS);
  }

  return tokenIndex < tokens.length ? tokenIndex + 1 : tokenIndex;
}

function skipNiceWrapper(tokens: string[], wrapperIndex: number): number {
  let tokenIndex = wrapperIndex + 1;

  while (tokenIndex < tokens.length) {
    const token = tokens[tokenIndex] ?? "";
    if (token === "--") return tokenIndex + 1;
    if (isNiceAdjustmentToken(token)) {
      tokenIndex += 1;
      continue;
    }
    if (!token.startsWith("-") || token === "-") return tokenIndex;
    if (token.startsWith("--")) {
      tokenIndex = skipLongWrapperOption(token, tokenIndex, NICE_LONG_VALUE_OPTIONS);
      continue;
    }
    if (token === "-n") return tokenIndex + 2;

    return tokenIndex;
  }

  return tokenIndex;
}

function skipLongWrapperOption(token: string, tokenIndex: number, valueOptions: Set<string>): number {
  const details = parseLongOptionDetails(token);
  if (valueOptions.has(details.optionName) && details.inlineValue === null) return tokenIndex + 2;

  return tokenIndex + 1;
}

function skipShortWrapperOption(token: string, tokenIndex: number, valueOptions: Set<string>): number {
  const optionLetters = token.slice(1);

  for (let index = 0; index < optionLetters.length; index += 1) {
    const optionName = optionLetters[index] ?? "";
    const inlineValue = optionLetters.slice(index + 1);

    if (!valueOptions.has(optionName)) continue;

    return inlineValue.length > 0 ? tokenIndex + 1 : tokenIndex + 2;
  }

  return tokenIndex + 1;
}

function hasShortWrapperNoCommandOption(token: string, noCommandOptions: Set<string>): boolean {
  const optionLetters = token.slice(1);

  for (const optionName of optionLetters) {
    if (noCommandOptions.has(optionName)) return true;
  }

  return false;
}

function isNiceAdjustmentToken(token: string): boolean {
  return /^-\d+$/u.test(token) || /^\+\d+$/u.test(token);
}

function extractTargetTokens(cli: SupportedBashNetworkCli, tokens: string[], startIndex: number): TargetToken[] {
  if (cli === "curl" || cli === "wget") return extractCurlOrWgetTargetTokens(cli, tokens, startIndex);

  return extractHttpieTargetTokens(cli, tokens, startIndex);
}

function extractCurlOrWgetTargetTokens(cli: SupportedBashNetworkCli, tokens: string[], startIndex: number): TargetToken[] {
  const targets: TargetToken[] = [];
  let optionParsing = true;
  let tokenIndex = startIndex;

  while (tokenIndex < tokens.length) {
    const token = tokens[tokenIndex] ?? "";

    if (optionParsing && token === "--") {
      optionParsing = false;
      tokenIndex += 1;
      continue;
    }

    if (optionParsing && token.startsWith("--")) {
      tokenIndex += calculateTokenStep(tokenIndex, handleLongOption(cli, tokens, tokenIndex, targets));
      continue;
    }

    if (optionParsing && isShortOptionToken(token)) {
      tokenIndex += calculateTokenStep(tokenIndex, handleShortOption(cli, tokens, tokenIndex, targets));
      continue;
    }

    appendUrlLikeTarget(targets, token, tokenIndex);
    tokenIndex += 1;
  }

  return targets;
}

function extractHttpieTargetTokens(cli: SupportedBashNetworkCli, tokens: string[], startIndex: number): TargetToken[] {
  const targets: TargetToken[] = [];
  let optionParsing = true;
  let tokenIndex = startIndex;

  while (tokenIndex < tokens.length) {
    const token = tokens[tokenIndex] ?? "";

    if (optionParsing && token === "--") {
      optionParsing = false;
      tokenIndex += 1;
      continue;
    }

    if (optionParsing && token.startsWith("--")) {
      tokenIndex += calculateTokenStep(tokenIndex, handleLongOption(cli, tokens, tokenIndex, targets));
      continue;
    }

    if (optionParsing && isShortOptionToken(token)) {
      tokenIndex += calculateTokenStep(tokenIndex, handleShortOption(cli, tokens, tokenIndex, targets));
      continue;
    }

    if (HTTP_METHODS.has(token.toUpperCase())) {
      tokenIndex += 1;
      continue;
    }
    appendUrlLikeTarget(targets, token, tokenIndex);
    tokenIndex += 1;
  }

  return targets;
}

function calculateTokenStep(currentTokenIndex: number, handledTokenIndex: number): number {
  return Math.max(1, handledTokenIndex - currentTokenIndex + 1);
}

function handleLongOption(
  cli: SupportedBashNetworkCli,
  tokens: string[],
  tokenIndex: number,
  targets: TargetToken[],
): number {
  const token = tokens[tokenIndex] ?? "";
  const details = parseLongOptionDetails(token);
  const handling = readLongOptionValueHandling(cli, details.optionName);

  if (handling === "url") return handleOptionUrlValue(tokens, tokenIndex, targets, details.inlineValue);
  if (handling === "network") return handleOptionNetworkValue(cli, details.optionName, tokens, tokenIndex, targets, details.inlineValue);
  if (handling === "unsupported") return handleUnsupportedOptionValue(cli, details.optionName, tokens, tokenIndex, targets, details.inlineValue);
  if (handling === "plain") return details.inlineValue === null ? tokenIndex + 1 : tokenIndex;

  return tokenIndex;
}

function parseLongOptionDetails(token: string): LongOptionDetails {
  const separatorIndex = token.indexOf("=");

  return {
    optionName: separatorIndex === -1 ? token : token.slice(0, separatorIndex),
    inlineValue: separatorIndex === -1 ? null : token.slice(separatorIndex + 1),
  };
}

function readLongOptionValueHandling(cli: SupportedBashNetworkCli, optionName: string): OptionValueHandling | null {
  if (cli === "curl") return readCurlLongOptionValueHandling(optionName);
  if (cli === "wget") return readWgetLongOptionValueHandling(optionName);

  return readHttpieLongOptionValueHandling(optionName);
}

function readCurlLongOptionValueHandling(optionName: string): OptionValueHandling | null {
  if (CURL_LONG_URL_VALUE_FLAGS.has(optionName)) return "url";
  if (CURL_LONG_NETWORK_VALUE_FLAGS.has(optionName)) return "network";
  if (CURL_LONG_UNSUPPORTED_VALUE_FLAGS.has(optionName)) return "unsupported";
  if (CURL_LONG_VALUE_FLAGS.has(optionName)) return "plain";

  return null;
}

function readWgetLongOptionValueHandling(optionName: string): OptionValueHandling | null {
  if (WGET_LONG_NETWORK_VALUE_FLAGS.has(optionName)) return "network";
  if (WGET_LONG_UNSUPPORTED_VALUE_FLAGS.has(optionName)) return "unsupported";
  if (WGET_LONG_VALUE_FLAGS.has(optionName)) return "plain";

  return null;
}

function readHttpieLongOptionValueHandling(optionName: string): OptionValueHandling | null {
  if (HTTPIE_LONG_NETWORK_VALUE_FLAGS.has(optionName)) return "network";
  if (HTTPIE_LONG_VALUE_FLAGS.has(optionName)) return "plain";

  return null;
}

function handleShortOption(
  cli: SupportedBashNetworkCli,
  tokens: string[],
  tokenIndex: number,
  targets: TargetToken[],
): number {
  const token = tokens[tokenIndex] ?? "";
  const optionLetters = token.slice(1);

  for (let index = 0; index < optionLetters.length; index += 1) {
    const optionName = optionLetters[index] ?? "";
    const inlineValue = optionLetters.slice(index + 1);
    const handling = readShortOptionValueHandling(cli, optionName);

    if (handling === "url") return handleOptionUrlValue(tokens, tokenIndex, targets, inlineValue || null);
    if (handling === "network") return handleOptionNetworkValue(cli, optionName, tokens, tokenIndex, targets, inlineValue || null);
    if (handling === "unsupported") return handleUnsupportedOptionValue(cli, optionName, tokens, tokenIndex, targets, inlineValue || null);
    if (handling === "plain") return inlineValue.length > 0 ? tokenIndex : tokenIndex + 1;
  }

  return tokenIndex;
}

function readShortOptionValueHandling(cli: SupportedBashNetworkCli, optionName: string): OptionValueHandling | null {
  if (cli === "curl") return readCurlShortOptionValueHandling(optionName);
  if (cli === "wget") return readWgetShortOptionValueHandling(optionName);

  return HTTPIE_SHORT_VALUE_FLAGS.has(optionName) ? "plain" : null;
}

function readCurlShortOptionValueHandling(optionName: string): OptionValueHandling | null {
  if (CURL_SHORT_NETWORK_VALUE_FLAGS.has(optionName)) return "network";
  if (CURL_SHORT_UNSUPPORTED_VALUE_FLAGS.has(optionName)) return "unsupported";
  if (CURL_SHORT_VALUE_FLAGS.has(optionName)) return "plain";

  return null;
}

function readWgetShortOptionValueHandling(optionName: string): OptionValueHandling | null {
  if (WGET_SHORT_NETWORK_VALUE_FLAGS.has(optionName)) return "network";
  if (WGET_SHORT_UNSUPPORTED_VALUE_FLAGS.has(optionName)) return "unsupported";
  if (WGET_SHORT_VALUE_FLAGS.has(optionName)) return "plain";

  return null;
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

function handleOptionNetworkValue(
  cli: SupportedBashNetworkCli,
  optionName: string,
  tokens: string[],
  tokenIndex: number,
  targets: TargetToken[],
  inlineValue: string | null,
): number {
  const value = inlineValue ?? tokens[tokenIndex + 1];
  const valueTokenIndex = inlineValue === null ? tokenIndex + 1 : tokenIndex;
  if (!value) return inlineValue === null ? tokenIndex + 1 : tokenIndex;

  const appended = appendNetworkOptionValueTargets(cli, optionName, value, valueTokenIndex, targets);
  if (!appended && shouldUnsupportedNetworkOptionFailClosed(cli, optionName, value)) {
    appendUnsupportedTarget(targets, buildOptionTargetLabel(optionName, value, inlineValue !== null), tokenIndex, STATIC_NETWORK_OPTION_UNSUPPORTED_REASON);
  }

  return inlineValue === null ? tokenIndex + 1 : tokenIndex;
}

function handleUnsupportedOptionValue(
  cli: SupportedBashNetworkCli,
  optionName: string,
  tokens: string[],
  tokenIndex: number,
  targets: TargetToken[],
  inlineValue: string | null,
): number {
  const value = inlineValue ?? tokens[tokenIndex + 1];
  const reason = readUnsupportedOptionReason(cli, optionName) ?? STATIC_NETWORK_OPTION_UNSUPPORTED_REASON;

  appendUnsupportedTarget(targets, buildOptionTargetLabel(optionName, value, inlineValue !== null), tokenIndex, reason);

  return inlineValue === null ? tokenIndex + 1 : tokenIndex;
}

function readUnsupportedOptionReason(cli: SupportedBashNetworkCli, optionName: string): string | null {
  if (cli === "curl") return CURL_LONG_UNSUPPORTED_VALUE_FLAGS.get(optionName) ?? CURL_SHORT_UNSUPPORTED_VALUE_FLAGS.get(optionName) ?? null;
  if (cli === "wget") return WGET_LONG_UNSUPPORTED_VALUE_FLAGS.get(optionName) ?? WGET_SHORT_UNSUPPORTED_VALUE_FLAGS.get(optionName) ?? null;

  return null;
}

function buildOptionTargetLabel(optionName: string, value: string | undefined, inline: boolean): string {
  if (value === undefined) return optionName;
  if (inline && optionName.startsWith("--")) return `${optionName}=${value}`;
  if (inline) return `-${optionName}${value}`;

  return `${optionName} ${value}`;
}

function appendNetworkOptionValueTargets(
  cli: SupportedBashNetworkCli,
  optionName: string,
  value: string,
  tokenIndex: number,
  targets: TargetToken[],
): boolean {
  const initialTargetCount = targets.length;

  if (cli === "curl") appendCurlNetworkOptionValueTargets(optionName, value, tokenIndex, targets);
  if (cli === "wget") appendWgetNetworkOptionValueTargets(optionName, value, tokenIndex, targets);
  if (cli === "http" || cli === "https") appendHttpieNetworkOptionValueTargets(optionName, value, tokenIndex, targets);

  return targets.length > initialTargetCount;
}

function appendCurlNetworkOptionValueTargets(optionName: string, value: string, tokenIndex: number, targets: TargetToken[]): void {
  if (optionName === "--resolve") {
    appendCurlResolveTargets(value, tokenIndex, targets);
    return;
  }
  if (optionName === "--connect-to") {
    appendCurlConnectToTargets(value, tokenIndex, targets);
    return;
  }
  if (optionName === "--dns-servers") {
    appendCommaSeparatedUrlLikeTargets(value, tokenIndex, targets);
    return;
  }

  appendUrlLikeTarget(targets, value, tokenIndex);
}

function appendWgetNetworkOptionValueTargets(optionName: string, value: string, tokenIndex: number, targets: TargetToken[]): void {
  if (optionName === "--execute" || optionName === "e") appendWgetExecuteTargets(value, tokenIndex, targets);
}

function appendHttpieNetworkOptionValueTargets(optionName: string, value: string, tokenIndex: number, targets: TargetToken[]): void {
  if (optionName === "--proxy") appendHttpieProxyTargets(value, tokenIndex, targets);
}

function appendCurlResolveTargets(value: string, tokenIndex: number, targets: TargetToken[]): void {
  const fields = splitUnbracketedColonFields(value.replace(/^\+/u, ""));
  if (fields.length < 3) {
    appendUnsupportedTarget(targets, `--resolve ${value}`, tokenIndex, STATIC_NETWORK_OPTION_UNSUPPORTED_REASON);
    return;
  }

  appendUrlLikeTarget(targets, fields[0] ?? "", tokenIndex);
  appendCommaSeparatedUrlLikeTargets(fields.slice(2).join(":"), tokenIndex, targets);
}

function appendCurlConnectToTargets(value: string, tokenIndex: number, targets: TargetToken[]): void {
  const fields = splitUnbracketedColonFields(value);
  if (fields.length < 4) {
    appendUnsupportedTarget(targets, `--connect-to ${value}`, tokenIndex, STATIC_NETWORK_OPTION_UNSUPPORTED_REASON);
    return;
  }

  appendUrlLikeTarget(targets, fields[0] ?? "", tokenIndex);
  appendUrlLikeTarget(targets, fields[2] ?? "", tokenIndex);
}

function appendWgetExecuteTargets(value: string, tokenIndex: number, targets: TargetToken[]): void {
  const initialTargetCount = targets.length;
  const assignmentValue = readAssignmentValue(value);

  appendUrlLikeTarget(targets, value, tokenIndex);
  if (assignmentValue) appendUrlLikeTarget(targets, assignmentValue, tokenIndex);
  if (targets.length === initialTargetCount && isWgetProxyDirective(value)) {
    appendUnsupportedTarget(targets, `-e ${value}`, tokenIndex, STATIC_NETWORK_OPTION_UNSUPPORTED_REASON);
  }
}

function appendHttpieProxyTargets(value: string, tokenIndex: number, targets: TargetToken[]): void {
  appendUrlLikeTarget(targets, value, tokenIndex);

  const separatorIndex = value.indexOf(":");
  if (separatorIndex === -1) return;

  appendUrlLikeTarget(targets, value.slice(separatorIndex + 1), tokenIndex);
}

function appendCommaSeparatedUrlLikeTargets(value: string, tokenIndex: number, targets: TargetToken[]): void {
  for (const part of value.split(",")) appendUrlLikeTarget(targets, trimBrackets(part.trim()), tokenIndex);
}

function appendUnsupportedTarget(targets: TargetToken[], token: string, tokenIndex: number, unsupportedReason: string): void {
  targets.push({ token, tokenIndex, unsupportedReason });
}

function shouldUnsupportedNetworkOptionFailClosed(cli: SupportedBashNetworkCli, optionName: string, value: string): boolean {
  if (cli === "wget" && (optionName === "--execute" || optionName === "e")) return isWgetProxyDirective(value);

  return true;
}

function isWgetProxyDirective(value: string): boolean {
  return /(?:^|[_.-])proxy(?:[_.-]|=|$)/iu.test(value);
}

function readAssignmentValue(value: string): string | null {
  const separatorIndex = value.indexOf("=");
  if (separatorIndex === -1) return null;

  return value.slice(separatorIndex + 1);
}

function splitUnbracketedColonFields(value: string): string[] {
  const fields: string[] = [];
  let currentField = "";
  let bracketDepth = 0;

  for (const character of value) {
    if (character === "[") bracketDepth += 1;
    if (character === "]" && bracketDepth > 0) bracketDepth -= 1;

    if (character === ":" && bracketDepth === 0) {
      fields.push(trimBrackets(currentField));
      currentField = "";
      continue;
    }

    currentField += character;
  }

  fields.push(trimBrackets(currentField));

  return fields;
}

function trimBrackets(value: string): string {
  const trimmedValue = value.trim();
  if (trimmedValue.startsWith("[") && trimmedValue.endsWith("]")) return trimmedValue.slice(1, -1);

  return trimmedValue;
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
