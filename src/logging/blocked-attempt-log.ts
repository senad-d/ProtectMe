import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { ProtectMeConfigSourceMetadata, ProtectMeMode } from "../config/index.ts";

export const DEFAULT_COMMAND_SNIPPET_MAX_LENGTH = 240;
export const REDACTED_LOG_VALUE = "[REDACTED]";
export const BLOCKED_ATTEMPT_LOG_OUTCOMES = ["blocked", "prompt_denied", "prompt_unavailable"] as const;
export const NON_BLOCKED_ATTEMPT_OUTCOMES = [
  "allowed",
  "prompt_allowed_once",
  "prompt_allowed_project",
  "prompt_allowed_global",
] as const;

export type BlockedAttemptLogOutcome = (typeof BLOCKED_ATTEMPT_LOG_OUTCOMES)[number];
export type NonBlockedAttemptOutcome = (typeof NON_BLOCKED_ATTEMPT_OUTCOMES)[number];
export type ProtectMeRequestAttemptOutcome = BlockedAttemptLogOutcome | NonBlockedAttemptOutcome;

export interface CommandSnippetMetadata {
  snippet: string;
  truncated: boolean;
  redacted: boolean;
  originalLength: number;
  redactedLength: number;
  maxLength: number;
  omittedCharacters: number;
}

export interface BlockedAttemptLogEntry {
  timestamp: string;
  cwd: string;
  toolName: string;
  commandSnippet: CommandSnippetMetadata;
  rawUrl?: string;
  normalizedUrl?: string;
  host: string;
  attempt: number;
  mode: ProtectMeMode;
  configSources: ProtectMeConfigSourceMetadata[];
  outcome: BlockedAttemptLogOutcome;
}

export interface AppendBlockedAttemptLogInput {
  logPath: string;
  cwd: string;
  toolName: string;
  command: string;
  rawUrl?: string;
  normalizedUrl?: string;
  host: string;
  attempt: number;
  mode: ProtectMeMode;
  configSources: ProtectMeConfigSourceMetadata[];
  outcome: BlockedAttemptLogOutcome;
  timestamp?: string;
  commandSnippetMaxLength?: number;
}

export interface AppendRequestAttemptLogInput extends Omit<AppendBlockedAttemptLogInput, "outcome"> {
  outcome: ProtectMeRequestAttemptOutcome;
}

export interface RequestAttemptLogResult {
  logged: boolean;
  entry: BlockedAttemptLogEntry | null;
}

export function buildBlockedAttemptLogEntry(input: AppendBlockedAttemptLogInput): BlockedAttemptLogEntry {
  return {
    timestamp: input.timestamp ?? new Date().toISOString(),
    cwd: input.cwd,
    toolName: input.toolName,
    commandSnippet: buildCommandSnippetMetadata(input.command, input.commandSnippetMaxLength),
    rawUrl: redactSensitiveLogValue(input.rawUrl),
    normalizedUrl: redactSensitiveLogValue(input.normalizedUrl),
    host: input.host,
    attempt: input.attempt,
    mode: input.mode,
    configSources: input.configSources,
    outcome: input.outcome,
  };
}

export function buildCommandSnippetMetadata(
  command: string,
  maxLength = DEFAULT_COMMAND_SNIPPET_MAX_LENGTH,
): CommandSnippetMetadata {
  const redactedCommand = redactSensitiveCommandFragments(command);
  const safeMaxLength = Math.max(1, maxLength);
  const truncated = redactedCommand.length > safeMaxLength;
  const snippet = truncated ? truncateWithMarker(redactedCommand, safeMaxLength) : redactedCommand;

  return {
    snippet,
    truncated,
    redacted: redactedCommand !== command,
    originalLength: command.length,
    redactedLength: redactedCommand.length,
    maxLength: safeMaxLength,
    omittedCharacters: truncated ? redactedCommand.length - snippet.length : 0,
  };
}

export async function appendBlockedAttemptLog(input: AppendBlockedAttemptLogInput): Promise<BlockedAttemptLogEntry> {
  const entry = buildBlockedAttemptLogEntry(input);

  await mkdir(dirname(input.logPath), { recursive: true });
  await appendFile(input.logPath, `${JSON.stringify(entry)}\n`, "utf8");

  return entry;
}

