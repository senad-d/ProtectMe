import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_PROTECTME_ALLOW_LIST, mergeProtectMeConfigs } from "../src/config/index.ts";
import { PROTECTME_COMMAND_NAME } from "../src/constants.ts";
import {
  createDefaultNetworkGuardDependencies,
  PROTECTME_GUIDANCE_CUSTOM_MESSAGE_TYPE,
  PROTECTME_SECOND_ATTEMPT_CHOICES,
  registerNetworkGuardEvents,
} from "../src/events/network-guard.ts";
import { buildBlockedAttemptLogEntry } from "../src/logging/blocked-attempt-log.ts";
import { registerProtectMeCommand } from "../src/ui/protectme-panel.ts";

const cwd = "/workspace/project";
const homeDir = "/home/user";
const agentDir = `${homeDir}/.pi/agent`;
const starterStatusText = `🌐 (${DEFAULT_PROTECTME_ALLOW_LIST.length} sites)`;
const plainTheme = {
  fg(_role, text) {
    return text;
  },
  bold(text) {
    return text;
  },
};

test("Pi-context lifecycle integration resets status and attempts on reload-like starts", async () => {
  const harness = new ProtectMeIntegrationHarness();
  const state = harness.registerNetwork();
  const ctx = new FakePiContext({ mode: "tui", hasUI: true, selectChoices: [PROTECTME_SECOND_ATTEMPT_CHOICES.keepBlocked] });
  const event = { type: "tool_call", toolCallId: "call-1", toolName: "bash", input: { command: "curl https://reload.example.com" } };

  await emitSessionStart(harness.pi, ctx, "startup");
  await emitToolCall(harness.pi, event, ctx);
  await emitToolCall(harness.pi, event, ctx);
  await emitSessionShutdown(harness.pi, ctx, "reload");
  await emitSessionStart(harness.pi, ctx, "reload");
  await emitToolCall(harness.pi, event, ctx);

  assert.equal(state.blockedHostAttempts.get("reload.example.com"), 1);
  assert.deepEqual(
    harness.loggedAttempts.map((attempt) => attempt.attempt),
    [1, 2, 1],
  );
  assert.deepEqual(ctx.ui.statusCalls, [
    { key: "protectme", text: starterStatusText },
    { key: "protectme", text: undefined },
    { key: "protectme", text: starterStatusText },
  ]);
  assert.equal(harness.pi.userMessages.length, 0);
  assert.equal(harness.pi.messages.length, 2);
  assert.equal(harness.pi.messages[0].message.customType, PROTECTME_GUIDANCE_CUSTOM_MESSAGE_TYPE);
  assert.deepEqual(harness.pi.messages[0].options, { deliverAs: "steer" });
});

test("Pi-context trust integration passes untrusted state through event and command contexts", async () => {
  const harness = new ProtectMeIntegrationHarness(buildIgnoredProjectConfigResult());
  harness.registerNetwork();
  harness.registerCommand();
  const ctx = new FakePiContext({ mode: "tui", hasUI: true, projectTrusted: false });

  await emitSessionStart(harness.pi, ctx, "startup");
  await runProtectMeCommand(harness.pi, ctx);

  assert.deepEqual(harness.loadInputs, [
    { cwd, homeDir, agentDir, projectTrusted: false },
    { cwd, homeDir, agentDir, projectTrusted: false },
  ]);
  assert.equal(ctx.ui.statusCalls[0].text, `${starterStatusText} · project config ignored`);
  assert.match(ctx.ui.notifications[0].message, /project config ignored/u);
  assert.equal(ctx.ui.customCalls.length, 1);
  assert.equal(ctx.ui.renderedLines.some((line) => line.includes("project config ignored")), true);
  assert.deepEqual(harness.recentLogPaths, [`${cwd}/.pi/agent/protectme_log.jsonl`]);
});

test("Pi command mode contract opens custom UI only in TUI mode", async () => {
  const cases = [
    { mode: "tui", hasUI: true, expectedCustomCalls: 1, expectedLoadCalls: 1, expectedWarnings: [] },
    { mode: "rpc", hasUI: true, expectedCustomCalls: 0, expectedLoadCalls: 0, expectedWarnings: ["/protectme requires Pi TUI mode."] },
    { mode: "json", hasUI: false, expectedCustomCalls: 0, expectedLoadCalls: 0, expectedWarnings: [] },
    { mode: "print", hasUI: false, expectedCustomCalls: 0, expectedLoadCalls: 0, expectedWarnings: [] },
  ];

  for (const testCase of cases) {
    const harness = new ProtectMeIntegrationHarness();
    harness.registerCommand();
    const ctx = new FakePiContext({ mode: testCase.mode, hasUI: testCase.hasUI });

    await runProtectMeCommand(harness.pi, ctx);

    assert.equal(ctx.ui?.customCalls.length ?? 0, testCase.expectedCustomCalls, testCase.mode);
    assert.equal(harness.loadInputs.length, testCase.expectedLoadCalls, testCase.mode);
    assert.deepEqual(
      ctx.ui?.notifications.map((notification) => notification.message) ?? [],
      testCase.expectedWarnings,
      testCase.mode,
    );
    if (testCase.mode === "tui") assert.equal(ctx.ui.doneValues.length, 1);
  }
});

