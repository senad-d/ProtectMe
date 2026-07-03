import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  loadProtectMeConfig,
  parseProtectMeConfigText,
  resolveProtectMeConfigPaths,
  writeGlobalProtectMeConfig,
  writeProjectProtectMeConfig,
} from "../src/config/index.ts";

const tmpRoot = await mkdtemp(join(tmpdir(), "protectme-config-loader-"));
let caseIndex = 0;

test.after(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

test("valid global and project configs merge in deterministic order", async () => {
  const paths = createCasePaths("merged");
  await writeJsonConfig(paths.globalConfigPath, {
    mode: "block",
    allowList: ["https://Example.com/login", "api.example.com"],
  });
  await writeJsonConfig(paths.projectConfigPath, {
    mode: "allow",
    allowList: ["example.com", "https://Project.example.com:443/v1?q=1", "api.example.com"],
  });

  const result = await loadProtectMeConfig(paths);

  assert.equal(result.globalConfig.status, "valid");
  assert.equal(result.projectConfig.status, "valid");
  assert.equal(result.effective.mode, "allow");
  assert.equal(result.effective.modeSource, "project");
  assert.deepEqual(result.effective.allowList, ["example.com", "api.example.com", "project.example.com"]);
  assert.deepEqual(result.effective.allowListSources, ["global", "project"]);
  assert.deepEqual(result.effective.warnings, []);
});

test("project allow mode overrides global block mode", async () => {
  const paths = createCasePaths("project-allow-over-global-block");
  await writeJsonConfig(paths.globalConfigPath, { mode: "block" });
  await writeJsonConfig(paths.projectConfigPath, { mode: "allow" });

  const result = await loadProtectMeConfig(paths);

  assert.equal(result.effective.mode, "allow");
  assert.equal(result.effective.modeSource, "project");
  assert.equal(result.globalConfig.config?.mode, "block");
  assert.equal(result.projectConfig.config?.mode, "allow");
});

test("untrusted project config is ignored without broadening global protection", async () => {
  const paths = createCasePaths("untrusted-project-ignored");
  await writeJsonConfig(paths.globalConfigPath, { mode: "block", allowList: ["global.example.com"] });
  await writeJsonConfig(paths.projectConfigPath, { mode: "allow", allowList: ["project.example.com"] });

  const result = await loadProtectMeConfig({ ...paths, projectTrusted: false });

  assert.equal(result.globalConfig.status, "valid");
  assert.equal(result.projectConfig.status, "ignored");
  assert.equal(result.projectConfig.config, null);
  assert.match(result.projectConfig.message ?? "", /not read.*not trusted/i);
  assert.equal(result.effective.mode, "block");
  assert.equal(result.effective.modeSource, "global");
  assert.deepEqual(result.effective.allowList, ["global.example.com"]);
  assert.deepEqual(result.effective.allowListSources, ["global"]);
  assert.match(result.effective.warnings.join("\n"), /project config ignored/);
  assert.doesNotMatch(result.effective.warnings.join("\n"), /project\.example\.com/);
});

test("trusted project config preserves documented global and project merge behavior", async () => {
  const paths = createCasePaths("trusted-project-merge");
  await writeJsonConfig(paths.globalConfigPath, { mode: "block", allowList: ["global.example.com"] });
  await writeJsonConfig(paths.projectConfigPath, { mode: "allow", allowList: ["project.example.com"] });

  const result = await loadProtectMeConfig({ ...paths, projectTrusted: true });

  assert.equal(result.projectConfig.status, "valid");
  assert.equal(result.effective.mode, "allow");
  assert.equal(result.effective.modeSource, "project");
  assert.deepEqual(result.effective.allowList, ["global.example.com", "project.example.com"]);
  assert.deepEqual(result.effective.allowListSources, ["global", "project"]);
});

test("global-only config contributes mode and normalized allowList", async () => {
  const paths = createCasePaths("global-only");
  await writeJsonConfig(paths.globalConfigPath, {
    mode: "allow",
    allowList: ["Global.example.", "global.example"],
  });

  const result = await loadProtectMeConfig(paths);

  assert.equal(result.globalConfig.status, "valid");
  assert.equal(result.projectConfig.status, "missing");
  assert.equal(result.effective.mode, "allow");
  assert.equal(result.effective.modeSource, "global");
  assert.deepEqual(result.effective.allowList, ["global.example"]);
  assert.deepEqual(result.effective.allowListSources, ["global"]);
});

test("project-only config contributes mode and normalized allowList", async () => {
  const paths = createCasePaths("project-only");
  await writeJsonConfig(paths.projectConfigPath, {
    mode: "block",
    allowList: ["https://Project.example/path"],
  });

  const result = await loadProtectMeConfig(paths);

  assert.equal(result.globalConfig.status, "missing");
  assert.equal(result.projectConfig.status, "valid");
  assert.equal(result.effective.mode, "block");
  assert.equal(result.effective.modeSource, "project");
  assert.deepEqual(result.effective.allowList, ["project.example"]);
  assert.deepEqual(result.effective.allowListSources, ["project"]);
});

test("missing config still resolves to fail-closed defaults", async () => {
  const paths = createCasePaths("missing");
  const result = await loadProtectMeConfig(paths);

  assert.equal(result.globalConfig.status, "missing");
  assert.equal(result.projectConfig.status, "missing");
  assert.equal(result.effective.mode, "block");
  assert.equal(result.effective.modeSource, "default");
  assert.deepEqual(result.effective.allowList, []);
});

test("invalid allowList entries are ignored with warning metadata", async () => {
  const paths = createCasePaths("invalid-allow-list-entry");
  await writeJsonConfig(paths.globalConfigPath, {
    mode: "block",
    allowList: ["example.com", "bad host", "EXAMPLE.com.", "https:///"],
  });

  const result = await loadProtectMeConfig(paths);

  assert.equal(result.globalConfig.status, "valid");
  assert.deepEqual(result.effective.allowList, ["example.com"]);
  assert.match(result.effective.warnings.join("\n"), /global allowList entry ignored \("bad host"\)/);
  assert.match(result.effective.warnings.join("\n"), /global allowList entry ignored \("https:\/\/\/"\)/);
});

test("invalid JSON config fails closed with metadata", async () => {
  const paths = createCasePaths("invalid-json");
  await writeRawConfig(paths.globalConfigPath, "{");

  const result = await loadProtectMeConfig(paths);

  assert.equal(result.globalConfig.status, "invalid");
  assert.match(result.globalConfig.message ?? "", /Invalid JSON/);
  assert.equal(result.effective.mode, "block");
  assert.equal(result.effective.modeSource, "default");
  assert.deepEqual(result.effective.allowList, []);
  assert.match(result.effective.warnings.join("\n"), /global config invalid/);
});

test("invalid schema config fails closed with metadata", () => {
  const parsed = parseProtectMeConfigText(
    "project",
    "/tmp/project/.pi/protectme.json",
    JSON.stringify({ mode: "disabled", allowList: ["example.com"] }),
  );

  assert.equal(parsed.status, "invalid");
  assert.equal(parsed.config, null);
  assert.match(parsed.message ?? "", /mode/);
});

test("unreadable config fails closed with metadata", async () => {
  const paths = createCasePaths("unreadable");
  await mkdir(dirname(paths.projectConfigPath), { recursive: true });
  await mkdir(paths.projectConfigPath);

  const result = await loadProtectMeConfig(paths);

  assert.equal(result.projectConfig.status, "unreadable");
  assert.match(result.projectConfig.message ?? "", /Unable to read ProtectMe config/);
  assert.equal(result.effective.mode, "block");
  assert.equal(result.effective.modeSource, "default");
  assert.deepEqual(result.effective.allowList, []);
  assert.match(result.effective.warnings.join("\n"), /project config unreadable/);
});

test("write helpers create parent directories and use two-space JSON", async () => {
  const paths = createCasePaths("write");

  await writeProjectProtectMeConfig(paths, { mode: "allow", allowList: ["Example.com"] });
  await writeGlobalProtectMeConfig(paths, { mode: "block", allowList: ["Global.example"] });

  const projectConfigText = await readFile(paths.projectConfigPath, "utf8");
  const globalConfigText = await readFile(paths.globalConfigPath, "utf8");

  assert.equal(projectConfigText, '{\n  "mode": "allow",\n  "allowList": [\n    "Example.com"\n  ]\n}\n');
  assert.equal(globalConfigText, '{\n  "mode": "block",\n  "allowList": [\n    "Global.example"\n  ]\n}\n');
});

function createCasePaths(name) {
  caseIndex += 1;

  return resolveProtectMeConfigPaths({
    cwd: join(tmpRoot, `${caseIndex}-${name}`, "project"),
    homeDir: join(tmpRoot, `${caseIndex}-${name}`, "home"),
  });
}

async function writeJsonConfig(path, config) {
  await writeRawConfig(path, JSON.stringify(config));
}

async function writeRawConfig(path, text) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, "utf8");
}
