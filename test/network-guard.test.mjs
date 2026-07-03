import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProtectMeConfigWarningMessage,
  createNetworkGuardState,
  handleNetworkGuardSessionShutdown,
  handleNetworkGuardSessionStart,
  handleNetworkGuardToolCall,
  PROTECTME_SECOND_ATTEMPT_CHOICES,
  registerNetworkGuardEvents,
  resetNetworkGuardSessionState,
} from "../src/events/network-guard.ts";
import { buildBlockedAttemptLogEntry } from "../src/logging/blocked-attempt-log.ts";

const cwd = "/workspace/project";
const homeDir = "/home/user";

test("session start resets attempts, loads config, sets status, and shows warnings", async () => {
  const state = createNetworkGuardState();
  const config = buildConfigResult({ allowList: ["example.com", "api.example.com"], warnings: ["project allowList entry ignored (\"bad host\"): invalid host"] });
  const fake = createFakeDependencies(config);
  const ctx = createFakeContext({ hasUI: true });
  state.blockedHostAttempts.set("example.com", 3);

  await handleNetworkGuardSessionStart(ctx, state, fake.dependencies);

  assert.equal(state.blockedHostAttempts.size, 0);
  assert.equal(fake.loadCalls, 1);
  assert.deepEqual(ctx.ui.statusCalls, [{ key: "protectme", text: "ProtectMe: block · 2 sites" }]);
  assert.deepEqual(ctx.ui.notifications, [
    {
      message: 'ProtectMe config warning: project allowList entry ignored ("bad host"): invalid host',
      type: "warning",
    },
  ]);
});

test("session shutdown clears ProtectMe status when UI is available", () => {
  const ctx = createFakeContext({ hasUI: true });

  handleNetworkGuardSessionShutdown(ctx);

  assert.deepEqual(ctx.ui.statusCalls, [{ key: "protectme", text: undefined }]);
});

test("config warning messages are bounded", () => {
  assert.equal(
    buildProtectMeConfigWarningMessage(["one", "two", "three", "four"]),
    "ProtectMe config warning: one; two; three; +1 more",
  );
  assert.equal(buildProtectMeConfigWarningMessage([]), null);
});

test("invalid config warns on session start and still fails closed on tool calls", async () => {
  const state = createNetworkGuardState();
  const fake = createFakeDependencies(buildInvalidConfigResult());
  const ctx = createFakeContext({ hasUI: true });

  await handleNetworkGuardSessionStart(ctx, state, fake.dependencies);
  const result = await handleNetworkGuardToolCall(
    { toolName: "bash", input: { command: "curl https://example.com" } },
    ctx,
    state,
    fake.dependencies,
  );

  assert.equal(ctx.ui.statusCalls[0].text, "ProtectMe: block · 0 sites");
  assert.equal(ctx.ui.notifications.length, 1);
  assert.match(ctx.ui.notifications[0].message, /global config invalid/u);
  assert.deepEqual(result, {
    block: true,
    reason:
      'ProtectMe blocked network request to example.com. mode: "block" allows only configured hosts. Do not retry blindly; continue with local or already allowed work, or ask the user if access is required.',
  });
  assert.equal(fake.loggedAttempts.length, 1);
  assert.equal(fake.loggedAttempts[0].outcome, "blocked");
});

test("first disallowed bash request blocks, logs once, and sends guidance", async () => {
  const state = createNetworkGuardState();
  const fake = createFakeDependencies(buildConfigResult());
  const ctx = createFakeContext();

  const result = await handleNetworkGuardToolCall(
    { toolName: "bash", input: { command: "curl https://example.com" } },
    ctx,
    state,
    fake.dependencies,
  );

  assert.deepEqual(result, {
    block: true,
    reason:
      'ProtectMe blocked network request to example.com. mode: "block" allows only configured hosts. Do not retry blindly; continue with local or already allowed work, or ask the user if access is required.',
  });
  assert.equal(ctx.abortCalled, false);
  assert.equal(fake.loggedAttempts.length, 1);
  assert.equal(fake.loggedAttempts[0].host, "example.com");
  assert.equal(fake.loggedAttempts[0].attempt, 1);
  assert.equal(fake.loggedAttempts[0].outcome, "blocked");
  assert.equal(fake.loggedAttempts[0].command, "curl https://example.com");
  assert.equal(fake.guidanceMessages.length, 1);
  assert.match(fake.guidanceMessages[0].message, /Do not retry blindly/u);
  assert.match(fake.guidanceMessages[0].message, /Continue with local or already allowed work/u);
  assert.deepEqual(fake.guidanceMessages[0].options, { deliverAs: "followUp" });
});

