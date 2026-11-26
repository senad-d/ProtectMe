import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  DEFAULT_PROTECTME_ALLOW_LIST,
  loadProtectMeConfig,
  loadProtectMeConfigWithGlobalDefault,
  mutateGlobalProtectMeConfig,
  mutateProjectProtectMeConfig,
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
  assert.deepEqual(result.effective.allowList, withDefaultAllowList("example.com", "api.example.com", "project.example.com"));
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

test("malformed mixed-source configs force fail-closed effective config", async () => {
  const malformedProjectPaths = createCasePaths("malformed-project-over-global-allow");
  await writeJsonConfig(malformedProjectPaths.globalConfigPath, { mode: "allow", allowList: ["global.example.com"] });
  await writeRawConfig(malformedProjectPaths.projectConfigPath, "{");

  const malformedProjectResult = await loadProtectMeConfig(malformedProjectPaths);

  assert.equal(malformedProjectResult.globalConfig.status, "valid");
  assert.equal(malformedProjectResult.projectConfig.status, "invalid");
  assertFailClosedEffectiveConfig(malformedProjectResult, /project config invalid/u);

  const malformedGlobalPaths = createCasePaths("malformed-global-before-project-allow");
  await writeRawConfig(malformedGlobalPaths.globalConfigPath, "{");
  await writeJsonConfig(malformedGlobalPaths.projectConfigPath, { mode: "allow", allowList: ["project.example.com"] });

  const malformedGlobalResult = await loadProtectMeConfig(malformedGlobalPaths);

  assert.equal(malformedGlobalResult.globalConfig.status, "invalid");
  assert.equal(malformedGlobalResult.projectConfig.status, "valid");
  assert.equal(malformedGlobalResult.projectConfig.config?.mode, "allow");
  assertFailClosedEffectiveConfig(malformedGlobalResult, /global config invalid/u);
});

test("unreadable mixed-source configs force fail-closed effective config", async () => {
  const unreadableProjectPaths = createCasePaths("unreadable-project-over-global-allow");
  await writeJsonConfig(unreadableProjectPaths.globalConfigPath, { mode: "allow", allowList: ["global.example.com"] });
  await mkdir(dirname(unreadableProjectPaths.projectConfigPath), { recursive: true });
  await mkdir(unreadableProjectPaths.projectConfigPath);

  const unreadableProjectResult = await loadProtectMeConfig(unreadableProjectPaths);

  assert.equal(unreadableProjectResult.globalConfig.status, "valid");
  assert.equal(unreadableProjectResult.projectConfig.status, "unreadable");
  assertFailClosedEffectiveConfig(unreadableProjectResult, /project config unreadable/u);

  const unreadableGlobalPaths = createCasePaths("unreadable-global-before-project-allow");
  await mkdir(dirname(unreadableGlobalPaths.globalConfigPath), { recursive: true });
  await mkdir(unreadableGlobalPaths.globalConfigPath);
  await writeJsonConfig(unreadableGlobalPaths.projectConfigPath, { mode: "allow", allowList: ["project.example.com"] });

  const unreadableGlobalResult = await loadProtectMeConfig(unreadableGlobalPaths);

  assert.equal(unreadableGlobalResult.globalConfig.status, "unreadable");
  assert.equal(unreadableGlobalResult.projectConfig.status, "valid");
  assert.equal(unreadableGlobalResult.projectConfig.config?.mode, "allow");
  assertFailClosedEffectiveConfig(unreadableGlobalResult, /global config unreadable/u);
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
  assert.deepEqual(result.effective.allowList, withDefaultAllowList("global.example.com"));
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
  assert.deepEqual(result.effective.allowList, withDefaultAllowList("global.example.com", "project.example.com"));
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
  assert.deepEqual(result.effective.allowList, withDefaultAllowList("global.example"));
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
  assert.deepEqual(result.effective.allowList, withDefaultAllowList("project.example"));
  assert.deepEqual(result.effective.allowListSources, ["project"]);
});

test("missing config resolves to block mode with the starter allowList", async () => {
  const paths = createCasePaths("missing");
  const result = await loadProtectMeConfig(paths);

  assert.equal(result.globalConfig.status, "missing");
  assert.equal(result.projectConfig.status, "missing");
  assert.equal(result.effective.mode, "block");
  assert.equal(result.effective.modeSource, "default");
  assert.deepEqual(result.effective.allowList, [...DEFAULT_PROTECTME_ALLOW_LIST]);
});

test("runtime config loading initializes a missing global config file", async () => {
  const paths = createCasePaths("auto-create-global");
  const result = await loadProtectMeConfigWithGlobalDefault(paths);
  const globalConfigText = await readFile(paths.globalConfigPath, "utf8");

  assert.equal(result.globalConfig.status, "valid");
  assert.equal(result.globalConfig.config?.mode, "block");
  assert.deepEqual(result.globalConfig.config?.allowList, [...DEFAULT_PROTECTME_ALLOW_LIST]);
  assert.equal(result.projectConfig.status, "missing");
  assert.equal(result.effective.mode, "block");
  assert.equal(result.effective.modeSource, "global");
  assert.deepEqual(result.effective.allowList, [...DEFAULT_PROTECTME_ALLOW_LIST]);
  assert.equal(globalConfigText, `${JSON.stringify({ mode: "block", allowList: [...DEFAULT_PROTECTME_ALLOW_LIST] }, null, 2)}\n`);
});

