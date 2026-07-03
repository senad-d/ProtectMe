import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { visibleWidth } from "@earendil-works/pi-tui";

import { mergeProtectMeConfigs } from "../src/config/index.ts";
import {
  extractRecentBlockedHosts,
  handleProtectMeCommand,
  ProtectMePanelComponent,
  readRecentBlockedHosts,
} from "../src/ui/protectme-panel.ts";

const plainTheme = {
  fg(_role, text) {
    return text;
  },
  bold(text) {
    return text;
  },
};

const cwd = "/workspace/project";
const homeDir = "/home/user";

test("ProtectMe panel wide layout uses two panes and displays config state", () => {
  const component = createPanelComponent();
  const lines = component.render(96);

  assert.equal(lines[0].startsWith("╭"), true);
  assert.equal(lines.some((line) => line.includes("┬")), true);
  assert.equal(lines.some((line) => line.includes("Configuration")), true);
  assert.equal(lines.some((line) => line.includes("Global config path") && line.includes("/global/protectme.json")), true);
  assert.equal(lines.some((line) => line.includes("Project config path") && line.includes("/project/protectme.json")), true);
  assert.equal(lines.some((line) => line.includes("Effective mode") && line.includes("block")), true);
  assert.equal(lines.some((line) => line.includes("Global site count") && line.includes("2")), true);
  assert.equal(lines.some((line) => line.includes("Project site count") && line.includes("1")), true);
  assert.equal(lines.some((line) => line.includes("Effective site count") && line.includes("3")), true);
  assert.equal(lines.some((line) => line.includes("Recent blocked hosts") && line.includes("api.example.com")), true);
  assertLinesFit(lines, 96);
});

test("ProtectMe panel narrow layout uses one framed pane", () => {
  const component = createPanelComponent();
  const lines = component.render(50);

  assert.equal(lines[0].startsWith("╭"), true);
  assert.equal(lines.some((line) => line.includes("┬")), false);
  assert.equal(lines.some((line) => line.includes("CONFIGURATION")), true);
  assert.equal(lines.some((line) => line.includes("Effective mode") && line.includes("block")), true);
  assertLinesFit(lines, 50);
});

test("ProtectMe panel tiny layout uses minimal no-border fallback", () => {
  const component = createPanelComponent();
  const lines = component.render(20);

  assert.deepEqual(lines.map((line) => line.trim()), ["ProtectMe", "mode block", "sites 3", "q quit"]);
  assert.equal(lines.some((line) => /[╭╮╰╯│]/u.test(line)), false);
  assertLinesFit(lines, 20);
});

test("ProtectMe panel closes with q and rerenders after selection movement", () => {
  let closed = false;
  let renderRequests = 0;
  const component = new ProtectMePanelComponent(buildPanelState(), plainTheme, () => {
    closed = true;
  }, () => {
    renderRequests += 1;
  });

  component.handleInput("\u001b[B");
  const linesAfterMove = component.render(96);
  component.handleInput("q");

  assert.equal(renderRequests, 1);
  assert.equal(linesAfterMove.some((line) => line.includes("Write target") && line.includes("▶")), true);
  assert.equal(closed, true);
});

test("/protectme command opens custom UI only in TUI mode", async () => {
  const context = createFakeCommandContext("tui");
  const dependencies = createFakeCommandDependencies();

  const opened = await handleProtectMeCommand(context, dependencies);

  assert.equal(opened, true);
  assert.equal(dependencies.loadCalls, 1);
  assert.equal(context.ui.customCalls.length, 1);
  assert.equal(context.ui.notifications.length, 0);
  assert.equal(context.ui.renderedLines.some((line) => line.includes("Effective mode") && line.includes("block")), true);
});

test("/protectme command displays ignored project config state for untrusted projects", async () => {
  const context = createFakeCommandContext("tui", { projectTrusted: false });
  const dependencies = createFakeCommandDependencies(buildIgnoredProjectConfigResult());

  const opened = await handleProtectMeCommand(context, dependencies);

  assert.equal(opened, true);
  assert.deepEqual(dependencies.loadInputs, [{ cwd, homeDir, projectTrusted: false }]);
  assert.equal(context.ui.renderedLines.some((line) => line.includes("project config ignored")), true);
});