test("allowed bash request is not blocked or logged", async () => {
  const state = createNetworkGuardState();
  const fake = createFakeDependencies(buildConfigResult({ allowList: ["example.com"] }));

  const result = await handleNetworkGuardToolCall(
    { toolName: "bash", input: { command: "curl https://api.example.com" } },
    createFakeContext(),
    state,
    fake.dependencies,
  );

  assert.equal(result, undefined);
  assert.equal(fake.loggedAttempts.length, 0);
  assert.equal(fake.guidanceMessages.length, 0);
});

test("wrapped bash requests are still detected and blocked", async () => {
  const state = createNetworkGuardState();
  const fake = createFakeDependencies(buildConfigResult());

  const result = await handleNetworkGuardToolCall(
    { toolName: "bash", input: { command: "sudo -u root env TOKEN=1 timeout 5 nice -n 1 curl https://wrapped.example.com" } },
    createFakeContext(),
    state,
    fake.dependencies,
  );

  assert.deepEqual(result, {
    block: true,
    reason:
      'ProtectMe blocked network request to wrapped.example.com. mode: "block" allows only configured hosts. Do not retry blindly; continue with local or already allowed work, or ask the user if access is required.',
  });
  assert.equal(fake.loggedAttempts.length, 1);
  assert.equal(fake.loggedAttempts[0].host, "wrapped.example.com");
});

test("network-affecting option values must also be allowed", async () => {
  const state = createNetworkGuardState();
  const fake = createFakeDependencies(buildConfigResult({ allowList: ["target.example.com"] }));

  const result = await handleNetworkGuardToolCall(
    { toolName: "bash", input: { command: "curl --proxy http://proxy.example.com:8080 https://target.example.com" } },
    createFakeContext(),
    state,
    fake.dependencies,
  );

  assert.deepEqual(result, {
    block: true,
    reason:
      'ProtectMe blocked network request to proxy.example.com. mode: "block" allows only configured hosts. Do not retry blindly; continue with local or already allowed work, or ask the user if access is required.',
  });
  assert.equal(fake.loggedAttempts.length, 1);
  assert.equal(fake.loggedAttempts[0].rawUrl, "http://proxy.example.com:8080");
  assert.equal(fake.loggedAttempts[0].host, "proxy.example.com");
});

test("blocked request log inputs redact URL credentials, query tokens, headers, and auth flags", async () => {
  const state = createNetworkGuardState();
  const fake = createFakeDependencies(buildConfigResult());
  const command = [
    "curl --user alice:password-one --proxy-user proxy:password-two",
    "-H 'Cookie: session=cookie-secret'",
    "-H 'X-API-Key: api-secret'",
    "https://user:password-three@private.example.com/path?token=query-secret",
  ].join(" ");

  await handleNetworkGuardToolCall({ toolName: "bash", input: { command } }, createFakeContext(), state, fake.dependencies);

  const loggedAttempt = fake.loggedAttempts[0];
  const serializedAttempt = JSON.stringify(loggedAttempt);
  assert.match(loggedAttempt.rawUrl, /\[REDACTED\]@private\.example\.com/u);
  assert.match(loggedAttempt.rawUrl, /token=\[REDACTED\]/u);
  assert.equal(loggedAttempt.normalizedUrl, loggedAttempt.rawUrl);
  assert.doesNotMatch(serializedAttempt, /password-one|password-two|password-three|cookie-secret|api-secret|query-secret/u);
});

test("unsupported static network option sources fail closed even when visible URLs are allowed", async () => {
  const state = createNetworkGuardState();
  const fake = createFakeDependencies(buildConfigResult({ allowList: ["allowed.example.com"] }));
  const event = { toolName: "bash", input: { command: "curl --config .curlrc https://allowed.example.com" } };

  const firstResult = await handleNetworkGuardToolCall(event, createFakeContext({ hasUI: true }), state, fake.dependencies);
  const secondResult = await handleNetworkGuardToolCall(event, createFakeContext({ hasUI: true }), state, fake.dependencies);

  assert.deepEqual(firstResult, {
    block: true,
    reason:
      "ProtectMe blocked curl because --config .curlrc cannot be inspected safely: curl config files can contain additional URLs or network options that ProtectMe cannot inspect safely.",
  });
  assert.deepEqual(secondResult, firstResult);
  assert.equal(fake.loggedAttempts.length, 2);
  assert.equal(fake.loggedAttempts[0].host, "unsupported static network option");
  assert.equal(fake.guidanceMessages.length, 0);
});