test("runtime global config initialization preserves untrusted project isolation", async () => {
  const paths = createCasePaths("auto-create-global-untrusted-project");
  await writeJsonConfig(paths.projectConfigPath, { mode: "allow", allowList: ["project.example.com"] });

  const result = await loadProtectMeConfigWithGlobalDefault({ ...paths, projectTrusted: false });

  assert.equal(result.globalConfig.status, "valid");
  assert.equal(result.projectConfig.status, "ignored");
  assert.equal(result.effective.mode, "block");
  assert.deepEqual(result.effective.allowList, [...DEFAULT_PROTECTME_ALLOW_LIST]);
  assert.match(result.effective.warnings.join("\n"), /project config ignored/);
});

test("invalid allowList entries are ignored with warning metadata", async () => {
  const paths = createCasePaths("invalid-allow-list-entry");
  await writeJsonConfig(paths.globalConfigPath, {
    mode: "block",
    allowList: ["example.com", "bad host", "EXAMPLE.com.", "https:///"],
  });

  const result = await loadProtectMeConfig(paths);

  assert.equal(result.globalConfig.status, "valid");
  assert.deepEqual(result.effective.allowList, withDefaultAllowList("example.com"));
  assert.match(result.effective.warnings.join("\n"), /global allowList entry ignored \("bad host"\)/);
  assert.match(result.effective.warnings.join("\n"), /global allowList entry ignored \("https:\/\/\/"\)/);
});

test("public suffix allowList entries are ignored while single-label entries stay exact", async () => {
  const paths = createCasePaths("public-suffix-allow-list-entry");
  await writeJsonConfig(paths.globalConfigPath, {
    mode: "block",
    allowList: ["com", "co.uk", "example.com", "internal-service", "localhost", "127.0.0.1", "2001:db8::1"],
  });

  const result = await loadProtectMeConfig(paths);

  assert.equal(result.globalConfig.status, "valid");
  assert.deepEqual(result.effective.allowList, withDefaultAllowList("example.com", "internal-service", "2001:db8::1"));
  assert.match(result.effective.warnings.join("\n"), /global allowList entry ignored \("com"\): Public suffix entries/);
  assert.match(result.effective.warnings.join("\n"), /global allowList entry ignored \("co.uk"\): Public suffix entries/);
});

test("denyList merges from both configs, survives a broken other source, and must be an array of strings", async () => {
  const paths = createCasePaths("deny-list");
  await writeJsonConfig(paths.globalConfigPath, { denyList: ["https://Tracker.example/x", "bad host"] });
  await writeJsonConfig(paths.projectConfigPath, { allowList: ["api.tracker.example"], denyList: ["ads.example"] });

  const result = await loadProtectMeConfig(paths);

  assert.deepEqual(result.effective.denyList, ["tracker.example", "ads.example"]);
  assert.deepEqual(result.globalConfig.config, { denyList: ["https://Tracker.example/x", "bad host"] });
  assert.equal(result.effective.warnings.some((warning) => warning.startsWith('global denyList entry ignored ("bad host")')), true);

  await writeRawConfig(paths.projectConfigPath, "{");
  assert.deepEqual((await loadProtectMeConfig(paths)).effective.denyList, ["tracker.example"]);

  const invalid = parseProtectMeConfigText("project", paths.projectConfigPath, JSON.stringify({ denyList: "tracker.example" }));
  assert.equal(invalid.status, "invalid");
  assert.equal(invalid.message, 'Config field "denyList" must be an array of strings when present.');
});

