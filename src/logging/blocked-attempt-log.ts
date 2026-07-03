import { appendFile, mkdir, open, type FileHandle } from "node:fs/promises";
import { dirname } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { ProtectMeConfigSourceMetadata, ProtectMeMode } from "../config/index.ts";

export const DEFAULT_COMMAND_SNIPPET_MAX_LENGTH = 240;
export const DEFAULT_RECENT_BLOCKED_HOST_LIMIT = 5;
export const DEFAULT_RECENT_BLOCKED_HOST_SCAN_BYTES = 256 * 1024;
export const DEFAULT_RECENT_BLOCKED_HOST_READ_CHUNK_BYTES = 16 * 1024;
export const BLOCKED_ATTEMPT_LOG_RETENTION_DESCRIPTION =
  "ProtectMe keeps project blocked-attempt logs append-only and project-local; it does not compact, upload, or delete .pi/agent/protectme_log.jsonl automatically, and /protectme reads only a bounded tail window.";
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

export interface ReadRecentBlockedHostsOptions {
  maxScanBytes?: number;
  chunkBytes?: number;
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

export async function readRecentBlockedHosts(
  logPath: string,
  limit = DEFAULT_RECENT_BLOCKED_HOST_LIMIT,
  options: ReadRecentBlockedHostsOptions = {},
): Promise<string[]> {
  const readLimit = normalizeRecentBlockedHostLimit(limit);
  if (readLimit === 0) return [];

  const maxScanBytes = normalizePositiveInteger(options.maxScanBytes, DEFAULT_RECENT_BLOCKED_HOST_SCAN_BYTES);
  const chunkBytes = Math.min(
    maxScanBytes,
    normalizePositiveInteger(options.chunkBytes, DEFAULT_RECENT_BLOCKED_HOST_READ_CHUNK_BYTES),
  );

  try {
    const handle = await open(logPath, "r");

    try {
      return await readRecentBlockedHostsFromHandle(handle, readLimit, maxScanBytes, chunkBytes);
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (isMissingFileError(error)) return [];
    return [];
  }
}

export function extractRecentBlockedHosts(
  jsonlText: string,
  limit = DEFAULT_RECENT_BLOCKED_HOST_LIMIT,
): string[] {
  const readLimit = normalizeRecentBlockedHostLimit(limit);
  if (readLimit === 0) return [];

  const hosts: string[] = [];
  const seenHosts = new Set<string>();
  const lines = jsonlText.trim().split("\n").filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    addRecentBlockedHostFromLine(lines[index]!, hosts, seenHosts, readLimit);
    if (hosts.length >= readLimit) break;
  }

  return hosts;
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

async function readRecentBlockedHostsFromHandle(
  handle: FileHandle,
  limit: number,
  maxScanBytes: number,
  chunkBytes: number,
): Promise<string[]> {
  const hosts: string[] = [];
  const seenHosts = new Set<string>();
  const stats = await handle.stat();
  let carry = "";
  let offset = stats.size;
  let scannedBytes = 0;

  while (offset > 0 && scannedBytes < maxScanBytes && hosts.length < limit) {
    const bytesToRead = Math.min(chunkBytes, offset, maxScanBytes - scannedBytes);
    offset -= bytesToRead;
    scannedBytes += bytesToRead;
    carry = await readRecentBlockedHostChunk(handle, offset, bytesToRead, carry, hosts, seenHosts, limit);
  }

  if (offset === 0) addRecentBlockedHostFromLine(carry, hosts, seenHosts, limit);

  return hosts;
}

async function readRecentBlockedHostChunk(
  handle: FileHandle,
  offset: number,
  bytesToRead: number,
  carry: string,
  hosts: string[],
  seenHosts: Set<string>,
  limit: number,
): Promise<string> {
  const chunkText = await readTextChunk(handle, offset, bytesToRead);

  return collectRecentBlockedHostsFromChunk(chunkText, carry, hosts, seenHosts, limit);
}

async function readTextChunk(handle: FileHandle, offset: number, bytesToRead: number): Promise<string> {
  const buffer = Buffer.allocUnsafe(bytesToRead);
  const result = await handle.read(buffer, 0, bytesToRead, offset);

  return buffer.subarray(0, result.bytesRead).toString("utf8");
}

function collectRecentBlockedHostsFromChunk(
  chunkText: string,
  carry: string,
  hosts: string[],
  seenHosts: Set<string>,
  limit: number,
): string {
  const lines = `${chunkText}${carry}`.split("\n");
  const nextCarry = lines.shift() ?? "";

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    addRecentBlockedHostFromLine(lines[index]!, hosts, seenHosts, limit);
    if (hosts.length >= limit) break;
  }

  return nextCarry;
}

function addRecentBlockedHostFromLine(line: string, hosts: string[], seenHosts: Set<string>, limit: number): void {
  if (hosts.length >= limit) return;

  const host = readHostFromLogLine(line);
  if (!host || seenHosts.has(host)) return;

  seenHosts.add(host);
  hosts.push(host);
}

function readHostFromLogLine(line: string): string | null {
  try {
    const value = JSON.parse(line) as unknown;
    if (!isRecord(value) || typeof value.host !== "string") return null;

    return sanitizeLogCellText(value.host);
  } catch {
    return null;
  }
}

function normalizeRecentBlockedHostLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_RECENT_BLOCKED_HOST_LIMIT;

  return Math.max(0, Math.floor(limit));
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;

  return Math.max(1, Math.floor(value));
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function sanitizeLogCellText(value: string): string {
  let sanitizedValue = "";

  for (const character of value) sanitizedValue += isControlCharacter(character) ? " " : character;

  return sanitizedValue.trim();
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isControlCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0;

  return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
}

function isSensitiveKey(key: string): boolean {
  return /^(?:access[_-]?token|api[_-]?key|auth|authorization|client[_-]?secret|cookie|id[_-]?token|key|password|passwd|secret|session(?:id)?|token|x-api-key)$/iu.test(key);
}

/**
 * Register the blocked-attempt logging helper module with the composition root.
 *
 * JSONL entry construction, redaction, append, and bounded recent-host read helpers are exposed above.
 * Runtime event handlers call those helpers when blocking attempts; this module
 * does not touch the filesystem or attach Pi hooks at startup.
 */
export function registerBlockedAttemptLogging(_pi: ExtensionAPI) {
  // Logging helpers are imported by runtime modules; no Pi hooks are required here.
}