test("mode allow lets all supported bash request CLIs proceed without logging or prompts", async () => {
  const state = createNetworkGuardState();
  const fake = createFakeDependencies(buildConfigResult({ mode: "allow" }));
  const ctx = createFakeContext({ hasUI: true, selectChoices: [PROTECTME_SECOND_ATTEMPT_CHOICES.keepBlocked] });
  const commands = [
    "curl https://curl.example.com",
    "wget https://wget.example.com/file",
    "http GET https://http.example.com/v1",
    "https POST https://https.example.com/v1",
  ];

  for (const command of commands) {
    const result = await handleNetworkGuardToolCall({ toolName: "bash", input: { command } }, ctx, state, fake.dependencies);
    assert.equal(result, undefined);
  }

  assert.equal(fake.loadCalls, commands.length);
  assert.equal(fake.loggedAttempts.length, 0);
  assert.equal(fake.guidanceMessages.length, 0);
  assert.equal(fake.projectWrites.length, 0);
  assert.equal(fake.globalWrites.length, 0);
  assert.equal(ctx.ui.selectCalls.length, 0);
  assert.equal(ctx.ui.editorCalls.length, 0);
  assert.equal(state.blockedHostAttempts.size, 0);
});

test("project allow mode disables blocking even when global mode is block", async () => {
  const state = createNetworkGuardState();
  const fake = createFakeDependencies(buildProjectAllowOverGlobalBlockConfigResult());
  const ctx = createFakeContext({ hasUI: true, selectChoices: [PROTECTME_SECOND_ATTEMPT_CHOICES.keepBlocked] });

  const result = await handleNetworkGuardToolCall(
    { toolName: "bash", input: { command: "curl https://blocked.example.com" } },
    ctx,
    state,
    fake.dependencies,
  );

  assert.equal(result, undefined);
  assert.equal(fake.loggedAttempts.length, 0);
  assert.equal(fake.guidanceMessages.length, 0);
  assert.equal(ctx.ui.selectCalls.length, 0);
  assert.equal(state.blockedHostAttempts.size, 0);
});

test("mixed-source invalid config fails closed in network guard despite permissive other source", async () => {
  const configResults = [buildMixedInvalidProjectFailClosedConfigResult(), buildMixedInvalidGlobalFailClosedConfigResult()];

  for (const configResult of configResults) {
    const state = createNetworkGuardState();
    const fake = createFakeDependencies(configResult);
    const ctx = createFakeContext({ hasUI: true });

    await handleNetworkGuardSessionStart(ctx, state, fake.dependencies);
    const result = await handleNetworkGuardToolCall(
      { toolName: "bash", input: { command: "curl https://permissive.example.com" } },
      ctx,
      state,
      fake.dependencies,
    );

    assert.equal(ctx.ui.statusCalls[0].text, "ProtectMe: block · 0 sites");
    assert.match(ctx.ui.notifications[0].message, /Effective config failed closed/u);
    assert.deepEqual(result, {
      block: true,
      reason:
        'ProtectMe blocked network request to permissive.example.com. mode: "block" allows only configured hosts. Do not retry blindly; continue with local or already allowed work, or ask the user if access is required.',
    });
    assert.equal(fake.loggedAttempts.length, 1);
    assert.equal(fake.loggedAttempts[0].outcome, "blocked");
  }
});

test("untrusted project config is visible as ignored and does not disable blocking", async () => {
  const state = createNetworkGuardState();
  const fake = createFakeDependencies(buildUntrustedProjectIgnoredConfigResult());
  const ctx = createFakeContext({ hasUI: true, projectTrusted: false });

  await handleNetworkGuardSessionStart(ctx, state, fake.dependencies);
  const result = await handleNetworkGuardToolCall(
    { toolName: "bash", input: { command: "curl https://project-only.example.com" } },
    ctx,
    state,
    fake.dependencies,
  );

  assert.deepEqual(fake.loadInputs, [
    { cwd, homeDir, projectTrusted: false },
    { cwd, homeDir, projectTrusted: false },
  ]);
  assert.equal(ctx.ui.statusCalls[0].text, "ProtectMe: block · 0 sites · project config ignored");
  assert.match(ctx.ui.notifications[0].message, /project config ignored/u);
  assert.deepEqual(result, {
    block: true,
    reason:
      'ProtectMe blocked network request to project-only.example.com. mode: "block" allows only configured hosts. Do not retry blindly; continue with local or already allowed work, or ask the user if access is required.',
  });
  assert.equal(fake.loggedAttempts.length, 1);
});