test("ProtectMe panel action chooses the project or global write target", async () => {
  const editable = createEditablePanel();

  editable.component.handleInput("\u001b[B");
  editable.ui.selectChoices.push("Global config");
  editable.component.handleInput("\r");
  await flushPanelActions();

  assert.deepEqual(editable.ui.selectCalls, [{ title: "ProtectMe write target", options: ["Project config", "Global config"] }]);
  assert.equal(editable.component.render(96).some((line) => line.includes("writes global config")), true);
});

test("ProtectMe panel actions toggle mode and add project/global entries", async () => {
  const editable = createEditablePanel();

  editable.component.handleInput("\r");
  await flushPanelActions();

  assert.equal(editable.state.config.effective.mode, "allow");
  assert.deepEqual(editable.projectWrites.at(-1).config, { mode: "allow", allowList: ["project.example.com"] });

  editable.ui.editorValues.push("https://New.Example.com/path?q=1");
  editable.component.handleInput("a");
  await flushPanelActions();

  assert.deepEqual(editable.projectWrites.at(-1).config, {
    mode: "allow",
    allowList: ["project.example.com", "new.example.com"],
  });

  editable.component.handleInput("g");
  editable.ui.editorValues.push("Global-Add.example.com");
  editable.component.handleInput("a");
  await flushPanelActions();

  assert.deepEqual(editable.globalWrites.at(-1).config, {
    mode: "block",
    allowList: ["global.example.com", "global-add.example.com"],
  });
  assert.equal(editable.state.config.effective.allowList.length, 4);
  assert.equal(editable.component.render(96).some((line) => line.includes("Effective site count") && line.includes("4")), true);
});

test("ProtectMe panel actions remove entries from project and global configs", async () => {
  const editable = createEditablePanel(
    buildEditableConfigResult(
      { mode: "block", allowList: ["global.example.com", "keep-global.example.com"] },
      { allowList: ["project.example.com", "keep-project.example.com"] },
    ),
  );

  editable.ui.selectChoices.push("project.example.com");
  editable.component.handleInput("r");
  await flushPanelActions();

  assert.deepEqual(editable.projectWrites.at(-1).config, { allowList: ["keep-project.example.com"] });

  editable.component.handleInput("g");
  editable.ui.selectChoices.push("global.example.com");
  editable.component.handleInput("r");
  await flushPanelActions();

  assert.deepEqual(editable.globalWrites.at(-1).config, { mode: "block", allowList: ["keep-global.example.com"] });
  assert.equal(editable.state.config.effective.allowList.length, 2);
});

test("ProtectMe panel write failures show errors and keep loaded config unchanged", async () => {
  const initialConfig = buildEditableConfigResult();
  const state = { config: initialConfig, recentBlockedHosts: ["api.example.com"] };
  const ui = createFakeActionUi({ editorValues: ["fail.example.com"] });
  const component = new ProtectMePanelComponent(state, plainTheme, () => {}, () => {}, {
    cwd,
    homeDir,
    ui,
    async loadConfig() {
      throw new Error("load should not run after failed write");
    },
    async readRecentBlockedHosts() {
      return [];
    },
    async writeProjectConfig() {
      throw new Error("disk full");
    },
    async writeGlobalConfig() {},
  });

  component.handleInput("a");
  await flushPanelActions();

  assert.equal(state.config, initialConfig);
  assert.deepEqual(ui.notifications, [
    {
      message: "ProtectMe config edit failed: Failed to write project config: disk full",
      type: "error",
    },
  ]);
  assert.equal(component.render(96).some((line) => line.includes("Failed to write project config")), true);
});

test("ProtectMe panel rejects project config edits while project config is ignored", async () => {
  const editable = createEditablePanel(buildIgnoredProjectConfigResult());

  editable.ui.editorValues.push("project-only.example.com");
  editable.component.handleInput("a");
  await flushPanelActions();

  assert.equal(editable.ui.editorCalls.length, 0);
  assert.equal(editable.projectWrites.length, 0);
  assert.match(editable.ui.notifications[0].message, /project config is ignored/u);
  assert.equal(editable.component.render(96).some((line) => line.includes("project config ignored")), true);
});

