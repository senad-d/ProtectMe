import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setImmediate } from "node:timers/promises";

import { DEFAULT_PROTECTME_ALLOW_LIST } from "../src/config/index.ts";
import {
  buildProtectMeConfigWarningMessage,
  createDefaultNetworkGuardDependencies,
  createNetworkGuardState,
  handleNetworkGuardSessionShutdown,
  handleNetworkGuardSessionStart,
  handleNetworkGuardToolCall,
  handleNetworkGuardUserBash,
  PROTECTME_GUIDANCE_CUSTOM_MESSAGE_TYPE,
  PROTECTME_SESSION_CONFIG_ENV,
  PROTECTME_SESSION_READS_ALL_CHOICE,
  registerNetworkGuardEvents,
  resetNetworkGuardSessionState,
} from "../src/events/network-guard.ts";
import { buildBlockedAttemptLogEntry } from "../src/logging/blocked-attempt-log.ts";

const cwd = "/workspace/project";
const homeDir = "/home/user";
const agentDir = `${homeDir}/.pi/agent`;
const starterStatusText = "🌐";
const untrustedChoices = ["Deny once", "Deny for session", "Deny globally", "Allow once", "Allow for session", "Allow globally"];
const allChoices = [
  "Deny once",
  "Deny for session",
  "Deny for project",
  "Deny globally",
  "Allow once",
  "Allow for session",
  "Allow for project",
  "Allow globally",
];
const promptErrorNotification = [
  "ProtectMe blocked this repeated network request because the confirmation prompt failed.",
  "No config was changed; update the allow list manually before retrying.",
].join(" ");

test("session start resets attempts, loads config, sets status, and shows warnings", async () => {
  const state = createNetworkGuardState();
  const config = buildConfigResult({ allowList: ["example.com", "api.example.com"], warnings: ["project allowList entry ignored (\"bad host\"): invalid host"] });
  const fake = createFakeDependencies(config);
  const ctx = createFakeContext({ hasUI: true });
  state.blockedHostAttempts.set("example.com", 3);

  await handleNetworkGuardSessionStart(ctx, state, fake.dependencies);

  assert.equal(state.blockedHostAttempts.size, 0);
  assert.equal(fake.loadCalls, 1);
  assert.deepEqual(ctx.ui.statusCalls, [{ key: "protectme", text: "🌐" }]);
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

  assert.equal(ctx.ui.statusCalls[0].text, "🌐");
  assert.equal(ctx.ui.notifications.length, 1);
  assert.match(ctx.ui.notifications[0].message, /global config invalid/u);
  assert.deepEqual(result, {
    block: true,
    reason:
      'ProtectMe blocked network request to example.com. mode: "block" allows only configured hosts. If this host is required, repeat the same request once: ProtectMe will then ask the user to allow it or keep it blocked. Otherwise continue with local or already allowed work.',
  });
  assert.equal(fake.loggedAttempts.length, 1);
  assert.equal(fake.loggedAttempts[0].outcome, "blocked");
});

test("first disallowed bash request blocks, logs once, and queues safe guidance", async () => {
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
      'ProtectMe blocked network request to example.com. mode: "block" allows only configured hosts. This session has no UI to ask the user, so repeating the request will not help. Continue with local or already allowed work, or ask the user to add the host to the allow list.',
  });
  assert.equal(ctx.abortCalled, false);
  assert.equal(fake.loggedAttempts.length, 1);
  assert.equal(fake.loggedAttempts[0].host, "example.com");
  assert.equal(fake.loggedAttempts[0].attempt, 1);
  assert.equal(fake.loggedAttempts[0].outcome, "blocked");
  assert.equal(fake.loggedAttempts[0].command, "curl https://example.com");
  assert.equal(fake.guidanceMessages.length, 1);
  assert.match(fake.guidanceMessages[0].message, /cannot ask the user, so do not retry/u);
  assert.match(fake.guidanceMessages[0].message, /Continue with local or already allowed work/u);
  assert.deepEqual(fake.guidanceMessages[0].options, { deliverAs: "steer" });
});

test("first disallowed user bash command blocks with a bash result and no guidance message", async () => {
  const state = createNetworkGuardState();
  const fake = createFakeDependencies(buildConfigResult());
  const ctx = createFakeContext();

  const result = await handleNetworkGuardUserBash({ command: "curl https://example.com", cwd }, ctx, state, fake.dependencies);

  assert.deepEqual(result, {
    result: {
      output:
        'ProtectMe blocked network request to example.com. mode: "block" allows only configured hosts. This session has no UI to ask the user, so repeating the request will not help. Continue with local or already allowed work, or ask the user to add the host to the allow list.\n',
      exitCode: 1,
      cancelled: false,
      truncated: false,
    },
  });
  assert.equal(fake.loggedAttempts.length, 1);
  assert.equal(fake.loggedAttempts[0].toolName, "user_bash");
  assert.equal(fake.loggedAttempts[0].command, "curl https://example.com");
  assert.equal(fake.loggedAttempts[0].host, "example.com");
  assert.equal(fake.loggedAttempts[0].attempt, 1);
  assert.equal(fake.loggedAttempts[0].outcome, "blocked");
  assert.equal(fake.guidanceMessages.length, 0);
});