test("untrusted project config cannot be used for repeated-attempt allow-list writes", async () => {
  const state = createNetworkGuardState();
  const fake = createFakeDependencies(buildUntrustedProjectIgnoredConfigResult());
  const ctx = createFakeContext({
    hasUI: true,
    projectTrusted: false,
    selectChoices: [PROTECTME_SECOND_ATTEMPT_CHOICES.addProject],
    editorValues: ["project-only.example.com"],
  });
  const event = { toolName: "bash", input: { command: "curl https://project-only.example.com" } };

  await handleNetworkGuardToolCall(event, ctx, state, fake.dependencies);
  const result = await handleNetworkGuardToolCall(event, ctx, state, fake.dependencies);

  assert.deepEqual(result, {
    block: true,
    reason: "ProtectMe kept blocking network request to project-only.example.com. The user did not approve this call.",
  });
  assert.deepEqual(fake.loadInputs, [
    { cwd, homeDir, projectTrusted: false },
    { cwd, homeDir, projectTrusted: false },
  ]);
  assert.equal(ctx.ui.selectCalls.length, 1);
  assert.equal(ctx.ui.editorCalls.length, 0);
  assert.equal(fake.projectWrites.length, 0);
  assert.match(ctx.ui.notifications[0].message, /project config is ignored/u);
  assert.equal(fake.loggedAttempts.at(-1).outcome, "prompt_denied");
});

test("non-bash and non-network bash inputs are ignored", async () => {
  const state = createNetworkGuardState();
  const fake = createFakeDependencies(buildConfigResult());

  assert.equal(
    await handleNetworkGuardToolCall(
      { toolName: "write", input: { command: "curl https://example.com", path: "README.md" } },
      createFakeContext(),
      state,
      fake.dependencies,
    ),
    undefined,
  );
  assert.equal(
    await handleNetworkGuardToolCall(
      { toolName: "bash", input: { command: "echo https://example.com" } },
      createFakeContext(),
      state,
      fake.dependencies,
    ),
    undefined,
  );
  assert.equal(fake.loadCalls, 0);
  assert.equal(fake.loggedAttempts.length, 0);
});

test("attempt counts are session-scoped and guidance is first-attempt only", async () => {
  const state = createNetworkGuardState();
  const fake = createFakeDependencies(buildConfigResult());
  const event = { toolName: "bash", input: { command: "curl https://example.com" } };

  await handleNetworkGuardToolCall(event, createFakeContext(), state, fake.dependencies);
  await handleNetworkGuardToolCall(event, createFakeContext(), state, fake.dependencies);

  assert.deepEqual(
    fake.loggedAttempts.map((attempt) => attempt.attempt),
    [1, 2],
  );
  assert.equal(fake.guidanceMessages.length, 1);

  resetNetworkGuardSessionState(state);
  await handleNetworkGuardToolCall(event, createFakeContext(), state, fake.dependencies);

  assert.deepEqual(
    fake.loggedAttempts.map((attempt) => attempt.attempt),
    [1, 2, 1],
  );
  assert.equal(fake.guidanceMessages.length, 2);
});

test("second blocked attempt opens UI prompt and allow once proceeds without config writes", async () => {
  const state = createNetworkGuardState();
  const fake = createFakeDependencies(buildConfigResult());
  const ctx = createFakeContext({ hasUI: true, selectChoices: [PROTECTME_SECOND_ATTEMPT_CHOICES.allowOnce] });
  const event = { toolName: "bash", input: { command: "curl https://api.example.com/v1?q=1" } };

  await handleNetworkGuardToolCall(event, ctx, state, fake.dependencies);
  const result = await handleNetworkGuardToolCall(event, ctx, state, fake.dependencies);

  assert.equal(result, undefined);
  assert.equal(ctx.ui.selectCalls.length, 1);
  assert.deepEqual(ctx.ui.selectCalls[0].options, Object.values(PROTECTME_SECOND_ATTEMPT_CHOICES));
  assert.match(ctx.ui.selectCalls[0].title, /api\.example\.com/u);
  assert.match(ctx.ui.selectCalls[0].title, /Suggested allow-list entry: example\.com/u);
  assert.equal(ctx.ui.editorCalls.length, 0);
  assert.equal(fake.loggedAttempts.length, 1);
  assert.equal(fake.projectWrites.length, 0);
  assert.equal(fake.globalWrites.length, 0);
});

