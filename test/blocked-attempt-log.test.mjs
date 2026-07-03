import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  appendBlockedAttemptLog,
  appendProtectMeRequestAttemptLog,
  buildCommandSnippetMetadata,
} from "../src/logging/blocked-attempt-log.ts";
import { resolveProtectMeConfigPaths } from "../src/config/index.ts";

const tmpRoot = await mkdtemp(join(tmpdir(), "protectme-blocked-log-"));
let caseIndex = 0;

test.after(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

test("blocked attempt creates the project JSONL log when absent", async () => {
  const paths = createCasePaths("blocked");
  const entry = await appendBlockedAttemptLog({
    ...baseBlockedAttemptInput(paths),
    timestamp: "2026-07-03T00:00:00.000Z",
  });
  const lines = await readJsonLines(paths.blockedAttemptLogPath);

  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0], entry);
  assert.equal(lines[0].timestamp, "2026-07-03T00:00:00.000Z");
  assert.equal(lines[0].cwd, paths.cwd);
  assert.equal(lines[0].toolName, "bash");
  assert.equal(lines[0].host, "example.com");
  assert.equal(lines[0].attempt, 1);
  assert.equal(lines[0].mode, "block");
  assert.equal(lines[0].outcome, "blocked");
  assert.equal(lines[0].commandSnippet.snippet, "curl https://example.com");
  assert.equal(lines[0].commandSnippet.truncated, false);
  assert.deepEqual(lines[0].configSources, baseConfigSources(paths));
});

test("multiple blocked attempts append valid JSON lines", async () => {
  const paths = createCasePaths("jsonl");

  await appendBlockedAttemptLog(baseBlockedAttemptInput(paths));
  await appendBlockedAttemptLog({
    ...baseBlockedAttemptInput(paths),
    host: "api.example.com",
    rawUrl: "https://api.example.com/v1",
    normalizedUrl: "https://api.example.com/v1",
    attempt: 2,
    outcome: "prompt_unavailable",
  });

  const lines = await readJsonLines(paths.blockedAttemptLogPath);

  assert.equal(lines.length, 2);
  assert.deepEqual(
    lines.map((line) => line.outcome),
    ["blocked", "prompt_unavailable"],
  );
});

test("allowed requests are not logged", async () => {
  const paths = createCasePaths("allowed");
  const result = await appendProtectMeRequestAttemptLog({
    ...baseBlockedAttemptInput(paths),
    outcome: "allowed",
  });

  assert.deepEqual(result, { logged: false, entry: null });
  await assert.rejects(access(paths.blockedAttemptLogPath), { code: "ENOENT" });
});

test("long command snippets are truncated and visibly marked", async () => {
  const paths = createCasePaths("truncated");
  const secretCommand = `curl -H 'Authorization: Bearer super-secret-token' https://example.com/${"a".repeat(120)}?token=secret`;
  const entry = await appendBlockedAttemptLog({
    ...baseBlockedAttemptInput(paths),
    command: secretCommand,
    commandSnippetMaxLength: 80,
  });
  const lines = await readJsonLines(paths.blockedAttemptLogPath);

  assert.equal(lines[0].commandSnippet.truncated, true);
  assert.equal(lines[0].commandSnippet.redacted, true);
  assert.equal(lines[0].commandSnippet.maxLength, 80);
  assert.match(lines[0].commandSnippet.snippet, /…\[truncated\]$/u);
  assert.doesNotMatch(lines[0].commandSnippet.snippet, /super-secret-token|token=secret/u);
  assert.deepEqual(lines[0].commandSnippet, entry.commandSnippet);
});

test("command snippet metadata exposes truncation without file writes", () => {
  const metadata = buildCommandSnippetMetadata(`curl https://example.com/${"b".repeat(60)}`, 40);

  assert.equal(metadata.truncated, true);
  assert.equal(metadata.snippet.length, 40);
  assert.equal(metadata.originalLength > metadata.maxLength, true);
  assert.equal(metadata.omittedCharacters > 0, true);
});

function createCasePaths(name) {
  caseIndex += 1;

  return resolveProtectMeConfigPaths({
    cwd: join(tmpRoot, `${caseIndex}-${name}`, "project"),
    homeDir: join(tmpRoot, `${caseIndex}-${name}`, "home"),
  });
}

function baseBlockedAttemptInput(paths) {
  return {
    logPath: paths.blockedAttemptLogPath,
    cwd: paths.cwd,
    toolName: "bash",
    command: "curl https://example.com",
    rawUrl: "https://example.com",
    normalizedUrl: "https://example.com",
    host: "example.com",
    attempt: 1,
    mode: "block",
    configSources: baseConfigSources(paths),
    outcome: "blocked",
  };
}

function baseConfigSources(paths) {
  return [
    {
      source: "global",
      path: paths.globalConfigPath,
      status: "missing",
    },
    {
      source: "project",
      path: paths.projectConfigPath,
      status: "missing",
    },
  ];
}

async function readJsonLines(path) {
  const text = await readFile(path, "utf8");

  return text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}