test("first-attempt guidance with a prompt UI says a repeat asks the user, and the repeat opens the dialog", async () => {
  const state = createNetworkGuardState();
  const fake = createFakeDependencies(buildConfigResult());
  const ctx = createFakeContext({ hasUI: true, selectChoices: ["Deny once"] });
  const event = { toolName: "bash", input: { command: "curl https://sh.rustup.rs" } };

  const firstResult = await handleNetworkGuardToolCall(event, ctx, state, fake.dependencies);

  assert.match(firstResult.reason, /repeat the same request once: ProtectMe will then ask the user/u);
  assert.doesNotMatch(firstResult.reason, /Do not retry/u);
  assert.equal(fake.guidanceMessages.length, 1);
  assert.match(fake.guidanceMessages[0].message, /repeat the same request once so ProtectMe can ask the user/u);
  assert.equal(ctx.ui.selectCalls.length, 0);

  const secondResult = await handleNetworkGuardToolCall(event, ctx, state, fake.dependencies);

  assert.equal(secondResult.block, true);
  assert.equal(ctx.ui.selectCalls.length, 1);
  assert.match(ctx.ui.selectCalls[0].title, /Hosts: sh\.rustup\.rs/u);
});

test("repeated user bash command can be allowed once through the shared prompt", async () => {
  const state = createNetworkGuardState();
  const fake = createFakeDependencies(buildConfigResult());
  const ctx = createFakeContext({ hasUI: true, selectChoices: ["Allow once"] });
  const event = { command: "curl https://api.example.com/v1", cwd };

  await handleNetworkGuardUserBash(event, ctx, state, fake.dependencies);
  const result = await handleNetworkGuardUserBash(event, ctx, state, fake.dependencies);

  assert.equal(result, undefined);
  assert.equal(ctx.ui.selectCalls.length, 1);
  assert.deepEqual(ctx.ui.selectCalls[0].options, allChoices);
  assert.match(ctx.ui.selectCalls[0].title, /api\.example\.com/u);
  assert.deepEqual(fake.loggedAttempts.map((attempt) => attempt.outcome), ["blocked", "prompt_allowed_once"]);
  assert.equal(fake.projectWrites.length, 0);
  assert.equal(fake.globalWrites.length, 0);
});

test("no-UI repeated user bash command fails closed with a bash result", async () => {
  const state = createNetworkGuardState();
  const fake = createFakeDependencies(buildConfigResult());
  const ctx = createFakeContext({ hasUI: false });
  const event = { command: "curl https://example.com", cwd };

  await handleNetworkGuardUserBash(event, ctx, state, fake.dependencies);
  const result = await handleNetworkGuardUserBash(event, ctx, state, fake.dependencies);

  assert.deepEqual(result, {
    result: {
      output:
        "ProtectMe blocked repeated network request to example.com. Confirmation is unavailable because this session has no UI, so the request failed closed.\n",
      exitCode: 1,
      cancelled: false,
      truncated: false,
    },
  });
  assert.equal(ctx.ui.selectCalls.length, 0);
  assert.equal(fake.loggedAttempts.length, 2);
  assert.equal(fake.loggedAttempts[1].toolName, "user_bash");
  assert.equal(fake.loggedAttempts[1].attempt, 2);
  assert.equal(fake.loggedAttempts[1].outcome, "prompt_unavailable");
});

