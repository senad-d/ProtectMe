# Changelog

## 0.1.0 - Unreleased

- Prepared ProtectMe package identity as `@senad-d/protectme`.
- Added approved project definition brief and three implementation specs.
- Documented planned network guard behavior, config schema, TUI plan, and security model.
- Replaced template runtime examples with a preparation-only extension entry point.
- Added non-functional config, policy, logging, events, and UI registration shells.
- Added ProtectMe config types, deterministic path helpers, and missing-config defaults.
- Implemented config JSON parsing, validation, merge order, allow-list normalization, and write-back helpers.
- Implemented host normalization and allow-list matching helpers with warning metadata for ignored invalid entries.
- Added clean blocked-host prompt suggestion helpers using registrable-domain detection with exact-host fallbacks.
- Implemented bash request command extraction for supported `curl`, `wget`, `http`, and `https` invocations.
- Implemented blocked-attempt JSONL logging helpers with bounded, redacted command snippets.
- Registered first-attempt `tool_call` blocking for disallowed bash network requests with logging and agent guidance.
- Added second-attempt ProtectMe prompts for allow-once, project/global allow-list writes, keep-blocked, and no-UI fail-closed outcomes.
- Verified `mode: "allow"` bypass behavior for supported bash request CLIs without prompts or blocked-attempt logs.
- Added session lifecycle handling that resets ProtectMe attempt counters, shows mode/site-count status, reports config warnings, and clears status on shutdown.
- Added the initial `/protectme` TUI information panel with responsive wide, narrow, and tiny layouts for config paths, mode, site counts, and recent blocked hosts.
- Added `/protectme` TUI editing actions for write-target selection, mode toggles, project/global allow-list additions, removals, refreshes, and safe write-error reporting.
- Replaced preparation-phase documentation with implemented user guidance for installation, config schema, merge behavior, matching rules, block/prompt flow, `/protectme`, logs, validation, smoke testing, and security-sensitive behavior.
- Added final package-content validation coverage and a documented manual isolated Pi smoke-test checklist.
