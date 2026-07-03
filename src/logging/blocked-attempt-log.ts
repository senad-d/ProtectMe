import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { ProtectMeConfigSourceMetadata, ProtectMeMode } from "../config/index.ts";

export const DEFAULT_COMMAND_SNIPPET_MAX_LENGTH = 240;
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
    rawUrl: input.rawUrl,
    normalizedUrl: input.normalizedUrl,
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
  return redactSecretAssignments(redactAuthorizationHeaders(command));
}

function truncateWithMarker(command: string, maxLength: number): string {
  const marker = "…[truncated]";
  if (maxLength <= marker.length) return marker.slice(0, maxLength);

  return `${command.slice(0, maxLength - marker.length)}${marker}`;
}

function redactAuthorizationHeaders(command: string): string {
  return command.replace(/(authorization:\s*(?:bearer|basic)\s+)[^\s'"]+/giu, "$1[REDACTED]");
}

function redactSecretAssignments(command: string): string {
  return command.replace(/((?:api[_-]?key|password|passwd|secret|token)=)[^&\s'"]+/giu, "$1[REDACTED]");
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
