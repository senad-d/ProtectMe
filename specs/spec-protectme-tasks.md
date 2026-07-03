# Plan: ProtectMe implementation tasks

## Task Description
Define the later implementation backlog for ProtectMe. These tasks are intentionally unchecked and must be completed one at a time in a separate implementation session.

## Objective
Provide an actionable task sequence that implements ProtectMe from the prepared repository and approved architecture without ambiguity.

## Execution Rules
- Complete tasks in order unless the user approves a change.
- Keep every checkbox unchecked until that specific task is implemented and validated.
- Update tests and docs in the same task as behavior changes.
- Stop and ask when a spec decision is ambiguous.
- Do not repeat repository preparation.

## Tasks

### 1. Replace preparation placeholder with extension module registrations

- [x] Wire `src/extension.ts` to call registration functions for ProtectMe modules after creating non-functional module shells.

Create module shells for config, policy, events, logging, and UI. Keep registration functions minimal until their feature tasks are implemented. Do not register behavior before the corresponding tests and implementation exist.

#### Acceptance criteria

- `src/extension.ts` exports `protectMeExtension` as the default function.
- `src/extension.ts` only imports modules and calls `register*` functions.
- Empty or placeholder modules compile without registering incomplete behavior.
- No template example command or tool remains registered.

### 2. Implement config types, path resolution, and defaults

- [x] Add typed config definitions and path helpers for global config, project config, and blocked-attempt log paths.

Define `mode: "block" | "allow"`, `allowList: string[]`, parsed config metadata, and effective config types. Resolve global config as `~/.pi/agent/protectme.json`, project config as `.pi/protectme.json`, and log path as `.pi/agent/protectme_log.jsonl`.

#### Acceptance criteria

- Missing config resolves to effective `mode: "block"` and empty `allowList`.
- Path helpers return deterministic paths for a supplied `cwd` and home directory.
- Config types are exported for use by policy, events, UI, and tests.
- Unit tests cover path resolution and default config behavior.

### 3. Implement config parsing, normalization, merge, and write-back

- [x] Implement JSON config loading, validation, global/project merge order, and safe write-back helpers.

Global config must load first. Project config must append additional entries. Project `mode` overrides global `mode` when present; otherwise global `mode` applies; otherwise mode defaults to `block`. Normalize and deduplicate `allowList` entries. Write config with two-space JSON indentation.

#### Acceptance criteria

- Valid global and project configs merge exactly as specified.
- Invalid or unreadable config fails closed with metadata describing the error.
- Effective `allowList` is normalized and deduplicated.
- Write helpers create parent directories as needed.
- Unit tests cover valid, missing, invalid, duplicate, global-only, project-only, and merged configs.

### 4. Implement host normalization and allow matching

- [x] Implement host cleanup and matching rules for request hosts and `allowList` entries.

Strip scheme, path, query, fragment, port, and trailing dot from entries. Normalize case. Match each entry against itself and child subdomains, but never parent domains. Treat localhost and IP addresses as exact host entries.

#### Acceptance criteria

- `example.com` allows `example.com`, `example.com/login`, `api.example.com`, and deeper child subdomains.
- `api.example2.com` allows itself and child subdomains, but not `example2.com`.
- Localhost and IP matching is exact.
- Invalid entries are ignored with metadata for warnings.
- Unit tests cover domains, subdomains, paths, ports, uppercase, trailing dots, localhost, IPv4, and IPv6.

### 5. Implement clean prompt suggestions for blocked hosts

- [x] Add helper logic that suggests a clean editable entry for second-attempt prompts.

Use a maintained domain parser when available to suggest the registrable/base domain. Fall back to the exact normalized host for internal names, localhost, IPs, and parser failures. The suggestion must never include scheme, path, query, fragment, or port.

#### Acceptance criteria

- Blocked URL `https://api.example.com/v1?q=1` suggests `example.com` when a registrable domain is detected.
- Blocked host `api.example2.com` can still be edited by the user before saving.
- Localhost, IPs, and single-label hosts suggest themselves.
- Unit tests cover registrable-domain and fallback cases.

### 6. Implement bash network command extraction

- [x] Detect request targets only from supported request-making CLIs inside `bash` commands.

Support `curl`, `wget`, `http`, and `https`. Split common shell command segments and tokenize quoted arguments without executing shell code. Ignore raw URL literals when no supported request CLI is present. Ignore file/content tools completely.

#### Acceptance criteria

- `curl https://example.com` produces a URL candidate for `example.com`.
- `wget https://example.com/file` produces a URL candidate for `example.com`.
- `http GET https://api.example.com/v1` produces a URL candidate for `api.example.com`.
- `echo https://example.com` produces no network candidate.
- `write`, `edit`, and `read` tool inputs are not parsed by this helper.
- Unit tests cover flags, quoted URLs, multiple command segments, pipes, and non-network URL literals.

### 7. Implement blocked-attempt logging

- [x] Append blocked attempts to `.pi/agent/protectme_log.jsonl` with bounded, privacy-conscious metadata.

Log only blocked attempts. Create the log directory when needed. Keep each record as one JSON line. Include timestamp, host, command snippet, attempt count, mode, config source metadata, and outcome. Bound long command text.

#### Acceptance criteria

- A blocked attempt creates `.pi/agent/protectme_log.jsonl` when absent.
- Log entries are valid JSON lines.
- Allowed requests are not logged.
- Long command snippets are truncated with visible truncation metadata.
- Tests verify log creation, JSONL validity, and no logging for allowed requests.

