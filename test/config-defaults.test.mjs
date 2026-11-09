import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

import {
  createDefaultProtectMeConfig,
  DEFAULT_PROTECTME_ALLOW_LIST,
  resolveBlockedAttemptLogPath,
  resolveDefaultAgentDir,
  resolveGlobalConfigPath,
  resolveMissingProtectMeConfig,
  resolveProjectConfigPath,
  resolveProjectRoot,
  resolveProtectMeConfigPaths,
} from "../src/config/index.ts";
import { appendBlockedAttemptLog } from "../src/logging/blocked-attempt-log.ts";

const cwd = resolve("test-fixtures", "project");
const homeDir = resolve("test-fixtures", "home");
const agentDir = join(homeDir, CONFIG_DIR_NAME, "agent");

test("config path helpers resolve deterministic ProtectMe paths", () => {
  const paths = resolveProtectMeConfigPaths({ cwd, homeDir });

  assert.equal(resolveDefaultAgentDir(homeDir), agentDir);
  assert.equal(resolveGlobalConfigPath(agentDir), join(agentDir, "protectme.json"));
  assert.equal(resolveProjectConfigPath(cwd), join(cwd, CONFIG_DIR_NAME, "protectme.json"));
  assert.equal(resolveBlockedAttemptLogPath(cwd), join(cwd, CONFIG_DIR_NAME, "agent", "protectme_log.jsonl"));
  assert.deepEqual(paths, {
    cwd,
    homeDir,
    agentDir,
    globalConfigPath: join(agentDir, "protectme.json"),
    projectConfigPath: join(cwd, CONFIG_DIR_NAME, "protectme.json"),
    blockedAttemptLogPath: join(cwd, CONFIG_DIR_NAME, "agent", "protectme_log.jsonl"),
  });
});

test("config path helpers honor Pi's custom global agent directory", () => {
  const customAgentDir = resolve("test-fixtures", "custom-agent-dir");
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = customAgentDir;

  try {
    const paths = resolveProtectMeConfigPaths({ cwd });

    assert.equal(paths.agentDir, customAgentDir);
    assert.equal(paths.globalConfigPath, join(customAgentDir, "protectme.json"));
    assert.equal(paths.projectConfigPath, join(cwd, CONFIG_DIR_NAME, "protectme.json"));
  } finally {
    if (previousAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    }
  }
});

test("missing config resolves to blocking mode with the starter allowList", () => {
  const paths = resolveProtectMeConfigPaths({ cwd, homeDir });
  const defaultConfig = createDefaultProtectMeConfig();
  const missingConfig = resolveMissingProtectMeConfig(paths);

  assert.deepEqual(defaultConfig, { mode: "block", allowList: [...DEFAULT_PROTECTME_ALLOW_LIST] });
  assert.equal(missingConfig.globalConfig.status, "missing");
  assert.equal(missingConfig.projectConfig.status, "missing");
  assert.equal(missingConfig.globalConfig.path, paths.globalConfigPath);
  assert.equal(missingConfig.projectConfig.path, paths.projectConfigPath);
  assert.equal(missingConfig.effective.mode, "block");
  assert.deepEqual(missingConfig.effective.allowList, [...DEFAULT_PROTECTME_ALLOW_LIST]);
  assert.equal(missingConfig.effective.modeSource, "default");
  assert.deepEqual(missingConfig.effective.allowListSources, []);
  assert.deepEqual(missingConfig.effective.configSources, [missingConfig.globalConfig, missingConfig.projectConfig]);
});

test("linked worktree git entries support relative paths, whitespace, and spaces in paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "protectme-git-entry-"));
  const mainRoot = join(root, "main repo");
  const worktreeRoot = join(root, "linked repo");
  const gitDir = join(mainRoot, ".git", "worktrees", "task");

  try {
    await mkdir(gitDir, { recursive: true });
    await mkdir(worktreeRoot);
    await writeFile(join(gitDir, "commondir"), "../..\n", "utf8");
    await writeFile(join(worktreeRoot, ".git"), "gitdir:\t ../main repo/.git/worktrees/task  \n", "utf8");

    assert.equal(resolveProjectRoot(worktreeRoot), mainRoot);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("malformed git entries leave the project root unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "protectme-bad-git-entry-"));

  try {
    await Promise.all([
      assertGitEntryFallback(root, "empty", `gitdir:${" ".repeat(100_000)}\n`),
      assertGitEntryFallback(root, "prefix", "not-gitdir: /missing\n"),
      assertGitEntryFallback(root, "missing", "gitdir: /missing/protectme/worktree\n"),
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function assertGitEntryFallback(root, name, contents) {
  const projectRoot = join(root, name);
  await mkdir(projectRoot);
  await writeFile(join(projectRoot, ".git"), contents, "utf8");

  assert.equal(resolveProjectRoot(projectRoot), projectRoot);
}

test("linked git worktree resolves project config and blocked-attempt log to the main worktree", async () => {
  const root = await mkdtemp(join(tmpdir(), "protectme-worktree-"));
  const mainRoot = join(root, "repo");
  const worktreeRoot = join(root, "repo-worktrees", "task-2");
  const git = (args, cwdPath = mainRoot) => execFileSync("git", args, { cwd: cwdPath, stdio: "pipe" });

  try {
    await mkdir(mainRoot, { recursive: true });
    git(["init", "-q"]);
    git(["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"]);
    git(["worktree", "add", "-q", worktreeRoot]);
    await mkdir(join(worktreeRoot, "sub"));

    const paths = resolveProtectMeConfigPaths({ cwd: join(worktreeRoot, "sub"), homeDir });
    const realMainRoot = await realpath(mainRoot);

    assert.equal(paths.projectConfigPath, join(realMainRoot, "sub", CONFIG_DIR_NAME, "protectme.json"));
    assert.equal(paths.blockedAttemptLogPath, join(realMainRoot, "sub", CONFIG_DIR_NAME, "agent", "protectme_log.jsonl"));
    assert.equal(resolveProjectRoot(join(mainRoot, "sub")), join(mainRoot, "sub"));
    assert.equal(resolveProjectRoot(root), root);

    await appendBlockedAttemptLog({ logPath: paths.blockedAttemptLogPath, cwd: worktreeRoot, toolName: "bash", command: "curl https://example.com", rawUrl: "https://example.com", normalizedUrl: "https://example.com", host: "example.com", attempt: 1, mode: "block", configSources: [], outcome: "blocked" });

    assert.equal(git(["check-ignore", "-q", paths.blockedAttemptLogPath]).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