test("default first-attempt guidance uses a custom message instead of a follow-up user message", async () => {
  const state = createNetworkGuardState();
  const fakePi = createFakePi();
  const defaultDependencies = createDefaultNetworkGuardDependencies(fakePi);
  const fake = createFakeDependencies(buildConfigResult());
  const dependencies = { ...fake.dependencies, sendGuidance: defaultDependencies.sendGuidance };

  const result = await handleNetworkGuardToolCall(
    { toolName: "bash", input: { command: "curl https://example.com" } },
    createFakeContext(),
    state,
    dependencies,
  );

  assert.equal(result?.block, true);
  assert.equal(fakePi.userMessages.length, 0);
  assert.equal(fakePi.messages.length, 1);
  assert.match(fakePi.messages[0].message.content, /cannot ask the user, so do not retry/u);
  assert.equal(fakePi.messages[0].message.customType, PROTECTME_GUIDANCE_CUSTOM_MESSAGE_TYPE);
  assert.equal(fakePi.messages[0].message.display, false);
  assert.deepEqual(fakePi.messages[0].message.details, { source: "network_guard" });
  assert.deepEqual(fakePi.messages[0].options, { deliverAs: "steer" });
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
      'ProtectMe blocked network request to wrapped.example.com. mode: "block" allows only configured hosts. This session has no UI to ask the user, so repeating the request will not help. Continue with local or already allowed work, or ask the user to add the host to the allow list.',
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
      'ProtectMe blocked network request to proxy.example.com. mode: "block" allows only configured hosts. This session has no UI to ask the user, so repeating the request will not help. Continue with local or already allowed work, or ask the user to add the host to the allow list.',
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
  const ctx = createFakeContext({ hasUI: true, selectChoices: ["Deny once"] });
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
  assert.equal(state.blockedHostAttempts.size, 0);
});

test("project allow mode disables blocking even when global mode is block", async () => {
  const state = createNetworkGuardState();
  const fake = createFakeDependencies(buildProjectAllowOverGlobalBlockConfigResult());
  const ctx = createFakeContext({ hasUI: true, selectChoices: ["Deny once"] });

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

    assert.equal(ctx.ui.statusCalls[0].text, "🌐");
    assert.match(ctx.ui.notifications[0].message, /Effective config failed closed/u);
    assert.deepEqual(result, {
      block: true,
      reason:
        'ProtectMe blocked network request to permissive.example.com. mode: "block" allows only configured hosts. If this host is required, repeat the same request once: ProtectMe will then ask the user to allow it or keep it blocked. Otherwise continue with local or already allowed work.',
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
    { cwd, homeDir, agentDir, projectTrusted: false },
    { cwd, homeDir, agentDir, projectTrusted: false },
  ]);
  assert.equal(ctx.ui.statusCalls[0].text, `${starterStatusText} · project config ignored`);
  assert.match(ctx.ui.notifications[0].message, /project config ignored/u);
  assert.deepEqual(result, {
    block: true,
    reason:
      'ProtectMe blocked network request to project-only.example.com. mode: "block" allows only configured hosts. If this host is required, repeat the same request once: ProtectMe will then ask the user to allow it or keep it blocked. Otherwise continue with local or already allowed work.',
  });
  assert.equal(fake.loggedAttempts.length, 1);
});

