# Second-pass Pi extension review tasks

## Review scope and date

- Date: 2026-07-03
- Pass focus: maintainability, clean-code, logic, type-safety, edge cases, duplicated logic, stale tests/docs, and important coverage gaps.
- Target project: `/Users/senad/Documents/Code/Moj_git/pi-protectme`

## Files or areas reviewed

- Project metadata and scripts: `package.json`, `tsconfig.json`, `eslint.config.js`, `scripts/check-format.mjs`, `scripts/check-package-contents.mjs`
- CI and analysis workflows: `.github/workflows/ci.yml`, `.github/workflows/sonar.yml`, `.github/dependabot.yml`, `sonar-project.properties`
- Extension composition: `src/extension.ts`, `src/config/index.ts`, `src/policy/index.ts`, `src/logging/blocked-attempt-log.ts`, `src/events/network-guard.ts`, `src/ui/protectme-panel.ts`
- Config and policy helpers: `src/config/*.ts`, `src/policy/*.ts`
- TUI rendering and actions: `src/ui/protectme-panel.ts`, `docs/configuration-tui-design-standard.md`
- Runtime state/logging: `src/events/network-guard.ts`, `src/logging/blocked-attempt-log.ts`
- Test coverage and conventions: `test/*.test.mjs`, `specs/spec-protectme-*.md`, `docs/STRUCTURE.md`, `README.md`, `CHANGELOG.md`
- Pi docs/examples reviewed for maintainability expectations: extension lifecycle, TUI component line-width/caching, package dependency rules, command and status patterns.

## Safe commands run and results

- `npm run typecheck` — passed as the first command in the chained validation run.
- `npm run test` — failed 1 of 76 tests: `test/project-metadata.test.mjs` still requires an unchecked implementation backlog item and the original exact spec list.
- `npm run lint:eslint` — passed.
- `npm run format:check` — passed for 56 files before review specs were added.
- `npm run check:pack` — passed; dry-run package had 26 intended files and no forbidden package contents.
- `npm audit --audit-level=moderate` — passed; found 0 vulnerabilities.
- `npm run test:coverage` — failed because the script is missing from `package.json`.

## Findings summary by severity and category

- High: 0
- Medium: 5
  - Clean Code / Testing: placeholder registration comments and tests are stale after modules gained real behavior.
  - Architecture / Clean Code: config mutation and source-safety logic is duplicated between network prompts and the TUI panel.
  - Logic / UX: `/protectme` edits refresh the panel state but not the persistent ProtectMe footer status/warnings set during session startup.
  - Performance / Robustness: recent blocked-host reads load the whole JSONL log and there is no retention boundary.
  - Architecture / Maintainability: `src/ui/protectme-panel.ts` mixes rendering, keyboard routing, config mutations, log parsing, and text sanitization in one large module.
- Low: 1
  - CI / Reproducibility: CI uses `npm install` while local lockfile-based validation and the Sonar workflow use `npm ci`.

## Ordered unchecked tasks

- [x] Replace stale placeholder registration contracts with current module-role tests and comments

#### Why

`src/config/index.ts`, `src/policy/index.ts`, and `src/logging/blocked-attempt-log.ts` still describe their registration functions as placeholders for future work even though the project now has implemented config, policy, logging, events, and UI behavior. `test/extension-scaffold.test.mjs` also names several registrations as placeholders and asserts they avoid direct runtime behavior. That test can keep composition rules protected, but the wording and assertions now encode an old scaffold phase and make future maintainers reason about behavior through obsolete names.

#### How to resolve

- Update comments in `src/config/index.ts`, `src/policy/index.ts`, and `src/logging/blocked-attempt-log.ts` to describe their current role: pure helper exports and intentionally no event registration where applicable.
- Rename or restructure `placeholderRegistrations` in `test/extension-scaffold.test.mjs` to a current concept such as `pureModuleRegistrations`.
- Keep tests that verify `src/extension.ts` remains a composition root and that runtime hooks are registered only by the event/UI modules.
- Validate with `npm run test -- test/extension-scaffold.test.mjs` if using direct Node test invocation, plus `npm run test`.

#### Acceptance criteria

- No source comment or test name refers to implemented modules as future placeholders.
- Composition-root and no-unexpected-runtime-registration guarantees remain covered by tests.
- The update does not change runtime behavior.
- Relevant focused tests and the full test suite pass.

- [x] Extract shared config edit helpers for prompt and panel write flows

#### Why

`src/events/network-guard.ts` and `src/ui/protectme-panel.ts` both normalize edited allow-list entries, reject invalid/unreadable target config sources, append entries while preserving mode, and write project/global config files. The duplicated logic is already slightly divergent in naming and failure messages, and future changes from the first-pass config-safety tasks could be applied to one flow but missed in the other.

#### How to resolve

- Move shared config-edit planning helpers into `src/config/`, covering target selection, invalid/unreadable source rejection, normalized append/remove operations, and mode preservation.
- Use those helpers from both the network repeated-attempt prompt and the `/protectme` panel actions.
- Keep UI-specific notification and status-message text in the event/UI modules.
- Add tests that exercise the shared helper directly and prove both call sites preserve existing behavior.
- Validate with `npm run typecheck`, `npm run test`, and `npm run lint:eslint`.

#### Acceptance criteria

