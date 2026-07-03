import assert from "node:assert/strict";
import test from "node:test";

import {
  appendProtectMeConfigAllowListEntry,
  buildProtectMeConfigEditSourceError,
  planProtectMeConfigAllowListAppend,
  readProtectMeConfigSourceAllowListEntries,
  removeProtectMeConfigAllowListEntry,
  selectProtectMeConfigEditSource,
  setProtectMeConfigMode,
} from "../src/config/index.ts";

test("config edit helpers select target sources and describe unsafe write targets", () => {
  const config = buildConfigResult(buildParsedConfigSource("global", "missing", null), buildIgnoredProjectConfigSource());

  assert.equal(selectProtectMeConfigEditSource(config, "global"), config.globalConfig);
  assert.equal(selectProtectMeConfigEditSource(config, "project"), config.projectConfig);
  assert.equal(buildProtectMeConfigEditSourceError(config.globalConfig), null);
  assert.equal(buildProtectMeConfigEditSourceError(config.projectConfig), "project config is ignored: Project is not trusted.");
});

test("allow-list append plans normalize entries and reject unsafe or invalid edits", () => {
  const validSource = buildParsedConfigSource("project", "valid", { allowList: [] });
  const invalidSource = buildInvalidConfigSource();

  assert.deepEqual(planProtectMeConfigAllowListAppend(validSource, "https://Example.com/login?q=1"), {
    ok: true,
    entry: "example.com",
  });
  assert.deepEqual(planProtectMeConfigAllowListAppend(validSource, undefined), {
    ok: false,
    reason: "No allow-list entry was confirmed.",
  });
  assert.deepEqual(planProtectMeConfigAllowListAppend(validSource, "bad host"), {
    ok: false,
    reason: 'Invalid allow-list entry: "bad host"',
  });
  assert.deepEqual(planProtectMeConfigAllowListAppend(invalidSource, "example.com"), {
    ok: false,
    reason: "global config is invalid: Invalid JSON",
  });
});

test("config edit mutations preserve mode while appending, removing, and toggling", () => {
  const config = { mode: "block", allowList: ["Example.com", "keep.example.com"] };

  assert.deepEqual(appendProtectMeConfigAllowListEntry(config, "example.com"), config);
  assert.deepEqual(appendProtectMeConfigAllowListEntry(config, "https://New.example.com/path"), {
    mode: "block",
    allowList: ["Example.com", "keep.example.com", "new.example.com"],
  });
  assert.deepEqual(removeProtectMeConfigAllowListEntry(config, "example.com"), {
    mode: "block",
    allowList: ["keep.example.com"],
  });
  assert.deepEqual(setProtectMeConfigMode(config, "allow"), {
    mode: "allow",
    allowList: ["Example.com", "keep.example.com"],
  });
});

test("config edit helpers expose normalized entries for selection lists", () => {
  const source = buildParsedConfigSource("project", "valid", {
    allowList: ["https://Example.com/path", "example.com", "bad host", "Project.example.com"],
  });

  assert.deepEqual(readProtectMeConfigSourceAllowListEntries(source), ["example.com", "project.example.com"]);
});

function buildConfigResult(globalConfig, projectConfig) {
  return {
    paths: {
      globalConfigPath: "/home/user/.pi/agent/protectme.json",
      projectConfigPath: "/workspace/project/.pi/protectme.json",
      blockedAttemptLogPath: "/workspace/project/.pi/agent/protectme_log.jsonl",
    },
    globalConfig,
    projectConfig,
    effective: {
      mode: "block",
      allowList: [],
      modeSource: "default",
      allowListSources: [],
      configSources: [globalConfig, projectConfig],
      warnings: [],
    },
  };
}

function buildParsedConfigSource(source, status, config) {
  return {
    source,
    path: `/tmp/${source}-protectme.json`,
    status,
    config,
  };
}

function buildIgnoredProjectConfigSource() {
  return {
    source: "project",
    path: "/workspace/project/.pi/protectme.json",
    status: "ignored",
    message: "Project is not trusted.",
    config: null,
  };
}

function buildInvalidConfigSource() {
  return {
    source: "global",
    path: "/home/user/.pi/agent/protectme.json",
    status: "invalid",
    message: "Invalid JSON",
    config: null,
  };
}