test("second blocked attempt can add project config and allow the current call", async () => {
  const state = createNetworkGuardState();
  const fake = createFakeDependencies(buildConfigResult());
  const ctx = createFakeContext({
    hasUI: true,
    selectChoices: [PROTECTME_SECOND_ATTEMPT_CHOICES.addProject],
    editorValues: ["https://Example.com/login"],
  });
  const event = { toolName: "bash", input: { command: "curl https://api.example.com/v1" } };

  await handleNetworkGuardToolCall(event, ctx, state, fake.dependencies);
  const result = await handleNetworkGuardToolCall(event, ctx, state, fake.dependencies);

  assert.equal(result, undefined);
  assert.equal(ctx.ui.editorCalls.length, 1);
  assert.equal(ctx.ui.editorCalls[0].prefill, "example.com");
  assert.deepEqual(fake.projectWrites, [
    {
      paths: { projectConfigPath: `${cwd}/.pi/protectme.json` },
      config: { allowList: ["example.com"] },
    },
  ]);
  assert.equal(fake.globalWrites.length, 0);
  assert.equal(fake.loggedAttempts.length, 1);
});

test("second blocked attempt can add global config and allow the current call", async () => {
  const state = createNetworkGuardState();
  const fake = createFakeDependencies(buildConfigResult());
  const ctx = createFakeContext({
    hasUI: true,
    selectChoices: [PROTECTME_SECOND_ATTEMPT_CHOICES.addGlobal],
    editorValues: ["Global.example"],
  });
  const event = { toolName: "bash", input: { command: "wget https://downloads.example.com/file" } };

  await handleNetworkGuardToolCall(event, ctx, state, fake.dependencies);
  const result = await handleNetworkGuardToolCall(event, ctx, state, fake.dependencies);

  assert.equal(result, undefined);
  assert.equal(ctx.ui.editorCalls.length, 1);
  assert.equal(ctx.ui.editorCalls[0].prefill, "example.com");
  assert.deepEqual(fake.globalWrites, [
    {
      paths: { globalConfigPath: `${homeDir}/.pi/agent/protectme.json` },
      config: { allowList: ["global.example"] },
    },
  ]);
  assert.equal(fake.projectWrites.length, 0);
  assert.equal(fake.loggedAttempts.length, 1);
});

test("keep blocked returns a block result and logs the denied prompt outcome", async () => {
  const state = createNetworkGuardState();
  const fake = createFakeDependencies(buildConfigResult());
  const ctx = createFakeContext({ hasUI: true, selectChoices: [PROTECTME_SECOND_ATTEMPT_CHOICES.keepBlocked] });
  const event = { toolName: "bash", input: { command: "curl https://example.com" } };

  await handleNetworkGuardToolCall(event, ctx, state, fake.dependencies);
  const result = await handleNetworkGuardToolCall(event, ctx, state, fake.dependencies);

  assert.deepEqual(result, {
    block: true,
    reason: "ProtectMe kept blocking network request to example.com. The user did not approve this call.",
  });
  assert.equal(fake.loggedAttempts.length, 2);
  assert.equal(fake.loggedAttempts[1].attempt, 2);
  assert.equal(fake.loggedAttempts[1].outcome, "prompt_denied");
  assert.equal(ctx.ui.editorCalls.length, 0);
});

test("no-UI second attempt fails closed and explains confirmation is unavailable", async () => {
  const state = createNetworkGuardState();
  const fake = createFakeDependencies(buildConfigResult());
  const ctx = createFakeContext({ hasUI: false });
  const event = { toolName: "bash", input: { command: "curl https://example.com" } };

  await handleNetworkGuardToolCall(event, ctx, state, fake.dependencies);
  const result = await handleNetworkGuardToolCall(event, ctx, state, fake.dependencies);

  assert.deepEqual(result, {
    block: true,
    reason:
      "ProtectMe blocked repeated network request to example.com. Confirmation is unavailable because this session has no UI, so the request failed closed.",
  });
  assert.equal(ctx.ui.selectCalls.length, 0);
  assert.equal(fake.loggedAttempts.length, 2);
  assert.equal(fake.loggedAttempts[1].outcome, "prompt_unavailable");
});