test("Pi-context repeated attempt integration uses RPC UI dialogs without user-message guidance", async () => {
  const harness = new ProtectMeIntegrationHarness();
  harness.registerNetwork();
  const ctx = new FakePiContext({ mode: "rpc", hasUI: true, selectChoices: [PROTECTME_SECOND_ATTEMPT_CHOICES.allowOnce] });
  const event = { type: "tool_call", toolCallId: "call-1", toolName: "bash", input: { command: "curl https://rpc.example.com" } };

  const firstResult = await emitToolCall(harness.pi, event, ctx);
  const secondResult = await emitToolCall(harness.pi, event, ctx);

  assert.equal(firstResult?.block, true);
  assert.equal(secondResult, undefined);
  assert.equal(ctx.ui.selectCalls.length, 1);
  assert.match(ctx.ui.selectCalls[0].title, /rpc\.example\.com/u);
  assert.equal(harness.loggedAttempts.length, 1);
  assert.equal(harness.loggedAttempts[0].outcome, "blocked");
  assert.equal(harness.pi.messages.length, 1);
  assert.equal(harness.pi.userMessages.length, 0);
});

class FakePiRuntime {
  constructor() {
    this.eventHandlers = {};
    this.commands = {};
    this.messages = [];
    this.userMessages = [];
  }

  on(eventName, handler) {
    this.eventHandlers[eventName] ??= [];
    this.eventHandlers[eventName].push(handler);
  }

  registerCommand(name, command) {
    this.commands[name] = command;
  }

  sendMessage(message, options) {
    this.messages.push({ message, options });
  }

  sendUserMessage(content, options) {
    this.userMessages.push({ content, options });
  }
}

class ProtectMeIntegrationHarness {
  constructor(config = buildConfigResult()) {
    this.pi = new FakePiRuntime();
    this.config = config;
    this.loadInputs = [];
    this.loggedAttempts = [];
    this.projectWrites = [];
    this.globalWrites = [];
    this.recentBlockedHosts = ["recent.example.com"];
    this.recentLogPaths = [];

    const defaultNetworkDependencies = createDefaultNetworkGuardDependencies(this.pi);
    this.networkDependencies = {
      getHomeDir: this.getHomeDir.bind(this),
      getAgentDir: this.getAgentDir.bind(this),
      loadConfig: this.loadConfig.bind(this),
      appendBlockedAttemptLog: this.appendBlockedAttemptLog.bind(this),
      mutateProjectConfig: this.mutateProjectConfig.bind(this),
      mutateGlobalConfig: this.mutateGlobalConfig.bind(this),
      sendGuidance: defaultNetworkDependencies.sendGuidance,
    };
    this.commandDependencies = {
      getHomeDir: this.getHomeDir.bind(this),
      getAgentDir: this.getAgentDir.bind(this),
      loadConfig: this.loadConfig.bind(this),
      readRecentBlockedHosts: this.readRecentBlockedHosts.bind(this),
      mutateProjectConfig: this.mutateProjectConfig.bind(this),
      mutateGlobalConfig: this.mutateGlobalConfig.bind(this),
    };
  }

  registerNetwork() {
    return registerNetworkGuardEvents(this.pi, this.networkDependencies);
  }

  registerCommand() {
    registerProtectMeCommand(this.pi, this.commandDependencies);
  }

  getHomeDir() {
    return homeDir;
  }

  getAgentDir() {
    return agentDir;
  }

  async loadConfig(input) {
    this.loadInputs.push(input);
    return this.config;
  }

  async appendBlockedAttemptLog(input) {
    this.loggedAttempts.push(input);
    return buildBlockedAttemptLogEntry(input);
  }

  async mutateProjectConfig(paths, mutation) {
    const nextConfigFile = await mutation(this.config.projectConfig.config ?? {});
    this.projectWrites.push({ paths, config: nextConfigFile });
    this.config = buildConfigResult({ globalConfigFile: this.config.globalConfig.config, projectConfigFile: nextConfigFile });
    return nextConfigFile;
  }

