# Changelog

## 0.2.1 - 2026-11-26

- The prompt lists the deny choices first: `Deny once`, `Deny for session`, `Deny for project`, `Deny globally`, then the four allow choices. The list's cursor starts on its first row, so a stray Enter no longer approves a request. The labels are unchanged.

## 0.2.0 - 2026-11-26

The approval prompt. One list replaces the three steps of the old prompt, and a choice can be saved for the session, the project or everywhere.

- New `denyList` in the config, with the same entry format as `allowList`. A deny entry wins over an allow entry. A denied host is refused at once, with no prompt and no hint to repeat the request.
- The prompt is one list: `Allow once`, `Allow for session`, `Allow for project`, `Allow globally`, `Deny once`, `Deny for session`, `Deny for project`, `Deny globally`. A cancelled prompt is `Deny once`. The project choices are left out for an untrusted project, and a scope whose config file is broken is left out too.
- Removed the editor step and the "choose config" step from the prompt. `/protectme` still edits entries by hand.
- The prompt lists every unlisted host of the command, and the choice applies to all of them. Before, it asked about the first host only and let the others run.
- The prompt says whether the request is read-only or sends data, and what a saved choice writes: `Saves: example.org (and its subdomains)`. It no longer shows config paths or an attempt number.
- Session scope for every request: allowed and denied hosts are kept in memory until the session ends, or in the JSON file named by `PROTECTME_SESSION_CONFIG` (`{ "allowList": [], "denyList": [] }`). The file is created on the first save and read on every call, so several sessions can share it.
- With `PROTECTME_SESSION_READS=ask`, "Allow reads from the listed hosts for this session" is replaced by `Allow for session`. "Allow all read-only requests for this session" stays as a ninth row.
- ProtectMe emits `herdr:blocked` on `pi.events` when the prompt opens (`{ active: true, id, label, guard }`) and when it closes (`{ active: false, id }`). `guard` holds the redacted command, the hosts, the reason, the entry a choice saves and the option labels.
- Allows and denies from the prompt are logged, one line per host: `prompt_allowed_once|session|project|global` and `prompt_denied_once|session|project|global`. A refusal by a deny list is logged as `denied`. `prompt_denied` is gone, and a failed save is logged as `prompt_error`.
- A refusal by a deny list reads `ProtectMe denied network request to <host>: the host is on the deny list.` The first-block sentence is unchanged.
- `/protectme` edits keep the `denyList` of the file they write.
- Simplified network guard decisions and approval text formatting, and verified that multi-host audit records are still written in order.
- Bumped the package and lockfile version to 0.2.0.

## 0.1.8 - Unreleased

- Bumped ProtectMe to 0.1.8 and updated the Pi development dependencies to 1.6.0.
- `PROTECTME_SESSION_READS=ask` now asks on the first try of a read-only request instead of blocking it silently first (Mission 2026-11-22: every website approval said "Attempt: 2"). The prompt adds "Allow all read-only requests for this session", which lets every later read-only request of the session through unasked. A request that sends data keeps the silent first block.
- Saving the project config adds `protectme.json` and `.gitignore` to `.pi/.gitignore`, appending missing lines to an existing file, unless git already tracks `.pi/protectme.json`.

## 0.1.7 - Unreleased

- Bumped the package and lockfile version to 0.1.7.
- Replaced repeated session-read mode unions with a shared type alias to address Sonar maintainability guidance.

Session reads, for a host that runs a research session (Mission my-shop 2026-11-14: 41 "Allow once" prompts while a researcher fetched public pages from 30 hosts).

- `PROTECTME_SESSION_READS=ask` adds the choice "Allow reads from the listed hosts for this session" to the repeated-attempt prompt of a read-only request. The prompt lists every read-only host of the command that is not on the allow list; the choice allows read-only requests to them until the session ends and writes no config.
- `PROTECTME_SESSION_READS=open` lets read-only `curl` and `wget` requests through without a block or a prompt.
- Read-only means no body, form, upload or method option (`-d`, `--data*`, `-F`, `--form*`, `-T`, `--upload-file`, `-X`, `--request`, `--json`, `--post-*`, `--method`, `--body-*`). Anything else, HTTPie included, keeps the per-host prompt in both modes, and so do the user's own bash commands.
- Unset or any other value: no change.