test("registration wires session reset and tool_call handling", async () => {
  const fakePi = createFakePi();
  const fake = createFakeDependencies(buildConfigResult());
  const state = registerNetworkGuardEvents(fakePi, fake.dependencies);
  const event = { toolName: "bash", input: { command: "curl https://example.com" } };

  await fakePi.handlers.tool_call(event, createFakeContext());
  await fakePi.handlers.tool_call(event, createFakeContext());
  await fakePi.handlers.session_start({}, createFakeContext());
  await fakePi.handlers.tool_call(event, createFakeContext());

  assert.equal(state.blockedHostAttempts.get("example.com"), 1);
  assert.deepEqual(
    fake.loggedAttempts.map((attempt) => attempt.attempt),
    [1, 2, 1],
  );
});

function createFakeDependencies(configResult) {
  const loggedAttempts = [];
  const guidanceMessages = [];
  const projectWrites = [];
  const globalWrites = [];
  const loadInputs = [];
  let loadCalls = 0;
  let currentProjectConfig = configResult.projectConfig.config ?? {};
  let currentGlobalConfig = configResult.globalConfig.config ?? {};
  const dependencies = {
    getHomeDir() {
      return homeDir;
    },
    async loadConfig(input) {
      loadCalls += 1;
      loadInputs.push(input);
      assert.deepEqual(input, buildExpectedConfigLoadInput(input));
      return configResult;
    },
    async appendBlockedAttemptLog(input) {
      loggedAttempts.push(input);
      return buildBlockedAttemptLogEntry(input);
    },
    async mutateProjectConfig(paths, mutation) {
      currentProjectConfig = await mutation(currentProjectConfig);
      projectWrites.push({ paths: { projectConfigPath: paths.projectConfigPath }, config: currentProjectConfig });
      return currentProjectConfig;
    },
    async mutateGlobalConfig(paths, mutation) {
      currentGlobalConfig = await mutation(currentGlobalConfig);
      globalWrites.push({ paths: { globalConfigPath: paths.globalConfigPath }, config: currentGlobalConfig });
      return currentGlobalConfig;
    },
    sendGuidance(message, options) {
      guidanceMessages.push({ message, options });
    },
  };

  return {
    dependencies,
    loggedAttempts,
    guidanceMessages,
    projectWrites,
    globalWrites,
    loadInputs,
    get loadCalls() {
      return loadCalls;
    },
  };
}

function buildExpectedConfigLoadInput(input) {
  if (input.projectTrusted === false) return { cwd, homeDir, projectTrusted: false };

  return { cwd, homeDir };
}

function createFakeContext(options = {}) {
  const ctx = {
    cwd,
    hasUI: options.hasUI ?? false,
    ui: createFakeUi(options),
    abortCalled: false,
    abort() {
      this.abortCalled = true;
    },
  };

  if ("projectTrusted" in options) ctx.isProjectTrusted = () => options.projectTrusted;

  return ctx;
}

function createFakeUi(options) {
  const selectChoices = [...(options.selectChoices ?? [])];
  const editorValues = [...(options.editorValues ?? [])];
  const selectCalls = [];
  const editorCalls = [];
  const statusCalls = [];
  const notifications = [];

  return {
    selectCalls,
    editorCalls,
    statusCalls,
    notifications,
    async select(title, choices) {
      selectCalls.push({ title, options: choices });
      return selectChoices.shift();
    },
    async editor(title, prefill) {
      editorCalls.push({ title, prefill });
      return editorValues.shift();
    },
    setStatus(key, text) {
      statusCalls.push({ key, text });
    },
    notify(message, type) {
      notifications.push({ message, type });
    },
  };
}

function createFakePi() {
  const handlers = {};

  return {
    handlers,
    on(name, handler) {
      handlers[name] = handler;
    },
    sendUserMessage() {},
  };
}

function buildInvalidConfigResult() {
  const base = buildConfigResult({ warnings: ["global config invalid: Invalid JSON: Unexpected end of JSON input"] });
  const globalConfig = {
    ...base.globalConfig,
    status: "invalid",
    message: "Invalid JSON: Unexpected end of JSON input",
  };

  return {
    ...base,
    globalConfig,
    effective: {
      ...base.effective,
      mode: "block",
      modeSource: "default",
      allowList: [],
      allowListSources: [],
      configSources: [globalConfig, base.projectConfig],
    },
  };
}

