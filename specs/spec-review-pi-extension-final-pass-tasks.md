# Final-pass Pi extension review tasks

## Review scope and date

- Date: 2026-07-03
- Pass focus: strict final verification of core Pi extension behavior, lifecycle correctness, public command/event surfaces, unresolved assumptions from earlier passes, edge cases, and remaining test coverage gaps.
- Target project: `/Users/senad/Documents/Code/Moj_git/pi-protectme`

## Files or areas reviewed

- Earlier generated review specs: `specs/spec-review-pi-extension-first-pass-tasks.md`, `specs/spec-review-pi-extension-second-pass-tasks.md`
- Extension composition and Pi registration: `src/extension.ts`, `src/events/network-guard.ts`, `src/ui/protectme-panel.ts`, `src/config/index.ts`, `src/policy/index.ts`, `src/logging/blocked-attempt-log.ts`
- Core behavior modules: `src/config/config-loader.ts`, `src/config/config-paths.ts`, `src/config/config-types.ts`, `src/policy/bash-url-extractor.ts`, `src/policy/host-normalization.ts`, `src/policy/host-matcher.ts`, `src/policy/prompt-suggestion.ts`, `src/logging/blocked-attempt-log.ts`
- Public UI/command behavior: `/protectme` command handling and `ProtectMePanelComponent` in `src/ui/protectme-panel.ts`
- Test coverage: `test/extension-scaffold.test.mjs`, `test/network-guard.test.mjs`, `test/protectme-panel.test.mjs`, `test/bash-url-extractor.test.mjs`, `test/config-loader.test.mjs`, `test/blocked-attempt-log.test.mjs`, `test/project-metadata.test.mjs`
- Pi documentation and examples: extension lifecycle, `tool_call`, `user_bash`, `ctx.ui.custom()`, `ctx.hasUI`, `ctx.isProjectTrusted()`, `pi.sendUserMessage()`, package dependency rules, and TUI component rendering rules.

## Previous claims or assumptions verified

- Verified: `src/extension.ts` has a default `protectMeExtension(pi: ExtensionAPI)` export and composes config, policy, logging, network events, and `/protectme` command registration.
- Verified: ProtectMe registers no custom LLM tools; the public runtime surface is `tool_call`/session lifecycle events plus the `/protectme` command.
- Verified: `src/events/network-guard.ts` handles `session_start`, `session_shutdown`, and `tool_call`, resets in-memory attempt counts at session start, and clears UI status on shutdown.
- Verified: `src/ui/protectme-panel.ts` gates custom TUI rendering on `ctx.mode === "tui"` and returns a warning outside TUI mode.
- Verified: tests cover direct first-attempt blocking, repeated-attempt choices, no-UI fail-closed behavior, allow mode bypass, panel line width, and package content dry-run behavior.
- Verified blocked: `npm run test` is not green before implementation work because `test/project-metadata.test.mjs` encodes obsolete spec assumptions; this is captured in the first-pass spec.
- Verified blocked: `.github/workflows/sonar.yml` calls missing script `npm run test:coverage`; this is captured in the first-pass spec.
- Not verified in a live runtime: real Pi project-trust state, real `ctx.ui.custom()` behavior, and manual TUI smoke behavior were not exercised.

## Commands run and results

- `npm run typecheck` — passed as part of the initial chained validation command.
- `npm run test` — failed 1 of 76 tests in `test/project-metadata.test.mjs` due stale spec/backlog assumptions.
- `npm run lint:eslint` — passed.
- `npm run format:check` — passed for 56 files before review specs were added; rerun after all review specs were written and passed for 59 files.
- `npm run check:pack` — passed before and after review specs were added; package dry-run contained 26 files and no forbidden entries.
- `npm audit --audit-level=moderate` — passed; found 0 vulnerabilities.
- `npm run test:coverage` — failed because `package.json` does not define the script.
- Repository/file discovery commands using `find` and `git status --short` — passed for review mapping.

## Findings summary by severity and category

- High: 1
  - Pi Lifecycle / Core Behavior: first-attempt guidance is sent through `pi.sendUserMessage(..., { deliverAs: "followUp" })` from a `tool_call` path, which can create an unintended user-message turn instead of just guiding the blocked tool call.