## 0.1.6 - Unreleased

- Bumped the package and lockfile version to 0.1.6.
- Replaced backtracking-prone git worktree entry parsing with linear string operations.
- Refactored bounded, newest-first blocked-host log reads into an async iterator that stops once enough hosts are found.
- Fixed curl option values such as `--retry 2` being read as request hosts (`0.0.0.2`). Completed the curl, wget, and HTTPie value-flag tables from `curl --help all` and the wget and HTTPie manuals.
- Fixed flags that take no value (`curl -O`, `wget --page-requisites`, `wget -h`, `http --form`, `http --chunked`, `http --multipart`, `http --headers`, `http -c`) hiding the URL after them from the guard.
- A bare number in a target position now fails closed as an unsupported option, with an honest reason, instead of being read as an IPv4 shorthand host.
- Project config and the blocked-attempt log now resolve to the main worktree when Pi runs inside a linked git worktree, so saved allow-list entries and the audit log outlive temporary worktrees.
- The blocked-attempt log directory now gets a `.gitignore` for the log file when none exists, so `git add -A` does not commit it.
- First-attempt block guidance now says that repeating the same request asks the user when a prompt UI exists, and says not to retry when it does not.
- Documented that ProtectMe inspects only `curl`, `wget`, and HTTPie command lines and is not a network sandbox.

## 0.1.0 - Unreleased