  async mutateGlobalConfig(paths, mutation) {
    const nextConfigFile = await mutation(this.config.globalConfig.config ?? {});
    this.globalWrites.push({ paths, config: nextConfigFile });
    this.config = buildConfigResult({ globalConfigFile: nextConfigFile, projectConfigFile: this.config.projectConfig.config });
    return nextConfigFile;
  }

  async readRecentBlockedHosts(logPath) {
    this.recentLogPaths.push(logPath);
    return this.recentBlockedHosts;
  }
}

class FakePiContext {
  constructor(options) {
    this.cwd = cwd;
    this.mode = options.mode;
    this.hasUI = options.hasUI;
    this.projectTrusted = options.projectTrusted;
    this.ui = options.hasUI ? new FakeExtensionUi(options) : undefined;
    if ("projectTrusted" in options) this.isProjectTrusted = this.readProjectTrusted.bind(this);
  }

  readProjectTrusted() {
    return this.projectTrusted;
  }
}

class FakeExtensionUi {
  constructor(options) {
    this.selectChoices = [...(options.selectChoices ?? [])];
    this.editorValues = [...(options.editorValues ?? [])];
    this.selectCalls = [];
    this.editorCalls = [];
    this.statusCalls = [];
    this.notifications = [];
    this.customCalls = [];
    this.customComponents = [];
    this.doneValues = [];
    this.renderedLines = [];
    this.renderRequests = 0;
  }

  async select(title, options) {
    this.selectCalls.push({ title, options });
    return this.selectChoices.shift();
  }

  async editor(title, prefill) {
    this.editorCalls.push({ title, prefill });
    return this.editorValues.shift();
  }

  setStatus(key, text) {
    this.statusCalls.push({ key, text });
  }

  notify(message, type) {
    this.notifications.push({ message, type });
  }

  async custom(factory) {
    this.customCalls.push(factory);
    const component = factory({ requestRender: this.requestRender.bind(this) }, plainTheme, { source: "fake-keybindings" }, this.recordDone.bind(this));
    this.customComponents.push(component);
    this.renderedLines = component.render(140);
    component.handleInput?.("q");
    return this.doneValues.at(-1);
  }

  requestRender() {
    this.renderRequests += 1;
  }

  recordDone(value) {
    this.doneValues.push(value);
  }
}

async function emitSessionStart(pi, ctx, reason) {
  await emitEvery(pi, "session_start", { type: "session_start", reason }, ctx);
}

async function emitSessionShutdown(pi, ctx, reason) {
  await emitEvery(pi, "session_shutdown", { type: "session_shutdown", reason }, ctx);
}

async function emitEvery(pi, eventName, event, ctx) {
  for (const handler of pi.eventHandlers[eventName] ?? []) await handler(event, ctx);
}

async function emitToolCall(pi, event, ctx) {
  let latestResult;
  for (const handler of pi.eventHandlers.tool_call ?? []) {
    latestResult = await handler(event, ctx);
    if (latestResult?.block) return latestResult;
  }

  return latestResult;
}

async function runProtectMeCommand(pi, ctx) {
  const command = pi.commands[PROTECTME_COMMAND_NAME];
  assert.ok(command, "ProtectMe command should be registered");
  await command.handler("", ctx);
}

function buildConfigResult(options = {}) {
  const globalConfig = buildParsedConfigSource("global", `${agentDir}/protectme.json`, "valid", options.globalConfigFile ?? { mode: "block" });
  const projectConfig = buildParsedConfigSource("project", `${cwd}/.pi/protectme.json`, options.projectStatus ?? "missing", options.projectConfigFile ?? null);

  return buildConfigResultFromSources(globalConfig, projectConfig);
}

function buildIgnoredProjectConfigResult() {
  const globalConfig = buildParsedConfigSource("global", `${agentDir}/protectme.json`, "valid", { mode: "block" });
  const projectConfig = buildParsedConfigSource(
    "project",
    `${cwd}/.pi/protectme.json`,
    "ignored",
    null,
    "Project config was not read because the current project is not trusted.",
  );

  return buildConfigResultFromSources(globalConfig, projectConfig);
}

function buildConfigResultFromSources(globalConfig, projectConfig) {
  return {
    paths: {
      cwd,
      homeDir,
      agentDir,
      globalConfigPath: `${agentDir}/protectme.json`,
      projectConfigPath: `${cwd}/.pi/protectme.json`,
      blockedAttemptLogPath: `${cwd}/.pi/agent/protectme_log.jsonl`,
    },
    globalConfig,
    projectConfig,
    effective: mergeProtectMeConfigs(globalConfig, projectConfig),
  };
}

function buildParsedConfigSource(source, path, status, config, message) {
  return {
    source,
    path,
    status,
    message,
    config,
  };
}