test("/protectme command explains TUI requirement outside TUI mode", async () => {
  const context = createFakeCommandContext("rpc");
  const dependencies = createFakeCommandDependencies();

  const opened = await handleProtectMeCommand(context, dependencies);

  assert.equal(opened, false);
  assert.equal(dependencies.loadCalls, 0);
  assert.equal(context.ui.customCalls.length, 0);
  assert.deepEqual(context.ui.notifications, [{ message: "/protectme requires Pi TUI mode.", type: "warning" }]);
});

test("recent blocked hosts are read from newest unique JSONL entries", async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "protectme-panel-log-"));
  const logPath = join(tmpRoot, "protectme_log.jsonl");

  try {
    await writeFile(
      logPath,
      [
        JSON.stringify({ host: "old.example.com" }),
        "not-json",
        JSON.stringify({ host: "api.example.com" }),
        JSON.stringify({ host: "old.example.com" }),
        JSON.stringify({ host: "latest.example.com" }),
      ].join("\n"),
      "utf8",
    );

    assert.deepEqual(await readRecentBlockedHosts(logPath, 3), ["latest.example.com", "old.example.com", "api.example.com"]);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("recent blocked host extraction ignores malformed and hostless lines", () => {
  const hosts = extractRecentBlockedHosts(
    ["{}", JSON.stringify({ host: "first.example.com" }), "{", JSON.stringify({ host: "second.example.com" })].join("\n"),
    5,
  );

  assert.deepEqual(hosts, ["second.example.com", "first.example.com"]);
});

function createPanelComponent() {
  return new ProtectMePanelComponent(buildPanelState(), plainTheme, () => {}, () => {});
}

function createEditablePanel(config = buildEditableConfigResult()) {
  let currentConfig = config;
  const state = {
    config: currentConfig,
    recentBlockedHosts: ["api.example.com"],
  };
  const ui = createFakeActionUi();
  const projectWrites = [];
  const globalWrites = [];
  const actionDependencies = {
    cwd,
    homeDir,
    ui,
    async loadConfig(input) {
      assert.deepEqual(input, { cwd, homeDir });
      return currentConfig;
    },
    async readRecentBlockedHosts(logPath) {
      assert.equal(logPath, `${cwd}/.pi/agent/protectme_log.jsonl`);
      return state.recentBlockedHosts;
    },
    async writeProjectConfig(paths, configFile) {
      projectWrites.push({ paths, config: configFile });
      currentConfig = buildEditableConfigResult(currentConfig.globalConfig.config, configFile);
    },
    async writeGlobalConfig(paths, configFile) {
      globalWrites.push({ paths, config: configFile });
      currentConfig = buildEditableConfigResult(configFile, currentConfig.projectConfig.config);
    },
  };
  const component = new ProtectMePanelComponent(state, plainTheme, () => {}, () => {}, actionDependencies);

  return {
    component,
    globalWrites,
    projectWrites,
    state,
    ui,
  };
}

function createFakeActionUi(options = {}) {
  const selectChoices = [...(options.selectChoices ?? [])];
  const editorValues = [...(options.editorValues ?? [])];
  const selectCalls = [];
  const editorCalls = [];
  const notifications = [];

  return {
    editorCalls,
    editorValues,
    notifications,
    selectCalls,
    selectChoices,
    async select(title, choices) {
      selectCalls.push({ title, options: choices });
      return selectChoices.shift();
    },
    async editor(title, prefill) {
      editorCalls.push({ title, prefill });
      return editorValues.shift();
    },
    notify(message, type) {
      notifications.push({ message, type });
    },
  };
}

function buildEditableConfigResult(globalConfigFile = { mode: "block", allowList: ["global.example.com"] }, projectConfigFile = { allowList: ["project.example.com"] }) {
  const globalConfig = buildParsedConfigSource("global", `${homeDir}/.pi/agent/protectme.json`, globalConfigFile);
  const projectConfig = buildParsedConfigSource("project", `${cwd}/.pi/protectme.json`, projectConfigFile);

  return buildConfigResultFromSources(globalConfig, projectConfig);
}

function buildIgnoredProjectConfigResult() {
  const globalConfig = buildParsedConfigSource("global", `${homeDir}/.pi/agent/protectme.json`, { mode: "block" });
  const projectConfig = {
    source: "project",
    path: `${cwd}/.pi/protectme.json`,
    status: "ignored",
    message: "Project config was not read because the current project is not trusted.",
    config: null,
  };

  return buildConfigResultFromSources(globalConfig, projectConfig);
}

function buildConfigResultFromSources(globalConfig, projectConfig) {
  return {
    paths: {
      cwd,
      homeDir,
      globalConfigPath: `${homeDir}/.pi/agent/protectme.json`,
      projectConfigPath: `${cwd}/.pi/protectme.json`,
      blockedAttemptLogPath: `${cwd}/.pi/agent/protectme_log.jsonl`,
    },
    globalConfig,
    projectConfig,
    effective: mergeProtectMeConfigs(globalConfig, projectConfig),
  };
}

function buildParsedConfigSource(source, path, config) {
  return {
    source,
    path,
    status: config ? "valid" : "missing",
    config,
  };
}

async function flushPanelActions() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function buildPanelState() {
  return {
    config: buildConfigResult(),
    recentBlockedHosts: ["api.example.com", "docs.example.com"],
  };
}

function buildConfigResult() {
  const globalConfig = {
    source: "global",
    path: "/global/protectme.json",
    status: "valid",
    config: { mode: "block", allowList: ["example.com", "api.example.com"] },
  };
  const projectConfig = {
    source: "project",
    path: "/project/protectme.json",
    status: "valid",
    config: { allowList: ["project.example.com"] },
  };

  return {
    paths: {
      cwd,
      homeDir,
      globalConfigPath: "/global/protectme.json",
      projectConfigPath: "/project/protectme.json",
      blockedAttemptLogPath: "/project/protectme_log.jsonl",
    },
    globalConfig,
    projectConfig,
    effective: {
      mode: "block",
      allowList: ["example.com", "api.example.com", "project.example.com"],
      modeSource: "global",
      allowListSources: ["global", "project"],
      configSources: [globalConfig, projectConfig],
      warnings: [],
    },
  };
}

function buildExpectedConfigLoadInput(input) {
  if (input.projectTrusted === false) return { cwd, homeDir, projectTrusted: false };

  return { cwd, homeDir };
}

function createFakeCommandContext(mode, options = {}) {
  const ui = {
    customCalls: [],
    notifications: [],
    renderedLines: [],
    async custom(factory) {
      this.customCalls.push(factory);
      const component = factory(
        { requestRender() {} },
        plainTheme,
        {},
        () => {},
      );
      this.renderedLines = component.render(96);
    },
    notify(message, type) {
      this.notifications.push({ message, type });
    },
  };

  const context = {
    cwd,
    mode,
    hasUI: true,
    ui,
  };

  if ("projectTrusted" in options) context.isProjectTrusted = () => options.projectTrusted;

  return context;
}

function createFakeCommandDependencies(config = buildConfigResult()) {
  const loadInputs = [];
  let loadCalls = 0;

  return {
    loadInputs,
    get loadCalls() {
      return loadCalls;
    },
    getHomeDir() {
      return homeDir;
    },
    async loadConfig(input) {
      loadCalls += 1;
      loadInputs.push(input);
      assert.deepEqual(input, buildExpectedConfigLoadInput(input));
      return config;
    },
    async readRecentBlockedHosts(logPath) {
      assert.equal(logPath, config.paths.blockedAttemptLogPath);
      return ["api.example.com"];
    },
    async writeProjectConfig() {},
    async writeGlobalConfig() {},
  };
}

function assertLinesFit(lines, width) {
  for (const line of lines) assert.equal(visibleWidth(line) <= width, true, line);
}