### 8. Implement first-attempt block behavior

- [x] Register `tool_call` handling that blocks disallowed detected requests on first host attempt without aborting the session.

When effective mode is `block` and the host is not allowed, return a block reason from the `tool_call` handler. Do not call `ctx.abort()`. Store current-session attempt counts by normalized host and provide concise guidance to the agent.

#### Acceptance criteria

- First disallowed detected request returns `{ block: true, reason }`.
- Block reason names ProtectMe and the blocked host.
- The handler does not call `ctx.abort()`.
- The attempt is logged once.
- The agent receives guidance not to retry blindly and to continue safely.
- Tests or fakes verify first-attempt behavior.

### 9. Implement second-attempt user prompt flow

- [x] Prompt the user on second and later blocked attempts for the same host when UI is available.

Offer choices: allow once, add to project config and allow this call, add to global config and allow this call, or keep blocked. Show a clean editable suggested entry before saving to config. Fail closed when UI is unavailable.

#### Acceptance criteria

- Second blocked attempt for the same host opens a UI prompt in UI-capable mode.
- Allow once lets the current tool call proceed without writing config.
- Add to project writes `.pi/protectme.json` and lets the current call proceed.
- Add to global writes `~/.pi/agent/protectme.json` and lets the current call proceed.
- Keep blocked returns a block result and logs the blocked prompt outcome.
- No-UI mode blocks and explains that confirmation is unavailable.
- Tests or fakes cover each prompt outcome.

### 10. Implement mode `allow` behavior

- [x] Ensure `mode: "allow"` effectively disables ProtectMe blocking.

When effective mode is `allow`, detected requests must proceed without prompts and without blocked-attempt logs. Status and TUI may still show that ProtectMe is in allow mode.

#### Acceptance criteria

- `mode: "allow"` allows detected `curl`, `wget`, `http`, and `https` requests.
- `mode: "allow"` does not log blocked attempts because none are blocked.
- `mode: "allow"` does not prompt the user.
- Switching project mode to `allow` overrides global `block` mode.
- Tests cover mode precedence and disabled behavior.

### 11. Implement session lifecycle status and config warnings

- [x] Register lifecycle behavior for loading config, resetting counters, and showing concise status/warnings.

On `session_start`, load config, reset attempt counts, and set a status showing ProtectMe mode and effective site count when UI is available. On shutdown, clear status. Show warnings for invalid config or ignored entries.

#### Acceptance criteria

- Session start resets attempt counts.
- UI status shows `block` or `allow` and effective site count.
- Invalid config produces a warning and fails closed.
- Session shutdown clears ProtectMe status.
- No background watchers, timers, sockets, or processes are started.

### 12. Implement `/protectme` TUI information panel

- [x] Create the `/protectme` command and initial TUI panel that displays current ProtectMe configuration state.

The panel must show global config path, project config path, effective mode, global site count, project site count, effective site count, and recent blocked hosts if available. Follow `docs/configuration-tui-design-standard.md` for layout behavior.

#### Acceptance criteria

- `/protectme` opens only in TUI mode and explains the requirement otherwise.
- Wide layout uses a framed two-pane view.
- Narrow layout uses a framed one-pane view.
- Tiny layout uses a minimal no-border fallback.
- All rendered lines fit the terminal width.
- The panel displays config paths, mode, and site counts correctly.

### 13. Add config editing actions to `/protectme`

- [x] Add TUI actions to toggle mode, add entries, remove entries, and choose project or global write target.

Users must be able to change behavior between `block` and `allow`, add a cleaned/editable entry, remove entries, and save changes to project or global config. The UI should refresh counts after writes.

#### Acceptance criteria

- User can toggle mode between `block` and `allow` from the panel.
- User can add an entry to project config.
- User can add an entry to global config.
- User can remove an entry from project or global config.
- Counts and effective config refresh after each change.
- Write failures are shown as errors without corrupting config files.

### 14. Update README, SECURITY, structure docs, and changelog for implemented behavior

- [x] Replace preparation wording with accurate implemented behavior and user instructions.

Document installation, config schema, matching rules, block/prompt behavior, `/protectme`, logs, validation, isolated smoke tests, and troubleshooting. Keep security-sensitive behavior explicit.

#### Acceptance criteria

- README shows the final `mode` and `allowList` schema.
- README explains global and project config merge behavior.
- README explains first and second blocked-attempt behavior.
- SECURITY documents config writes, blocked-attempt logs, no telemetry, and no network calls by ProtectMe itself.
- `docs/STRUCTURE.md` matches implemented module layout.
- CHANGELOG records the implementation changes under `0.1.0 - Unreleased`.

### 15. Add integration and smoke validation coverage

- [x] Add final validation tests and document the manual isolated Pi smoke-test script.

Complete remaining tests for package metadata, helper coverage, event handler behavior, TUI render safety, and package contents. Document how to run `pi --no-extensions -e .` safely.

#### Acceptance criteria

- `npm run typecheck` passes.
- `npm run test` passes.
- `npm run check:pack` passes and excludes `.pi/`, logs, specs, and generated artifacts.
- `npm run validate` passes.
- Manual smoke test with `pi --no-extensions -e .` is documented and ready to run.
- No task is marked complete until its validation evidence exists.