- Simplified the TUI footer status to show only the globe icon, without the allow-list site count.
- Pinned TypeScript to the supported 6.0 release line and blocked incompatible Dependabot upgrades until `typescript-eslint` supports them.
- Added a manual npm publish workflow that reads the package version, validates package contents, publishes with provenance, and pushes a matching release tag.
- Consolidated bash URL extractor option parsing to reduce Sonar-reported duplication.
- Reworked bash target-token loop advancement to avoid unused assignment lint failures.
- Replaced host-normalization trailing-dot regex with linear string scanning.
- Simplified bash variable-assignment matching with a concise word-character class.
- Reduced bash command segment-splitting and tokenizing complexity with focused scan-state helpers.
- Moved curl/wget and HTTPie long- and short-option token skipping into extractor loop update steps.
- Replaced complex blocked-attempt sensitive-key matching with explicit helpers.
- Replaced blocked-attempt URL credential and query-parameter redaction with linear scanning to avoid backtracking-prone matching.
- Combined consecutive `/protectme` panel render-line pushes for cleaner array construction.
- Wrapped recent blocked-host line formatting callbacks to pass intended arguments explicitly.
- Updated package keywords to improve discovery for Pi network-access guardrail, allow-list, and agent-security use cases.
- Added a built-in starter allow list for local development and common developer sites, plus docs for adding local subdomains such as `app.localhost`.
- Added five lively, text-free SVG application icon variants and refreshed the primary ProtectMe icon asset.
- Added five dark, text-free globe safety SVG application icon variants and refreshed the primary icon to the first dark globe variant.
- Added five refined dark globe-lock SVG variants based on `icon-globe-safe-v2.svg`, with closed/vector-clipped edges for cleaner line endings.
- Prepared ProtectMe package identity as `@senad-d/protectme`.
- Added an `npm run open:google` helper that opens Google in the default browser.
- Added approved project definition brief and three implementation specs.
- Documented planned network guard behavior, config schema, TUI plan, and security model.
- Replaced template runtime examples with a preparation-only extension entry point.
- Added non-functional config, policy, logging, events, and UI registration shells.
- Added ProtectMe config types, deterministic path helpers, and missing-config defaults.
- Aligned ProtectMe config paths with Pi config-directory helpers, including the configured project directory name and custom global agent directory.
- Implemented config JSON parsing, validation, merge order, allow-list normalization, and write-back helpers.
- Implemented host normalization and allow-list matching helpers with warning metadata for ignored invalid entries.
- Prevented public suffix and unintended single-label allow-list entries from authorizing arbitrary child domains.
- Enforced fail-closed effective config behavior whenever any loaded global or trusted-project config is invalid or unreadable.
- Restored automated validation metadata checks and added a dependency-free `test:coverage` script that emits `coverage/lcov.info` for Sonar.
- Serialized ProtectMe config mutations for prompt and `/protectme` edits, with unique temporary write paths for same-millisecond writes.
- Added clean blocked-host prompt suggestion helpers using registrable-domain detection with exact-host fallbacks.
- Implemented bash request command extraction for supported `curl`, `wget`, `http`, and `https` invocations.
- Hardened bash request extraction for approved wrappers, proxy/resolver option destinations, and fail-closed static config/input-file sources.
- Implemented blocked-attempt JSONL logging helpers with bounded, redacted command snippets.
- Expanded blocked-attempt log redaction for URL credentials, sensitive query values, cookies, API keys, and auth flags.
- Registered first-attempt `tool_call` blocking for disallowed bash network requests with logging and agent guidance.
- Added `user_bash` guarding for Pi `!`/`!!` commands using the same supported request detection, prompts, logging, and fail-closed behavior.
- Added focused Pi-context integration tests for lifecycle reload resets, project trust propagation, command mode gating, TUI custom UI contracts, RPC prompts, and guidance delivery.
- Switched first-attempt guidance from follow-up user messages to non-displayed custom guidance messages so blocked calls do not queue unintended user-authored turns.
- Added second-attempt ProtectMe prompts for allow-once, project/global allow-list writes, keep-blocked, and no-UI fail-closed outcomes.
- Converted repeated-attempt prompt failures into explicit fail-closed ProtectMe block results with bounded `prompt_error` logs.
- Verified `mode: "allow"` bypass behavior for supported bash request CLIs without prompts or blocked-attempt logs.
- Added session lifecycle handling that resets ProtectMe attempt counters, shows mode/site-count status, reports config warnings, and clears status on shutdown.
- Honored Pi project trust before loading project ProtectMe config, with ignored-project status in session and TUI surfaces.
- Added the initial `/protectme` TUI information panel with responsive wide, narrow, and tiny layouts for config paths, mode, site counts, and recent blocked hosts.
- Added `/protectme` TUI editing actions for write-target selection, mode toggles, project/global allow-list additions, removals, refreshes, and safe write-error reporting.
- Replaced preparation-phase documentation with implemented user guidance for installation, config schema, merge behavior, matching rules, block/prompt flow, `/protectme`, logs, validation, smoke testing, and security-sensitive behavior.
- Added final package-content validation coverage and a documented manual isolated Pi smoke-test checklist.
- Refreshed module registration comments and composition tests to describe current pure-helper roles.
- Extracted shared ProtectMe config edit helpers for prompt and `/protectme` write flows.
- Refreshed ProtectMe session footer status and bounded config warnings after successful `/protectme` edits.
- Bounded `/protectme` recent blocked-host log reads and documented append-only log cleanup guidance.
- Split the `/protectme` TUI panel into separate command, component, action, rendering, and shared-type modules.
- Standardized CI dependency installation on `npm ci --ignore-scripts` to match Sonar lockfile validation.
- Reworked the `/protectme` TUI into a one-box configuration/info layout with in-panel mode confirmation, allow-list entry confirmation, blocked-host log viewing, compact `🌐 (n sites)` status text, and final confirmation before repeated-attempt prompt config writes.
- Added runtime initialization for missing global `~/.pi/agent/protectme.json` files and moved config-save target selection into final confirmation prompts.
- Reformatted README with package badges, quick start, installation, configuration, troubleshooting, update/uninstall, and publishing guidance.
