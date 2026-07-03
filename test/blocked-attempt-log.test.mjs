import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  appendBlockedAttemptLog,
  appendProtectMeRequestAttemptLog,
  BLOCKED_ATTEMPT_LOG_RETENTION_DESCRIPTION,
  buildCommandSnippetMetadata,
  readRecentBlockedHosts,
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

test("blocked-attempt log entries redact sensitive URL, header, cookie, and auth-flag data", async () => {
  const paths = createCasePaths("redacted");
  const command = [
    "curl --user alice:password-one --proxy-user proxy:password-two",
    "-H 'Authorization: Bearer bearer-secret'",
    "-H 'Cookie: session=cookie-secret; theme=light'",
    "-H 'X-API-Key: api-secret'",
    "https://user:password-three@example.com/path?token=query-secret&safe=ok",
    "&& http --auth bob:password-four GET https://api.example.com/v1?api_key=query-key-secret",
  ].join(" ");

  await appendBlockedAttemptLog({
    ...baseBlockedAttemptInput(paths),
    command,
    rawUrl: "https://user:password-three@example.com/path?token=query-secret&safe=ok",
    normalizedUrl: "https://user:password-three@example.com/path?token=query-secret&safe=ok",
  });

  const lines = await readJsonLines(paths.blockedAttemptLogPath);
  const serializedLine = JSON.stringify(lines[0]);

  assert.equal(lines[0].commandSnippet.redacted, true);
  assert.match(lines[0].commandSnippet.snippet, /\[REDACTED\]/u);
  assert.match(lines[0].rawUrl, /\[REDACTED\]@example\.com/u);
  assert.match(lines[0].rawUrl, /token=\[REDACTED\]/u);
  assert.match(lines[0].normalizedUrl, /token=\[REDACTED\]/u);
  assert.doesNotMatch(
    serializedLine,
    /password-one|password-two|password-three|password-four|bearer-secret|cookie-secret|api-secret|query-secret|query-key-secret/u,
  );
});

test("command snippet metadata exposes truncation without file writes", () => {
  const metadata = buildCommandSnippetMetadata(`curl https://example.com/${"b".repeat(60)}`, 40);

  assert.equal(metadata.truncated, true);
  assert.equal(metadata.snippet.length, 40);
  assert.equal(metadata.originalLength > metadata.maxLength, true);
  assert.equal(metadata.omittedCharacters > 0, true);
});

test("recent blocked-host reads use a bounded tail window for large logs", async () => {
  const paths = createCasePaths("recent-tail");
  const oldLogText = buildSyntheticOldLogText(10_000);
  const tailLogText = buildRecentTailLogText();

  await mkdir(dirname(paths.blockedAttemptLogPath), { recursive: true });
  await writeFile(paths.blockedAttemptLogPath, `${oldLogText}${tailLogText}`, "utf8");

  const hosts = await readRecentBlockedHosts(paths.blockedAttemptLogPath, 4, {
    chunkBytes: 37,
    maxScanBytes: Buffer.byteLength(tailLogText, "utf8") + 1,
  });

  assert.deepEqual(hosts, ["newest.example.com", "duplicate.example.com", "latest.example.com", "tail-old.example.com"]);
  assert.equal(hosts.some((host) => host.startsWith("old-")), false);
});

test("blocked-attempt log retention policy is explicit and documentation-only", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

  assert.match(BLOCKED_ATTEMPT_LOG_RETENTION_DESCRIPTION, /append-only/u);
  assert.match(BLOCKED_ATTEMPT_LOG_RETENTION_DESCRIPTION, /does not compact, upload, or delete/u);
  assert.match(BLOCKED_ATTEMPT_LOG_RETENTION_DESCRIPTION, /bounded tail window/u);
  assert.match(readme, /append-only/u);
  assert.match(readme, /bounded tail window/u);
  assert.match(readme, /Delete or truncate `\.pi\/agent\/protectme_log\.jsonl`/u);
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

function buildSyntheticOldLogText(count) {
  let text = "";

  for (let index = 0; index < count; index += 1) {
    text += `${JSON.stringify({ host: `old-${index}.example.com`, padding: "x".repeat(80) })}\n`;
  }

  return text;
}

function buildRecentTailLogText() {
  return [
    JSON.stringify({ host: "tail-old.example.com" }),
    "{malformed",
    JSON.stringify({ host: "duplicate.example.com" }),
    JSON.stringify({ host: "latest.example.com" }),
    JSON.stringify({ host: "duplicate.example.com" }),
    JSON.stringify({ host: "newest.example.com" }),
  ].join("\n").concat("\n");
}

async function readJsonLines(path) {
  const text = await readFile(path, "utf8");

  return text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}