- Allow-list append/remove and mode-preserving config edits have one tested implementation path.
- Network prompt writes and TUI panel writes produce consistent config objects and failure behavior.
- UI modules remain responsible only for interaction and presentation concerns.
- Type-checking, linting, and tests pass.

- [x] Refresh ProtectMe session status after TUI config edits

#### Why

`handleNetworkGuardSessionStart()` sets a persistent footer status such as `ProtectMe: block · 2 sites`, and `handleNetworkGuardSessionShutdown()` clears it. `/protectme` panel edits refresh the panel's internal state after writes, but they do not update the session footer status or re-emit warnings. A user can toggle mode or edit the allow-list and still see stale footer state until the next session lifecycle event.

#### How to resolve

- Add a small shared status update function or event bridge that `/protectme` actions can call after `refreshProtectMePanelState()` succeeds.
- Keep status updates guarded by UI availability and avoid writing from non-TUI command paths.
- Reuse `buildProtectMeStatusText()` and bounded warning formatting rather than duplicating strings.
- Add tests in `test/protectme-panel.test.mjs` or a focused integration fake that verifies status text updates after mode toggles and allow-list changes.
- Validate with focused tests and `npm run test`.

#### Acceptance criteria

- After a `/protectme` mode or allow-list edit, the footer status reflects the refreshed effective mode and site count.
- Warnings from the refreshed config are surfaced in a bounded, actionable way or explicitly documented as session-start-only.
- Existing panel rendering and edit behavior stays unchanged.
- Focused TUI action tests and the full test suite pass.

- [x] Bound recent blocked-host log reads and define log-retention behavior

#### Why

`readRecentBlockedHosts()` reads the entire `.pi/agent/protectme_log.jsonl` file into memory, reverses all lines, and then takes the newest unique hosts. A long-running project with many blocked attempts can make opening `/protectme` slow or memory-heavy. The logging helper also appends indefinitely with no documented retention or compaction behavior.

#### How to resolve

- Replace full-file reads in `src/ui/protectme-panel.ts` with a bounded tail-read strategy or a helper that reads only enough bytes/lines to find the latest unique hosts.
- Decide whether ProtectMe should implement log retention, size warnings, or documentation-only cleanup guidance for the JSONL file.
- Add tests for malformed lines, duplicate hosts, very large synthetic logs, and bounded memory behavior using temporary files.
- Keep the existing newest-unique-host order.
- Validate with focused panel/log tests and `npm run test`.

#### Acceptance criteria

- `/protectme` can display recent blocked hosts without loading arbitrarily large logs into memory.
- Log retention or cleanup behavior is documented and tested if implemented.
- Existing malformed-line handling and newest unique ordering remain intact.
- Tests cover large-log behavior and pass with the full suite.

- [ ] Split the ProtectMe TUI panel into smaller reviewable modules

#### Why

`src/ui/protectme-panel.ts` currently owns command registration, command handling, panel component state, action execution, config writes, recent-log parsing, responsive rendering, text fitting, and sanitization in one large file. This concentration increases review cost and makes it easy for rendering changes to accidentally affect config-write behavior.

#### How to resolve

- Split pure rendering helpers, action/config-edit orchestration, recent-log parsing, and the panel component into separate files under `src/ui/` or `src/ui/protectme-panel/`.
- Preserve the public exports used by tests or update tests to import from the new stable module boundaries.
- Keep pure functions easy to unit test without a Pi runtime.
- Avoid broad rewrites: move code in small, behavior-preserving steps with focused tests after each extraction.
- Validate with `npm run typecheck`, `npm run test`, and `npm run lint:eslint`.

#### Acceptance criteria

- The `/protectme` command behavior, keyboard shortcuts, and rendered layouts are unchanged.
- Rendering, action execution, and log parsing can be tested independently.
- No new circular dependencies or public API ambiguity is introduced.
- Type-checking, linting, and tests pass after the split.

- [ ] Standardize CI dependency installation on the lockfile

#### Why

`.github/workflows/ci.yml` uses `npm install`, while `.github/workflows/sonar.yml` uses `npm ci --ignore-scripts`. The repository has a `package-lock.json`, so CI should consistently validate exactly the locked dependency graph. Divergent install modes can produce different dependency trees and make local/CI failures harder to reproduce.

#### How to resolve

- Change `.github/workflows/ci.yml` to use `npm ci`, preferably with the same script policy chosen for Sonar.
- Confirm whether `--ignore-scripts` is required or safe for this project's dependencies.
- Keep Node setup cache behavior intact.
- Validate by running the local equivalent install/validation sequence in a clean environment or documenting any environment blocker.

#### Acceptance criteria

- CI and Sonar workflows use a consistent lockfile-based install strategy unless a documented reason requires divergence.
- The chosen install command works with the project's package-lock and validation scripts.
- Workflow documentation or comments explain any intentional difference.
- Local validation remains reproducible.

## Blocked checks or areas not reviewed

- Full `npm run validate` was not run to completion because `npm run test` already fails and review spec creation changes the spec-file assumptions that caused the current failure.
- Manual `/protectme` TUI smoke testing was not run in an interactive Pi session.
- Sonar and Trivy checks were not run locally due missing `test:coverage`/token and Trivy CLI/report-output requirements, respectively.
- Low-risk documentation pages were skimmed for conventions but not exhaustively proofread beyond behavior claims relevant to code review.
