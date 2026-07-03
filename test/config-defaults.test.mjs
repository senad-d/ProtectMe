import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  createDefaultProtectMeConfig,
  resolveBlockedAttemptLogPath,
  resolveGlobalConfigPath,
  resolveMissingProtectMeConfig,
  resolveProjectConfigPath,
  resolveProtectMeConfigPaths,
} from "../src/config/index.ts";

const cwd = resolve("test-fixtures", "project");
const homeDir = resolve("test-fixtures", "home");

test("config path helpers resolve deterministic ProtectMe paths", () => {
  const paths = resolveProtectMeConfigPaths({ cwd, homeDir });

  assert.equal(resolveGlobalConfigPath(homeDir), join(homeDir, ".pi/agent/protectme.json"));
  assert.equal(resolveProjectConfigPath(cwd), join(cwd, ".pi/protectme.json"));
  assert.equal(resolveBlockedAttemptLogPath(cwd), join(cwd, ".pi/agent/protectme_log.jsonl"));
  assert.deepEqual(paths, {
    cwd,
    homeDir,
    globalConfigPath: join(homeDir, ".pi/agent/protectme.json"),
    projectConfigPath: join(cwd, ".pi/protectme.json"),
    blockedAttemptLogPath: join(cwd, ".pi/agent/protectme_log.jsonl"),
  });
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