- Medium: 4
  - Pi Configuration: config path helpers hardcode `.pi`/`~/.pi/agent` instead of aligning with Pi config-directory APIs and custom config-directory behavior.
  - Core Scope / Documentation: ProtectMe does not handle Pi `user_bash` commands; the intended boundary between agent bash tool calls and user `!` commands needs an explicit decision and tests/docs.
  - Testing / Pi Integration: unit fakes cover many flows, but there is no focused integration harness for actual Pi context shapes, project trust, command UI contracts, or reload/session replacement behavior.
  - Edge Cases / Error Handling: repeated-attempt prompt failures and rejected UI promises are not converted into ProtectMe-specific block decisions/log outcomes.
- Low: 0

## Ordered unchecked tasks

- [ ] Correct first-attempt guidance delivery to avoid unintended user-message turns

#### Why

`createDefaultNetworkGuardDependencies()` uses `pi.sendUserMessage()` for first-attempt guidance, and `sendFirstAttemptGuidance()` passes `{ deliverAs: "followUp" }` from the `tool_call` path. Pi documentation states that `sendUserMessage()` injects an actual user message and `followUp` delivery waits until the agent finishes all work before starting another turn. For a guardrail, that can impersonate user input, trigger an extra turn after the block is already handled, and deliver guidance too late to prevent the next immediate tool retry.

#### How to resolve

- Revisit `NetworkGuardDependencies.sendGuidance()` and `sendFirstAttemptGuidance()` in `src/events/network-guard.ts`.
- Decide whether the block reason alone is sufficient, whether guidance should be a non-user custom message via `pi.sendMessage()`, or whether a steering delivery mode is appropriate.
- Add tests that model Pi delivery semantics enough to prove no unsolicited follow-up user turn is queued after a first block.
- Ensure the agent still receives actionable guidance not to retry blindly through the block result or a safe message mechanism.
- Validate with `npm run typecheck` and `npm run test`.

#### Acceptance criteria

- First blocked attempts do not create unintended user-authored follow-up turns.
- The blocked tool result or safe guidance channel still tells the agent not to retry blindly and to continue safely.
- Tests verify the selected delivery behavior and prevent regressions.
- Any remaining Pi delivery limitation is documented with the exact next action.

- [ ] Align ProtectMe config paths with Pi config-directory conventions

#### Why

`src/constants.ts` and `src/config/config-paths.ts` hardcode `.pi/protectme.json`, `.pi/agent/protectme_log.jsonl`, and `~/.pi/agent/protectme.json`. Pi documentation recommends using Pi's config directory constants for project-local paths and supports custom config locations such as `PI_CODING_AGENT_DIR`. Hardcoded paths can make ProtectMe inconsistent in rebranded or custom-directory Pi installations.

#### How to resolve

- Inspect the current Pi package exports for config-directory helpers such as `CONFIG_DIR_NAME` and any global agent-dir resolver.
- Update `src/config/config-paths.ts` to use Pi-provided constants where appropriate while preserving documented defaults.
- Keep package/runtime dependencies valid for distributed Pi packages.
- Add tests in `test/config-defaults.test.mjs` or `test/config-loader.test.mjs` for default paths and custom config-directory behavior if the Pi API exposes it.
- Coordinate with the first-pass project-trust task so path changes do not accidentally re-enable untrusted project config loading.

#### Acceptance criteria

- Project-local config/log paths follow Pi's configured project directory name instead of an unqualified hardcoded `.pi` when the runtime exposes that setting.
- Global config path behavior is documented and tested for the chosen default/custom-directory policy.
- Existing README path examples remain accurate for default Pi installations.
- Type-checking and path tests pass.

- [ ] Decide and test whether ProtectMe should guard Pi user bash commands

#### Why

Pi exposes a separate `user_bash` event for `!` and `!!` commands typed directly by the user. ProtectMe currently guards only LLM `tool_call` events where `toolName === "bash"`. The README emphasizes agent network access, but the extension name and `/protectme` panel can be read as session-wide protection. Without an explicit scope decision, users may assume `!curl https://...` is guarded when it is not.

#### How to resolve

- Decide whether v1 should guard only agent bash tool calls or also intercept `user_bash` network commands.
- If guarding user bash is in scope, register a `user_bash` handler in `src/events/network-guard.ts` that reuses the same extraction, config, prompt, logging, and fail-closed behavior without breaking user-command semantics.
- If user bash is out of scope, update `README.md`, `SECURITY.md`, `docs/manual-smoke-test.md`, and tests to state the boundary clearly.
- Add tests for the chosen behavior, including no-UI/print mode and repeated attempts if applicable.
- Validate with focused tests and the full suite.

