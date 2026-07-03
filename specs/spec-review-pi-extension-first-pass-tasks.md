# First-pass Pi extension review tasks

## Review scope and date

- Date: 2026-07-03
- Pass focus: security vulnerabilities, runtime bugs, unsafe input handling, broken validation, dependency risks, secret leakage, and high-risk Pi extension correctness.
- Target project: `/Users/senad/Documents/Code/Moj_git/pi-protectme`

## Files or areas reviewed

- Package and validation: `package.json`, `package-lock.json`, `tsconfig.json`, `eslint.config.js`, `scripts/check-format.mjs`, `scripts/check-package-contents.mjs`
- CI/security metadata: `.github/workflows/ci.yml`, `.github/workflows/sonar.yml`, `.github/dependabot.yml`, `sonar-project.properties`, `trivy_scan.sh`, `.gitignore`
- Pi docs reviewed for security-sensitive extension behavior: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`, `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/tui.md`, `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/packages.md`, and related extension examples
- Extension entry points: `src/extension.ts`, `src/constants.ts`
- Config loading/write-back: `src/config/config-defaults.ts`, `src/config/config-loader.ts`, `src/config/config-paths.ts`, `src/config/config-types.ts`, `src/config/index.ts`
- Policy/input parsing: `src/policy/bash-url-extractor.ts`, `src/policy/host-normalization.ts`, `src/policy/host-matcher.ts`, `src/policy/prompt-suggestion.ts`, `src/policy/block-message.ts`, `src/policy/index.ts`
- Runtime hooks and logging: `src/events/network-guard.ts`, `src/logging/blocked-attempt-log.ts`
- TUI command surface: `src/ui/protectme-panel.ts`
- Tests: `test/*.test.mjs`
- Documentation/spec conventions: `README.md`, `SECURITY.md`, `CHANGELOG.md`, `docs/STRUCTURE.md`, `docs/manual-smoke-test.md`, `docs/configuration-tui-design-standard.md`, `specs/spec-protectme-*.md`

## Safe commands run and results

- `pwd && find . -maxdepth 3 -type f | sort | sed 's#^./##' | head -200` — passed; initial repository map only.
- `find . -maxdepth 2 ...` and `find src test scripts .github -type f | sort` — passed; review map only.
- `git status --short && find specs -maxdepth 1 -type f -print | sort` — passed; repository currently appears fully untracked in this checkout, and no review spec existed before this pass.
- `npm run typecheck && npm run test && npm run lint:eslint && npm run format:check && npm run check:pack && npm audit --audit-level=moderate` — stopped at `npm run test`; `typecheck` passed, `test` failed 1 of 76 tests.
- `npm run lint:eslint` — passed.
- `npm run format:check` — passed for 56 files before review specs were added.
- `npm run check:pack` — passed; dry-run package contained 26 intended files and no forbidden package contents.
- `npm audit --audit-level=moderate` — passed; found 0 vulnerabilities.
- `npm run test:coverage` — failed; `package.json` has no `test:coverage` script while `.github/workflows/sonar.yml` calls it.

## Findings summary by severity

- Critical: 0
- High: 3
  - Project-local config can be read by a global/user-installed extension without checking Pi project trust, allowing an untrusted repository config to override global protection.
  - Bash request extraction has bypass-prone wrapper and network-option gaps around supported CLIs.
  - Blocked-attempt logs can retain sensitive URL/header/auth material in raw fields and snippets.
- Medium: 4
  - Single-label or public-suffix allow-list entries can become overly broad host wildcards.
  - Mixed valid and invalid config sources need a clear fail-closed policy and tests.
  - Validation/CI is already broken by metadata-test assumptions and a missing coverage script.
  - Config write-back lacks a serialized read-modify-write path for concurrent prompt/TUI edits.
- Low: 0

## Ordered unchecked tasks

- [x] Honor Pi project trust before loading project ProtectMe config

#### Why

ProtectMe can be installed as a user/global Pi extension, but `loadProtectMeConfig()` always reads `.pi/protectme.json` from the current working directory. Pi documentation exposes `ctx.isProjectTrusted()` specifically so extensions can avoid honoring project-local configuration from untrusted repositories. Because project `mode` overrides global mode, an untrusted checkout could include `.pi/protectme.json` with `{ "mode": "allow" }` and disable global blocking before the user has trusted the project.

#### How to resolve

- Update `src/events/network-guard.ts` and `src/ui/protectme-panel.ts` context handling to detect project trust through `ctx.isProjectTrusted()` when available.
- Update `src/config/config-loader.ts` or the call sites to support loading global config while treating project config as ignored/missing when project trust is false.
- Make the ignored-project-config state visible in warnings/status or metadata without reading the untrusted file contents.
- Add focused tests in `test/config-loader.test.mjs`, `test/network-guard.test.mjs`, and `test/protectme-panel.test.mjs` for a global/user extension in an untrusted project containing a permissive `.pi/protectme.json`.
- Validate with `npm run typecheck`, `npm run test`, and `npm run lint:eslint`.

#### Acceptance criteria

- Untrusted project-local `.pi/protectme.json` cannot override global/default block mode or add allow-list entries.
- Trusted projects preserve the documented global/project merge behavior.
- The TUI panel and session status make the ignored project-config state clear without leaking untrusted file contents.
- The relevant tests prove both trusted and untrusted project behavior, and `npm run typecheck`, `npm run test`, and `npm run lint:eslint` pass.

- [x] Harden supported bash request extraction against wrapper and option bypasses

#### Why

`src/policy/bash-url-extractor.ts` detects direct `curl`, `wget`, `http`, and `https` invocations, but wrapper forms such as `sudo -u user curl ...`, `env VAR=1 curl ...`, `time curl ...`, `timeout 5 curl ...`, and option-rich commands can bypass detection because the scanner stops on the first non-supported command token. It also skips network-affecting option values such as proxy or resolver flags, even though those values can introduce additional network destinations. That creates a practical bypass for the extension's main guardrail.

#### How to resolve

- Extend `findSupportedCliInvocation()` and related parsing in `src/policy/bash-url-extractor.ts` to safely skip common non-network wrappers and their option/value forms without executing shell code.
- Reassess URL-bearing or network-affecting flags for `curl`, `wget`, and HTTPie, including proxy, resolve/connect-to, input-file/config, and URL option forms; either detect and guard their hosts or fail closed with a documented block reason when static extraction cannot be safe.
- Add table-driven tests in `test/bash-url-extractor.test.mjs` and behavior tests in `test/network-guard.test.mjs` for supported wrappers and risky option cases.
- Validate with `npm run test -- test/bash-url-extractor.test.mjs` if supported by Node's test runner usage, plus the full `npm run test`.

#### Acceptance criteria

- Supported request CLIs remain detected when invoked through approved wrappers such as `sudo` with options, `env`, `time`, `timeout`, and `nice`.
- Network-affecting option values are either converted into guarded candidates or documented as unsupported and fail closed before the command executes.
- Existing non-network URL literal behavior remains unchanged.
- Focused extractor and network-guard tests cover the new bypass cases, and the full validation commands pass.

- [x] Redact sensitive blocked-attempt log data beyond command snippets

#### Why

`src/logging/blocked-attempt-log.ts` redacts a narrow set of authorization headers and key-value assignments in `commandSnippet`, but `src/events/network-guard.ts` writes `rawUrl` and `normalizedUrl` directly from the request target. A blocked URL such as `https://user:password@example.com/path?token=secret`, a proxy URL with credentials, a cookie header, `X-API-Key`, or HTTPie auth data can therefore be persisted to `.pi/agent/protectme_log.jsonl`. Logs are local, but they are durable project state and can be accidentally shared.

#### How to resolve

- Introduce a shared redaction helper in `src/logging/blocked-attempt-log.ts` that sanitizes command snippets, raw targets, normalized targets, headers, URL userinfo, query-string secrets, cookie/session values, and common auth flags.
- Ensure `logBlockedRequest()` in `src/events/network-guard.ts` passes only sanitized `rawUrl` and `normalizedUrl` values, or drops raw URL fields when they contain credentials.
- Add tests in `test/blocked-attempt-log.test.mjs` and `test/network-guard.test.mjs` for URL userinfo, query tokens, `Authorization`, `Cookie`, `X-API-Key`, `--user`, `--proxy-user`, and HTTPie `--auth` forms.
- Keep log records bounded and valid JSONL.

#### Acceptance criteria

- Blocked-attempt logs never contain the original credential, token, cookie, password, or API-key values in `commandSnippet`, `rawUrl`, `normalizedUrl`, or related fields.
- Redaction is visible enough for diagnostics without exposing secret material.
- Existing log creation, truncation, and allowed-request no-log behavior still pass.
- The relevant security-focused tests and `npm run test` pass.

- [x] Prevent overly broad allow-list entries from matching public suffixes or unintended single-label domains

#### Why

`normalizeHostInput()` accepts single-label DNS values, and `doesAllowEntryMatchHost()` allows DNS entries to match child subdomains. That means an allow-list entry such as `com` can match `example.com`, and an internal-looking single-label entry such as `internal-service` can match `api.internal-service` even though the prompt-suggestion tests describe single-label hosts as exact-host fallbacks. A small config typo can therefore expand access much more than intended.

#### How to resolve

- Define the intended policy for public suffixes and single-label DNS entries in `src/policy/host-normalization.ts` and `src/policy/host-matcher.ts`.
- Prefer rejecting public suffix allow-list entries such as `com`/`co.uk`, or treating them as invalid with warnings.
- Treat single-label non-localhost host entries as exact-only unless the project explicitly documents and tests wildcard semantics for them.
- Add tests in `test/host-matcher.test.mjs`, `test/config-loader.test.mjs`, and `test/prompt-suggestion.test.mjs` for public suffixes, single-label internal names, localhost, IPv4, and IPv6.
- Update user-facing docs only in the implementation task if behavior changes.

#### Acceptance criteria

- A public suffix entry cannot authorize arbitrary child domains.
- Single-label entries have explicit, tested semantics that match the documentation.
- Invalid or ignored entries produce actionable warning metadata.
- Host matching, config loading, and prompt-suggestion tests pass.

- [x] Define and enforce mixed-source invalid-config fail-closed behavior

#### Why

Tests prove that a sole invalid config falls back to block mode, but there is no coverage for mixed-source cases such as a valid global `{ "mode": "allow" }` plus an invalid project config, or an invalid global config plus a valid project `{ "mode": "allow" }`. `mergeProtectMeConfigs()` currently ignores invalid sources and may still use permissive settings from the other source. That may contradict the documented statement that invalid or unreadable config fails closed.

#### How to resolve

- Decide whether any invalid/unreadable source should force the effective mode to `block` with an empty effective allow-list, or whether only the invalid source should be ignored.
- Encode that policy in `src/config/config-loader.ts` and documentation.
- Add explicit tests in `test/config-loader.test.mjs` and `test/network-guard.test.mjs` for mixed valid/invalid global and project configs, including permissive `allow` mode cases.
- Ensure warnings clearly state which source was ignored or caused fail-closed behavior.

#### Acceptance criteria

- Mixed-source invalid/unreadable config behavior is unambiguous, documented, and tested.
- A malformed project or global config cannot accidentally broaden network access beyond the chosen policy.
- Warnings remain bounded and actionable.
- `npm run typecheck` and `npm run test` pass.

- [x] Restore automated validation by fixing metadata-test and coverage-script drift

#### Why

`npm run test` currently fails in `test/project-metadata.test.mjs` because `specs/spec-protectme-tasks.md` has all implementation tasks checked while the test still requires at least one unchecked backlog item. The same test hardcodes the exact spec file set, so required review specs under `specs/` will also break it. Separately, `.github/workflows/sonar.yml` runs `npm run test:coverage`, but `package.json` defines no `test:coverage` script. These issues make CI and review validation unreliable before any code changes are attempted.

#### How to resolve

- Update `test/project-metadata.test.mjs` so it checks durable metadata/spec conventions without assuming old backlog tasks remain unchecked or that `specs/` contains only the original three files.
- Add a real `test:coverage` script to `package.json` or change `.github/workflows/sonar.yml` to call an existing script and produce the configured coverage artifact.
- If coverage remains out of scope, document the Sonar workflow blocker and remove or gate the missing step.
- Re-run `npm run test`, `npm run validate`, and the Sonar-equivalent script path.

#### Acceptance criteria

- `npm run test` passes with the review spec files present.
- The Sonar workflow references only scripts that exist in `package.json` and, if configured, produces `coverage/lcov.info` for `sonar-project.properties`.
- `npm run validate` passes locally or a precise external-service blocker is documented.
- The test remains independently reviewable and does not require weakening coverage of package metadata.

- [x] Serialize ProtectMe config read-modify-write updates

#### Why

Prompt approvals in `src/events/network-guard.ts` and TUI edits in `src/ui/protectme-panel.ts` both perform read/modify/write updates to the same global or project config files. `writeProtectMeConfigFile()` uses a temporary file and rename, but the broader read-modify-write flow is not serialized. Concurrent approvals, TUI edits, or future parallel interactions can lose allow-list entries or mode changes, and temporary-path generation based on process id plus timestamp can collide under same-process same-millisecond writes.

#### How to resolve

- Introduce a per-config-path mutation queue or lock around the entire load/modify/write window for project and global config edits.
- Ensure temporary file names are unique even under concurrent same-process writes.
- Share the queue between network prompt writes and `/protectme` TUI writes.
- Add tests that run concurrent project/global edits and prove entries/mode changes are preserved deterministically.
- Keep writes atomic and do not corrupt invalid existing config files.

#### Acceptance criteria

- Concurrent config edits to the same file are serialized and cannot lose entries or mode updates.
- Temporary config writes cannot collide under same-process concurrent writes.
- Write failures leave the previous config intact and surface actionable errors.
- Focused concurrency tests and the full validation suite pass.

## Blocked checks or areas not reviewed

- Manual interactive smoke testing with `pi --no-extensions -e .` was not run because it requires an interactive Pi TUI session.
- Trivy filesystem scanning was not run because `trivy_scan.sh` requires the local Trivy CLI and writes report/cache output under ignored directories.
- Sonar scan was not run because it requires `SONAR_TOKEN`; the local script path is also blocked by the missing `test:coverage` script.
- Runtime behavior in a real Pi process was inferred from Pi documentation and code/tests; no live Pi session was started in this review pass.