function buildProjectAllowOverGlobalBlockConfigResult() {
  const base = buildConfigResult({ mode: "allow" });
  const globalConfig = {
    ...base.globalConfig,
    status: "valid",
    config: { mode: "block", allowList: ["blocked.example"] },
  };
  const projectConfig = {
    ...base.projectConfig,
    status: "valid",
    config: { mode: "allow" },
  };

  return {
    ...base,
    globalConfig,
    projectConfig,
    effective: {
      ...base.effective,
      mode: "allow",
      modeSource: "project",
      allowList: ["blocked.example"],
      allowListSources: ["global"],
      configSources: [globalConfig, projectConfig],
    },
  };
}

function buildMixedInvalidProjectFailClosedConfigResult() {
  const base = buildConfigResult();
  const globalConfig = {
    ...base.globalConfig,
    status: "valid",
    config: { mode: "allow", allowList: ["permissive.example.com"] },
  };
  const projectConfig = {
    ...base.projectConfig,
    status: "invalid",
    message: "Invalid JSON: Unexpected end of JSON input",
    config: null,
  };
  const warnings = buildFailClosedConfigWarnings("project", "invalid");

  return buildFailClosedConfigResult(base, globalConfig, projectConfig, warnings);
}

function buildMixedInvalidGlobalFailClosedConfigResult() {
  const base = buildConfigResult();
  const globalConfig = {
    ...base.globalConfig,
    status: "invalid",
    message: "Invalid JSON: Unexpected end of JSON input",
    config: null,
  };
  const projectConfig = {
    ...base.projectConfig,
    status: "valid",
    config: { mode: "allow", allowList: ["permissive.example.com"] },
  };
  const warnings = buildFailClosedConfigWarnings("global", "invalid");

  return buildFailClosedConfigResult(base, globalConfig, projectConfig, warnings);
}

function buildFailClosedConfigResult(base, globalConfig, projectConfig, warnings) {
  return {
    ...base,
    globalConfig,
    projectConfig,
    effective: {
      ...base.effective,
      mode: "block",
      modeSource: "default",
      allowList: [],
      allowListSources: [],
      configSources: [globalConfig, projectConfig],
      warnings,
    },
  };
}

function buildFailClosedConfigWarnings(source, status) {
  return [
    `${source} config ${status}: Invalid JSON: Unexpected end of JSON input`,
    `Effective config failed closed because ${source} config ${status}; mode "block" and empty allowList are in use.`,
  ];
}

function buildUntrustedProjectIgnoredConfigResult() {
  const base = buildConfigResult({ warnings: ["project config ignored: Project config was not read because the current project is not trusted."] });
  const globalConfig = {
    ...base.globalConfig,
    status: "valid",
    config: { mode: "block" },
  };
  const projectConfig = {
    ...base.projectConfig,
    status: "ignored",
    message: "Project config was not read because the current project is not trusted.",
    config: null,
  };

  return {
    ...base,
    globalConfig,
    projectConfig,
    effective: {
      ...base.effective,
      mode: "block",
      modeSource: "global",
      allowList: [],
      allowListSources: [],
      configSources: [globalConfig, projectConfig],
    },
  };
}

function buildConfigResult(options = {}) {
  const mode = options.mode ?? "block";
  const allowList = options.allowList ?? [];
  const paths = {
    cwd,
    homeDir,
    globalConfigPath: `${homeDir}/.pi/agent/protectme.json`,
    projectConfigPath: `${cwd}/.pi/protectme.json`,
    blockedAttemptLogPath: `${cwd}/.pi/agent/protectme_log.jsonl`,
  };
  const globalConfig = {
    source: "global",
    path: paths.globalConfigPath,
    status: "missing",
    config: null,
  };
  const projectConfig = {
    source: "project",
    path: paths.projectConfigPath,
    status: "missing",
    config: null,
  };

  return {
    paths,
    globalConfig,
    projectConfig,
    effective: {
      mode,
      allowList,
      modeSource: mode === "block" ? "default" : "project",
      allowListSources: allowList.length > 0 ? ["project"] : [],
      configSources: [globalConfig, projectConfig],
      warnings: options.warnings ?? [],
    },
  };
}