#### Acceptance criteria

- The public documentation and runtime behavior agree on whether `!`/`!!` user bash commands are protected.
- The chosen scope has explicit tests and cannot be confused with LLM `bash` tool-call behavior.
- Any unsupported path gives users a clear documented mitigation.
- Type-checking, linting, and tests pass.

- [ ] Add Pi-context integration tests for lifecycle, trust, and command UI contracts

#### Why

Existing tests use narrow fakes for event handlers and panel interactions, which is useful, but they do not verify the actual shape and guarantees of Pi extension contexts. The highest-risk remaining assumptions involve `ctx.isProjectTrusted()`, `ctx.hasUI`, `ctx.mode`, `ctx.ui.custom()`, status APIs, and delivery semantics around `pi.sendUserMessage()`. These are exactly where production Pi behavior can differ from a small fake.

#### How to resolve

- Build a focused local integration harness or richer fake that mirrors Pi's documented `ExtensionContext` and `ExtensionCommandContext` shapes for ProtectMe's used APIs.
- Cover session start/shutdown, reload-like state reset, trusted/untrusted project config loading, TUI versus RPC/JSON/print command behavior, and repeated blocked attempts.
- Add a documented manual smoke-test evidence template for real `pi --no-extensions -e .` runs when an automated Pi runtime test is impractical.
- Keep tests deterministic and avoid credentials, real network calls, or destructive commands.

#### Acceptance criteria

- ProtectMe has tests or documented smoke evidence for the Pi context APIs it depends on.
- Trusted/untrusted project behavior, UI availability, command mode gating, status updates, and guidance delivery are covered by deterministic checks where possible.
- Any behavior that cannot be automated has an explicit manual validation checklist and blocker.
- The full automated suite passes after the test updates.

- [ ] Convert repeated-attempt prompt errors into explicit fail-closed outcomes

#### Why

`promptForRepeatedBlockedRequest()` and `allowViaConfigWrite()` handle normal user choices and write failures, but a rejected `ui.select()` or `ui.editor()` promise can bubble out of `handleNetworkGuardToolCall()`. Pi treats `tool_call` handler errors as fail-safe blocks, but the user/agent may receive a generic extension error rather than a ProtectMe-specific reason, and the blocked-attempt log may miss the failed prompt outcome.

#### How to resolve

- Wrap repeated-attempt UI prompt calls in `src/events/network-guard.ts` with explicit error handling that fails closed using a ProtectMe block reason.
- Log a bounded outcome for prompt errors without logging sensitive exception details.
- Notify the user when UI is available, using a concise actionable message.
- Add tests where `ui.select()` and `ui.editor()` reject, including no config write and logged fail-closed outcomes.
- Keep existing allow-once, add-project, add-global, keep-blocked, and no-UI behavior unchanged.

#### Acceptance criteria

- Prompt UI errors return a ProtectMe-specific `{ block: true, reason }` instead of an unhandled exception path.
- Failed prompt interactions are logged with bounded, non-sensitive metadata.
- Existing repeated-attempt tests still pass, and new rejection tests cover select/editor failures.
- Any remaining unhandled prompt edge case is documented with a precise blocker.

## Unknowns resolved

- The review confirmed that ProtectMe v1 has no custom tool schema surface to validate; tool-schema checklist items are not applicable until future custom tools are added.
- The review confirmed that public mutable file writes are limited to ProtectMe config/log files, not arbitrary user-selected paths.
- The review confirmed that generated/state files are gitignored and package-content checks reject `.pi/`, logs, specs, reports, build outputs, and tarballs.
- The review confirmed that a live Pi TUI smoke test remains the main unverified runtime check.

## Blocked checks or areas not reviewed

- A live `pi --no-extensions -e .` TUI smoke session was not run.
- Real project-trust transitions were not exercised in Pi; trust behavior was reviewed from docs and code only.
- RPC/JSON/print mode behavior was reviewed by code/tests, not by running Pi in those modes.
- Sonar and Trivy scans were not run locally due token/script and local CLI/report-output blockers recorded in earlier specs.