test("a config mutation appends to the file as it is on disk, not to an older copy", async () => {
  const paths = createCasePaths("fresh-read");
  await writeJsonConfig(paths.globalConfigPath, { allowList: ["one.example"] });
  await loadProtectMeConfig(paths);
  // Another process saves an entry after this one loaded the config.
  await writeJsonConfig(paths.globalConfigPath, { allowList: ["one.example", "two.example"], denyList: ["ads.example"] });

  await mutateGlobalProtectMeConfig(paths, (config) => ({ ...config, allowList: [...(config.allowList ?? []), "three.example"] }));

  assert.deepEqual(JSON.parse(await readFile(paths.globalConfigPath, "utf8")), {
    allowList: ["one.example", "two.example", "three.example"],
    denyList: ["ads.example"],
  });
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

test("saving project config keeps git status clean, appends to an existing .pi/.gitignore once, and skips a tracked config", async () => {
  const paths = createCasePaths("gitignore");
  const projectRoot = paths.cwd;
  const ignorePath = join(dirname(paths.projectConfigPath), ".gitignore");
  const git = (...args) => execFileSync("git", args, { cwd: projectRoot, encoding: "utf8" });
  await mkdir(projectRoot, { recursive: true });
  git("init", "-q");

  await mutateProjectProtectMeConfig(paths, () => ({ allowList: ["one.example.com"] }));
  assert.equal(git("status", "--porcelain"), "");

  await writeRawConfig(ignorePath, "notes.md");
  await mutateProjectProtectMeConfig(paths, () => ({ allowList: ["two.example.com"] }));
  await mutateProjectProtectMeConfig(paths, () => ({ allowList: ["three.example.com"] }));
  assert.equal(await readFile(ignorePath, "utf8"), "notes.md\n.gitignore\nprotectme.json\n");

  await rm(ignorePath);
  git("add", "-f", paths.projectConfigPath);
  await mutateProjectProtectMeConfig(paths, () => ({ allowList: ["four.example.com"] }));
  await assert.rejects(readFile(ignorePath, "utf8"), { code: "ENOENT" });
});

test("queued project config mutations preserve concurrent allow-list edits", async () => {
  const paths = createCasePaths("queued-project-mutations");
  await writeJsonConfig(paths.projectConfigPath, { mode: "block", allowList: ["initial.example.com"] });

  await Promise.all([
    mutateProjectProtectMeConfig(paths, appendConfigEntryAfterDelay("one.example.com")),
    mutateProjectProtectMeConfig(paths, appendConfigEntryAfterDelay("two.example.com")),
    mutateProjectProtectMeConfig(paths, appendConfigEntryAfterDelay("three.example.com")),
  ]);

  const result = await loadProtectMeConfig(paths);

  assert.equal(result.projectConfig.status, "valid");
  assert.deepEqual(result.projectConfig.config?.allowList, [
    "initial.example.com",
    "one.example.com",
    "two.example.com",
    "three.example.com",
  ]);
});

test("queued global config mutations preserve mode and allow-list updates", async () => {
  const paths = createCasePaths("queued-global-mutations");
  await writeJsonConfig(paths.globalConfigPath, { mode: "block", allowList: ["initial.example.com"] });

  await Promise.all([
    mutateGlobalProtectMeConfig(paths, async (config) => {
      await waitOneTurn();
      return { ...config, mode: "allow" };
    }),
    mutateGlobalProtectMeConfig(paths, appendConfigEntryAfterDelay("queued.example.com")),
  ]);

  const result = await loadProtectMeConfig(paths);

  assert.equal(result.globalConfig.status, "valid");
  assert.deepEqual(result.globalConfig.config, {
    mode: "allow",
    allowList: ["initial.example.com", "queued.example.com"],
  });
});

test("concurrent same-millisecond writes use unique temporary paths", async () => {
  const paths = createCasePaths("same-millisecond-writes");
  const originalDateNow = Date.now;
  Date.now = () => 123456;

  try {
    await Promise.all([
      writeProjectProtectMeConfig(paths, { mode: "block", allowList: ["one.example.com"] }),
      writeProjectProtectMeConfig(paths, { mode: "allow", allowList: ["two.example.com"] }),
      writeProjectProtectMeConfig(paths, { mode: "block", allowList: ["three.example.com"] }),
    ]);
  } finally {
    Date.now = originalDateNow;
  }

  const result = await loadProtectMeConfig(paths);

  assert.equal(result.projectConfig.status, "valid");
  assert.ok(["block", "allow"].includes(result.projectConfig.config?.mode));
  assert.equal(result.projectConfig.config?.allowList?.length, 1);
});

test("failed queued mutations leave existing config intact", async () => {
  const paths = createCasePaths("failed-mutation");
  await writeJsonConfig(paths.projectConfigPath, { mode: "block", allowList: ["safe.example.com"] });

  await assert.rejects(
    mutateProjectProtectMeConfig(paths, async () => {
      await waitOneTurn();
      throw new Error("planned failure");
    }),
    /planned failure/u,
  );

  const result = await loadProtectMeConfig(paths);

  assert.deepEqual(result.projectConfig.config, { mode: "block", allowList: ["safe.example.com"] });
});

function appendConfigEntryAfterDelay(entry) {
  return async (config) => {
    await waitOneTurn();
    return { ...config, allowList: [...(config.allowList ?? []), entry] };
  };
}

async function waitOneTurn() {
  await Promise.resolve();
}

function withDefaultAllowList(...entries) {
  return [...DEFAULT_PROTECTME_ALLOW_LIST, ...entries];
}

function assertFailClosedEffectiveConfig(result, sourceWarningPattern) {
  assert.equal(result.effective.mode, "block");
  assert.equal(result.effective.modeSource, "default");
  assert.deepEqual(result.effective.allowList, []);
  assert.deepEqual(result.effective.allowListSources, []);
  assert.match(result.effective.warnings.join("\n"), sourceWarningPattern);
  assert.match(result.effective.warnings.join("\n"), /Effective config failed closed.*mode "block" and empty allowList/u);
}

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