test("untrusted project prompt leaves out the project scope and saves to the global config", async () => {
  const state = createNetworkGuardState();
  const fake = createFakeDependencies(buildUntrustedProjectIgnoredConfigResult());
  const ctx = createFakeContext({ hasUI: true, projectTrusted: false, selectChoices: ["Allow globally"] });
  const event = { toolName: "bash", input: { command: "curl https://project-only.example.com" } };

  await handleNetworkGuardToolCall(event, ctx, state, fake.dependencies);
  const result = await handleNetworkGuardToolCall(event, ctx, state, fake.dependencies);

  assert.equal(result, undefined);
  assert.deepEqual(ctx.ui.selectCalls[0].options, untrustedChoices);
  assert.deepEqual(fake.emitted[0].guard.rule.scopes, ["once", "session", "global"]);
  assert.equal(fake.projectWrites.length, 0);
  assert.deepEqual(fake.globalWrites, [
    {
      paths: { globalConfigPath: `${agentDir}/protectme.json` },
      config: { mode: "block", allowList: ["example.com"] },
    },
  ]);
  assert.deepEqual(fake.loggedAttempts.map((attempt) => attempt.outcome), ["blocked", "prompt_allowed_global"]);
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

test("second blocked attempt opens one prompt with eight choices, and allow once proceeds without config writes", async () => {
  const state = createNetworkGuardState();
  const fake = createFakeDependencies(buildConfigResult());
  const ctx = createFakeContext({ hasUI: true, selectChoices: ["Allow once"] });
  const event = { toolName: "bash", input: { command: "curl https://api.example.com/v1?q=1" } };

  await handleNetworkGuardToolCall(event, ctx, state, fake.dependencies);
  const result = await handleNetworkGuardToolCall(event, ctx, state, fake.dependencies);

  assert.equal(result, undefined);
  assert.equal(ctx.ui.selectCalls.length, 1);
  assert.deepEqual(ctx.ui.selectCalls[0].options, allChoices);
  assert.equal(
    ctx.ui.selectCalls[0].title,
    "ProtectMe blocked a read-only network request.\nHosts: api.example.com\nSaves: example.com (and its subdomains)",
  );
  assert.equal(fake.projectWrites.length, 0);
  assert.equal(fake.globalWrites.length, 0);
  assert.deepEqual(state.session, {});
});

test("the prompt emits herdr:blocked with the card content when it opens and a close when it ends", async () => {
  const state = createNetworkGuardState();
  const fake = createFakeDependencies(buildConfigResult());
  const ctx = createFakeContext({ hasUI: true, selectErrors: [new Error("closed")] });
  const event = { toolName: "bash", input: { command: "curl -H 'Authorization: Bearer secret-token' -d a=1 https://api.example.com/v1" } };

  await handleNetworkGuardToolCall(event, ctx, state, fake.dependencies);
  assert.equal(fake.emitted.length, 0);
  await handleNetworkGuardToolCall(event, ctx, state, fake.dependencies);

  const [opened, closed] = fake.emitted;
  assert.deepEqual(opened, {
    active: true,
    id: opened.id,
    label: "ProtectMe approval: api.example.com",
    guard: {
      name: "protectme",
      kind: "network",
      title: "Network request blocked",
      tool: "bash",
      command: "curl -H 'Authorization: [REDACTED]' -d a=1 https://api.example.com/v1",
      subject: "api.example.com",
      reason: "This network request that sends data goes to hosts that are not on the allow list: api.example.com.",
      rule: {
        pattern: "example.com",
        covers: "example.com and its subdomains",
        exact: false,
        scopes: ["once", "session", "project", "global"],
      },
      options: allChoices,
    },
  });
  assert.equal(typeof opened.id, "number");
  assert.deepEqual(closed, { active: false, id: opened.id });
  assert.equal(fake.emitted.length, 2);
});

test("one prompt lists every unlisted host of the command and the choice applies to all of them", async () => {
  const state = createNetworkGuardState();
  const fake = createFakeDependencies(buildConfigResult({ allowList: ["listed.example"] }));
  const ctx = createFakeContext({ hasUI: true, selectChoices: ["Allow for project"] });
  const command = "curl https://listed.example/a && curl https://api.example.com/v1 && curl -d a=1 https://10.0.0.5/x && curl https://www.example.com";
  const event = { toolName: "bash", input: { command } };

  await handleNetworkGuardToolCall(event, ctx, state, fake.dependencies);
  const result = await handleNetworkGuardToolCall(event, ctx, state, fake.dependencies);

  assert.equal(result, undefined);
  assert.equal(ctx.ui.selectCalls.length, 1);
  assert.equal(
    ctx.ui.selectCalls[0].title,
    [
      "ProtectMe blocked a network request that sends data.",
      "Hosts: api.example.com, 10.0.0.5, www.example.com",
      "Saves: example.com (and its subdomains), 10.0.0.5",
    ].join("\n"),
  );
  assert.equal(fake.emitted[0].guard.rule.covers, "example.com and its subdomains, 10.0.0.5 only");
  assert.deepEqual(fake.projectWrites.at(-1).config, { allowList: ["example.com", "10.0.0.5"] });
  assert.deepEqual(
    fake.loggedAttempts.slice(1).map((attempt) => [attempt.host, attempt.outcome]),
    [
      ["api.example.com", "prompt_allowed_project"],
      ["10.0.0.5", "prompt_allowed_project"],
      ["www.example.com", "prompt_allowed_project"],
    ],
  );
});

test("multi-host decisions wait for audit writes in candidate order", async () => {
  const state = createNetworkGuardState();
  const fake = createFakeDependencies(buildConfigResult());
  const ctx = createFakeContext({ hasUI: true, selectChoices: ["Allow once"] });
  const event = { toolName: "bash", input: { command: "curl https://first.example.com https://second.example.com" } };
  fake.dependencies.getSessionReads = () => "ask";
  const append = fake.dependencies.appendBlockedAttemptLog;
  fake.dependencies.appendBlockedAttemptLog = async (input) => {
    if (input.host === "first.example.com") await setImmediate();
    return append(input);
  };

  const result = await handleNetworkGuardToolCall(event, ctx, state, fake.dependencies);

  assert.equal(result, undefined);
  assert.deepEqual(fake.loggedAttempts.map((attempt) => attempt.host), ["first.example.com", "second.example.com"]);
});

test("deny for project saves the registrable domain to the project deny list and blocks the call", async () => {
  const state = createNetworkGuardState();
  const fake = createFakeDependencies(buildConfigResult());
  const ctx = createFakeContext({ hasUI: true, selectChoices: ["Deny for project"] });
  const event = { toolName: "bash", input: { command: "curl https://api.example.com/v1" } };

  await handleNetworkGuardToolCall(event, ctx, state, fake.dependencies);
  const result = await handleNetworkGuardToolCall(event, ctx, state, fake.dependencies);

  assert.deepEqual(result, {
    block: true,
    reason: "ProtectMe kept blocking network request to api.example.com. The user did not approve this call.",
  });
  assert.deepEqual(fake.projectWrites, [
    {
      paths: { projectConfigPath: `${cwd}/.pi/protectme.json` },
      config: { denyList: ["example.com"] },
    },
  ]);
  assert.equal(fake.globalWrites.length, 0);
  assert.equal(fake.loggedAttempts.at(-1).outcome, "prompt_denied_project");
});

test("allow for project keeps the existing project config while appending the entry", async () => {
  const state = createNetworkGuardState();
  const fake = createFakeDependencies(buildProjectBlockConfigResult());
  const ctx = createFakeContext({ hasUI: true, selectChoices: ["Allow for project"] });
  const event = { toolName: "bash", input: { command: "curl https://api.example.com/v1" } };

  await handleNetworkGuardToolCall(event, ctx, state, fake.dependencies);
  const result = await handleNetworkGuardToolCall(event, ctx, state, fake.dependencies);

  assert.equal(result, undefined);
  assert.deepEqual(fake.projectWrites, [
    {
      paths: { projectConfigPath: `${cwd}/.pi/protectme.json` },
      config: { mode: "block", allowList: ["existing.example.com", "example.com"] },
    },
  ]);
  assert.equal(fake.globalWrites.length, 0);
});

test("a failed config save blocks the call and logs a prompt error", async () => {
  const state = createNetworkGuardState();
  const fake = createFakeDependencies(buildConfigResult());
  fake.dependencies.mutateGlobalConfig = async () => {
    throw new Error("disk full");
  };
  const ctx = createFakeContext({ hasUI: true, selectChoices: ["Allow globally"] });
  const event = { toolName: "bash", input: { command: "wget https://downloads.example.com/file" } };

  await handleNetworkGuardToolCall(event, ctx, state, fake.dependencies);
  const result = await handleNetworkGuardToolCall(event, ctx, state, fake.dependencies);

  assert.deepEqual(result, {
    block: true,
    reason:
      "ProtectMe blocked network request to downloads.example.com. The requested config update failed, so confirmation was not saved: disk full",
  });
  assert.equal(fake.loggedAttempts.at(-1).outcome, "prompt_error");
  assert.deepEqual(ctx.ui.notifications, [{ message: "ProtectMe could not save this choice: disk full", type: "error" }]);
});

test("deny once and a cancelled prompt block the call, save nothing, and log the denied prompt outcome", async () => {
  for (const selectChoices of [["Deny once"], []]) {
    const state = createNetworkGuardState();
    const fake = createFakeDependencies(buildConfigResult());
    const ctx = createFakeContext({ hasUI: true, selectChoices });
    const event = { toolName: "bash", input: { command: "curl https://example.com" } };

    await handleNetworkGuardToolCall(event, ctx, state, fake.dependencies);
    const result = await handleNetworkGuardToolCall(event, ctx, state, fake.dependencies);

    assert.deepEqual(result, {
      block: true,
      reason: "ProtectMe kept blocking network request to example.com. The user did not approve this call.",
    });
    assert.equal(fake.loggedAttempts.length, 2);
    assert.equal(fake.loggedAttempts[1].attempt, 2);
    assert.equal(fake.loggedAttempts[1].outcome, "prompt_denied_once");
    assert.equal(fake.projectWrites.length + fake.globalWrites.length, 0);
    assert.deepEqual(state.session, {});
  }
});

test("deny list wins over the allow list: the host is refused with no prompt and no repeat hint", async () => {
  const state = createNetworkGuardState();
  const fake = createFakeDependencies(buildConfigResult({ allowList: ["api.example.com"], denyList: ["example.com"] }));
  const ctx = createFakeContext({ hasUI: true });
  const event = { toolName: "bash", input: { command: "curl https://github.com/x && curl https://api.example.com/v1" } };

  const first = await handleNetworkGuardToolCall(event, ctx, state, fake.dependencies);
  const second = await handleNetworkGuardToolCall(event, ctx, state, fake.dependencies);

  assert.deepEqual(first, {
    block: true,
    reason:
      "ProtectMe denied network request to api.example.com: the host is on the deny list. Do not retry it; continue with local or already allowed work.",
  });
  assert.deepEqual(second, first);
  assert.doesNotMatch(first.reason, /repeat the same request|ProtectMe blocked network request to/u);
  assert.equal(ctx.ui.selectCalls.length, 0);
  assert.equal(fake.guidanceMessages.length, 0);
  assert.deepEqual(fake.loggedAttempts.map((attempt) => attempt.outcome), ["denied", "denied"]);
});

test("session choices apply to every later request of the session, in memory, and deny wins", async () => {
  const state = createNetworkGuardState();
  const fake = createFakeDependencies(buildConfigResult());
  const ctx = createFakeContext({ hasUI: true, selectChoices: ["Allow for session", "Deny for session"] });
  const call = (command) => handleNetworkGuardToolCall({ toolName: "bash", input: { command } }, ctx, state, fake.dependencies);

  await call("curl https://api.example.com/v1");
  assert.equal(await call("curl https://api.example.com/v1"), undefined);
  assert.equal(await call("curl -d a=1 https://www.example.com/upload"), undefined);
  assert.equal(await handleNetworkGuardUserBash({ command: "curl https://example.com" }, ctx, state, fake.dependencies), undefined);
  assert.equal(ctx.ui.selectCalls.length, 1);

  await call("curl https://tracker.test/x");
  assert.equal((await call("curl https://tracker.test/x")).block, true);
  const denied = await call("curl https://tracker.test/x");
  assert.match(denied.reason, /^ProtectMe denied network request to tracker\.test: the host is on the deny list\./u);
  assert.equal(ctx.ui.selectCalls.length, 2);
  assert.deepEqual(state.session, { allowList: ["example.com"], denyList: ["tracker.test"] });
  assert.equal(fake.projectWrites.length + fake.globalWrites.length, 0);
  assert.deepEqual(
    fake.loggedAttempts.map((attempt) => attempt.outcome),
    ["blocked", "prompt_allowed_session", "blocked", "prompt_denied_session", "denied"],
  );

  // A new session starts with nothing allowed or denied.
  resetNetworkGuardSessionState(state);
  assert.match((await call("curl https://api.example.com/v1")).reason, /^ProtectMe blocked network request to api\.example\.com\. mode: "block"/u);
});

test("session file: PROTECTME_SESSION_CONFIG holds the session lists, is created on first save and re-read per call", async () => {
  const directory = await mkdtemp(join(tmpdir(), "protectme-session-"));
  const sessionPath = join(directory, "nested", "guard-session.json");
  process.env[PROTECTME_SESSION_CONFIG_ENV] = sessionPath;

  try {
    const state = createNetworkGuardState();
    const fake = createFakeDependencies(buildConfigResult());
    const ctx = createFakeContext({ hasUI: true, selectChoices: ["Allow for session"] });
    const call = (guardState, command) =>
      handleNetworkGuardToolCall({ toolName: "bash", input: { command } }, ctx, guardState, fake.dependencies);

    await call(state, "curl https://api.example.com/v1");
    assert.equal(await call(state, "curl https://api.example.com/v1"), undefined);
    assert.deepEqual(JSON.parse(await readFile(sessionPath, "utf8")), { allowList: ["example.com"] });
    assert.deepEqual(state.session, {});

    // Another agent of the same objective: its own state, the same file.
    const otherState = createNetworkGuardState();
    assert.equal(await call(otherState, "curl -d a=1 https://www.example.com/upload"), undefined);

    // A deny saved by someone else since the last call applies at once and wins.
    await writeFile(sessionPath, JSON.stringify({ allowList: ["example.com"], denyList: ["api.example.com"] }));
    assert.match((await call(otherState, "curl https://api.example.com/v1")).reason, /^ProtectMe denied network request to api\.example\.com/u);
    assert.equal(ctx.ui.selectCalls.length, 1);
  } finally {
    delete process.env[PROTECTME_SESSION_CONFIG_ENV];
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejected repeated-attempt choice prompt fails closed with bounded log metadata", async () => {
  const state = createNetworkGuardState();
  const fake = createFakeDependencies(buildConfigResult());
  const promptSecret = "select-secret-token";
  const ctx = createFakeContext({ hasUI: true, selectErrors: [new Error(promptSecret)] });
  const event = { toolName: "bash", input: { command: "curl https://example.com" } };

  await handleNetworkGuardToolCall(event, ctx, state, fake.dependencies);
  const result = await handleNetworkGuardToolCall(event, ctx, state, fake.dependencies);

  assert.deepEqual(result, {
    block: true,
    reason: buildExpectedPromptErrorReason("example.com"),
  });
  assert.equal(ctx.ui.selectCalls.length, 1);
  assert.equal(fake.projectWrites.length, 0);
  assert.equal(fake.globalWrites.length, 0);
  assert.equal(fake.loggedAttempts.length, 2);
  assert.equal(fake.loggedAttempts[1].attempt, 2);
  assert.equal(fake.loggedAttempts[1].outcome, "prompt_error");
  assert.doesNotMatch(JSON.stringify(fake.loggedAttempts[1]), /select-secret-token/u);
  assert.deepEqual(ctx.ui.notifications, [{ message: promptErrorNotification, type: "error" }]);
  assert.doesNotMatch(JSON.stringify(ctx.ui.notifications), /select-secret-token/u);
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

test("registration wires user_bash handling", async () => {
  const fakePi = createFakePi();
  const fake = createFakeDependencies(buildConfigResult());
  const state = registerNetworkGuardEvents(fakePi, fake.dependencies);

  const result = await fakePi.handlers.user_bash({ command: "curl https://user.example.com", cwd }, createFakeContext());

  assert.equal(result?.result.exitCode, 1);
  assert.match(result?.result.output, /user\.example\.com/u);
  assert.equal(state.blockedHostAttempts.get("user.example.com"), 1);
  assert.equal(fake.loggedAttempts[0].toolName, "user_bash");
});

function createFakeDependencies(configResult) {
  const loggedAttempts = [];
  const guidanceMessages = [];
  const projectWrites = [];
  const globalWrites = [];
  const loadInputs = [];
  const emitted = [];
  let loadCalls = 0;
  let currentProjectConfig = configResult.projectConfig.config ?? {};
  let currentGlobalConfig = configResult.globalConfig.config ?? {};
  const dependencies = {
    getHomeDir() {
      return homeDir;
    },
    getAgentDir() {
      return agentDir;
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
    emitBlocked(event) {
      emitted.push(event);
    },
  };

  return {
    dependencies,
    loggedAttempts,
    guidanceMessages,
    projectWrites,
    globalWrites,
    loadInputs,
    emitted,
    get loadCalls() {
      return loadCalls;
    },
  };
}

function buildExpectedConfigLoadInput(input) {
  if (input.projectTrusted === false) return { cwd, homeDir, agentDir, projectTrusted: false };

  return { cwd, homeDir, agentDir };
}

function buildExpectedPromptErrorReason(host) {
  return `ProtectMe blocked repeated network request to ${host}. The confirmation prompt failed, so the request failed closed. Update the allow list manually or retry after the UI prompt recovers.`;
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
  const selectErrors = [...(options.selectErrors ?? [])];
  const selectCalls = [];
  const statusCalls = [];
  const notifications = [];

  return {
    selectCalls,
    statusCalls,
    notifications,
    async select(title, choices) {
      selectCalls.push({ title, options: choices });
      const selectError = selectErrors.shift();
      if (selectError) throw selectError;

      return selectChoices.shift();
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
  const messages = [];
  const userMessages = [];

  return {
    handlers,
    messages,
    userMessages,
    on(name, handler) {
      handlers[name] = handler;
    },
    sendMessage(message, options) {
      messages.push({ message, options });
    },
    sendUserMessage(content, options) {
      userMessages.push({ content, options });
    },
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
      allowList: [...DEFAULT_PROTECTME_ALLOW_LIST, "blocked.example"],
      allowListSources: ["global"],
      configSources: [globalConfig, projectConfig],
    },
  };
}

function buildProjectBlockConfigResult() {
  const base = buildConfigResult({ allowList: ["existing.example.com"] });
  const projectConfig = {
    ...base.projectConfig,
    status: "valid",
    config: { mode: "block", allowList: ["existing.example.com"] },
  };

  return {
    ...base,
    projectConfig,
    effective: {
      ...base.effective,
      mode: "block",
      modeSource: "project",
      allowList: [...DEFAULT_PROTECTME_ALLOW_LIST, "existing.example.com"],
      allowListSources: ["project"],
      configSources: [base.globalConfig, projectConfig],
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
      allowList: [...DEFAULT_PROTECTME_ALLOW_LIST],
      allowListSources: [],
      configSources: [globalConfig, projectConfig],
    },
  };
}

function buildConfigResult(options = {}) {
  const mode = options.mode ?? "block";
  const allowList = [...DEFAULT_PROTECTME_ALLOW_LIST, ...(options.allowList ?? [])];
  const paths = {
    cwd,
    homeDir,
    agentDir,
    globalConfigPath: `${agentDir}/protectme.json`,
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
      denyList: options.denyList ?? [],
      modeSource: mode === "block" ? "default" : "project",
      allowListSources: (options.allowList ?? []).length > 0 ? ["project"] : [],
      configSources: [globalConfig, projectConfig],
      warnings: options.warnings ?? [],
    },
  };
}

// Session reads (PROTECTME_SESSION_READS), set by a host for a research session.
test("session reads ask: the first read-only try asks, with the all-reads choice after the eight", async () => {
  const state = createNetworkGuardState();
  const fake = createFakeDependencies(buildConfigResult());
  fake.dependencies.getSessionReads = () => "ask";
  const ctx = createFakeContext({ hasUI: true, selectChoices: ["Allow for session"] });
  const call = (command) => handleNetworkGuardToolCall({ toolName: "bash", input: { command } }, ctx, state, fake.dependencies);

  assert.equal(await call("curl -fsSL https://a.test/x -o x.html && curl -L https://b.test/y -o y.html"), undefined);
  assert.equal(ctx.ui.selectCalls.length, 1);
  assert.deepEqual(ctx.ui.selectCalls[0].options, [...allChoices, PROTECTME_SESSION_READS_ALL_CHOICE]);
  assert.deepEqual(fake.emitted[0].guard.options, [...allChoices, PROTECTME_SESSION_READS_ALL_CHOICE]);
  assert.match(ctx.ui.selectCalls[0].title, /Hosts: a\.test, b\.test/u);
  assert.equal(fake.guidanceMessages.length, 0);

  // Both hosts are allowed for the session now, for every kind of request.
  assert.equal(await call("curl https://b.test/z"), undefined);
  assert.equal(await call("curl -d @notes.txt https://b.test/z"), undefined);
  assert.equal(ctx.ui.selectCalls.length, 1);
  assert.equal(fake.projectWrites.length + fake.globalWrites.length, 0);
});

test("session reads ask: all reads can be allowed for the session, a request that sends data keeps the silent first block", async () => {
  const state = createNetworkGuardState();
  const fake = createFakeDependencies(buildConfigResult());
  fake.dependencies.getSessionReads = () => "ask";
  const ctx = createFakeContext({ hasUI: true, selectChoices: [PROTECTME_SESSION_READS_ALL_CHOICE] });
  const call = (command) => handleNetworkGuardToolCall({ toolName: "bash", input: { command } }, ctx, state, fake.dependencies);

  assert.equal(await call("curl -fsSL https://www.sqlite.org/lang.html"), undefined);
  assert.equal(ctx.ui.selectCalls.length, 1);
  assert.equal(fake.loggedAttempts[0].outcome, "prompt_allowed_session");

  assert.equal(await call("curl -s https://man7.org/linux/man-pages/"), undefined);
  assert.equal(ctx.ui.selectCalls.length, 1);

  // A request that sends data: silent first block with guidance, the repeat asks without the all-reads choice.
  assert.equal((await call("curl -d a=1 https://man7.org/x"))?.block, true);
  assert.equal(ctx.ui.selectCalls.length, 1);
  assert.equal(fake.guidanceMessages.length, 1);
  assert.equal((await call("curl -d a=1 https://man7.org/x"))?.block, true);
  assert.deepEqual(ctx.ui.selectCalls[1].options, allChoices);
});

test("session reads open: read-only requests pass unasked, uploads and the user's own bash do not", async () => {
  const state = createNetworkGuardState();
  const fake = createFakeDependencies(buildConfigResult());
  fake.dependencies.getSessionReads = () => "open";
  const ctx = createFakeContext({ hasUI: true });
  const call = (command) => handleNetworkGuardToolCall({ toolName: "bash", input: { command } }, ctx, state, fake.dependencies);

  for (const command of ["curl -fsSL https://a.test/x -o x.html", "wget -q https://b.test/y -O y.html", "curl -sS --max-time 45 https://c.test"]) {
    assert.equal(await call(command), undefined, command);
  }
  for (const command of [
    "curl -d a=1 https://a.test/x",
    "curl -sSd a=1 https://a.test/x",
    "curl --data-binary @f https://a.test/x",
    "curl -F f=@f https://a.test/x",
    "curl -T f https://a.test/x",
    "curl -X POST https://a.test/x",
    "curl --json '{}' https://a.test/x",
    "wget --post-file=f https://b.test/y",
    "wget --method=PUT https://b.test/y",
    "http POST https://d.test/x a=1",
  ]) {
    assert.equal((await call(command))?.block, true, command);
  }
  // The uploads went through the normal prompt, which never offers the all-reads choice.
  assert.equal(ctx.ui.selectCalls.some((call) => call.options.includes(PROTECTME_SESSION_READS_ALL_CHOICE)), false);
  const typed = await handleNetworkGuardUserBash({ command: "curl https://e.test" }, ctx, state, fake.dependencies);
  assert.equal(typed?.result.exitCode !== 0, true);
});

test("session reads unset or unknown: nothing changes", async () => {
  const state = createNetworkGuardState();
  const fake = createFakeDependencies(buildConfigResult());
  fake.dependencies.getSessionReads = () => "everything";
  const ctx = createFakeContext({ hasUI: true, selectChoices: ["Deny once"] });
  const event = { toolName: "bash", input: { command: "curl https://a.test/x" } };

  assert.equal((await handleNetworkGuardToolCall(event, ctx, state, fake.dependencies))?.block, true);
  assert.equal((await handleNetworkGuardToolCall(event, ctx, state, fake.dependencies))?.block, true);
  assert.deepEqual(ctx.ui.selectCalls[0].options, allChoices);
});
