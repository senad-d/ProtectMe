import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";

import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

import {
  createDefaultProtectMeConfig,
  resolveBlockedAttemptLogPath,
  resolveDefaultAgentDir,
  resolveGlobalConfigPath,
  resolveMissingProtectMeConfig,
  resolveProjectConfigPath,
  resolveProtectMeConfigPaths,
} from "../src/config/index.ts";

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

test("missing config resolves to blocking mode with an empty allowList", () => {
  const paths = resolveProtectMeConfigPaths({ cwd, homeDir });
  const defaultConfig = createDefaultProtectMeConfig();
  const missingConfig = resolveMissingProtectMeConfig(paths);

  assert.deepEqual(defaultConfig, { mode: "block", allowList: [] });
  assert.equal(missingConfig.globalConfig.status, "missing");
  assert.equal(missingConfig.projectConfig.status, "missing");
  assert.equal(missingConfig.globalConfig.path, paths.globalConfigPath);
  assert.equal(missingConfig.projectConfig.path, paths.projectConfigPath);
  assert.equal(missingConfig.effective.mode, "block");
  assert.deepEqual(missingConfig.effective.allowList, []);
  assert.equal(missingConfig.effective.modeSource, "default");
  assert.deepEqual(missingConfig.effective.allowListSources, []);
  assert.deepEqual(missingConfig.effective.configSources, [missingConfig.globalConfig, missingConfig.projectConfig]);
});