export async function appendProtectMeRequestAttemptLog(
  input: AppendRequestAttemptLogInput,
): Promise<RequestAttemptLogResult> {
  if (!isBlockedAttemptLogOutcome(input.outcome)) {
    return {
      logged: false,
      entry: null,
    };
  }

  const entry = await appendBlockedAttemptLog({ ...input, outcome: input.outcome });

  return {
    logged: true,
    entry,
  };
}

export function isBlockedAttemptLogOutcome(outcome: ProtectMeRequestAttemptOutcome): outcome is BlockedAttemptLogOutcome {
  return BLOCKED_ATTEMPT_LOG_OUTCOMES.includes(outcome as BlockedAttemptLogOutcome);
}

export function redactSensitiveCommandFragments(command: string): string {
  return redactSensitiveLogText(command);
}

export function redactSensitiveLogText(text: string): string {
  return redactSensitiveOptionValues(redactSecretAssignments(redactSensitiveHeaders(redactUrlCredentialsAndQuerySecrets(text))));
}

export function redactSensitiveLogValue(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;

  return redactSensitiveLogText(value);
}

function truncateWithMarker(command: string, maxLength: number): string {
  const marker = "…[truncated]";
  if (maxLength <= marker.length) return marker.slice(0, maxLength);

  return `${command.slice(0, maxLength - marker.length)}${marker}`;
}

function redactUrlCredentialsAndQuerySecrets(text: string): string {
  return redactSensitiveQueryParameters(redactUrlUserInfo(text));
}

function redactUrlUserInfo(text: string): string {
  return text.replace(/([a-z][a-z0-9+.-]*:\/\/)([^/?#@\s'"]+)@/giu, `$1${REDACTED_LOG_VALUE}@`);
}

function redactSensitiveQueryParameters(text: string): string {
  return text.replace(/([?&])([^=&#\s'"]+)=([^&#\s'"]*)/giu, (match, prefix: string, key: string) => {
    if (!isSensitiveKey(key)) return match;

    return `${prefix}${key}=${REDACTED_LOG_VALUE}`;
  });
}

function redactSensitiveHeaders(command: string): string {
  return redactGenericSensitiveHeaders(redactAuthorizationHeaders(command));
}

function redactAuthorizationHeaders(command: string): string {
  return command.replace(/((?:proxy-)?authorization:\s*(?:bearer|basic)\s+)[^\s'"]+/giu, `$1${REDACTED_LOG_VALUE}`);
}

function redactGenericSensitiveHeaders(command: string): string {
  return command.replace(/((?:cookie|set-cookie|x-api-key|(?:proxy-)?authorization):\s*)[^'"]+/giu, `$1${REDACTED_LOG_VALUE}`);
}

function redactSecretAssignments(command: string): string {
  return command.replace(/(^|[?&\s])((?:api[_-]?key|auth|cookie|key|password|passwd|secret|session|token)=)[^&\s'"]+/giu, `$1$2${REDACTED_LOG_VALUE}`);
}

function redactSensitiveOptionValues(command: string): string {
  return redactShortSensitiveOptionValues(redactLongSensitiveOptionValues(command));
}

function redactLongSensitiveOptionValues(command: string): string {
  return command.replace(/((?:--auth|--proxy-user|--user)(?:=|\s+)(['"]?))([^'"\s]+)(\2)/giu, `$1${REDACTED_LOG_VALUE}$4`);
}

function redactShortSensitiveOptionValues(command: string): string {
  return command.replace(/(^|\s)(-[Uua](?:=|\s+)?(['"]?))([^'"\s]+)(\3)/gu, `$1$2${REDACTED_LOG_VALUE}$5`);
}

function isSensitiveKey(key: string): boolean {
  return /^(?:access[_-]?token|api[_-]?key|auth|authorization|client[_-]?secret|cookie|id[_-]?token|key|password|passwd|secret|session(?:id)?|token|x-api-key)$/iu.test(key);
}

/**
 * Placeholder for future blocked-attempt logging setup.
 *
 * The pure JSONL helpers above are used by later event-handler tasks. This hook
 * intentionally leaves the filesystem untouched and registers no runtime
 * behavior yet.
 */
export function registerBlockedAttemptLogging(_pi: ExtensionAPI) {
  // No logging behavior is registered in the scaffold task.
}
