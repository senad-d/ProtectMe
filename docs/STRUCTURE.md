# ProtectMe Structure Guide

ProtectMe is a Pi extension package for network and website access guardrails. The current implementation includes config parsing/merging/write-back, host normalization and allow matching, supported bash request extraction, blocked-attempt logging, session lifecycle status/warnings, first-attempt blocking, repeated-attempt prompts, allow-mode bypass behavior, and a one-box `/protectme` TUI configuration panel with in-panel confirmation flows.

## Current implementation layout

```text
src/
├── config/
│   ├── config-defaults.ts        # missing-config default effective policy helpers
│   ├── config-loader.ts          # JSON parsing, validation, merge, normalization, and write-back helpers
│   ├── config-paths.ts           # deterministic global/project/log path helpers
│   ├── config-types.ts           # user config, parsed metadata, and effective config types
│   └── index.ts                  # config barrel exports and registration hook
├── events/
│   └── network-guard.ts          # lifecycle status/warnings, attempt state, blocking, prompts, and config writes
├── logging/
│   └── blocked-attempt-log.ts    # blocked-attempt JSONL helpers and registration hook
├── policy/
│   ├── bash-url-extractor.ts     # supported bash request CLI segmentation and URL extraction
│   ├── block-message.ts          # consistent ProtectMe block reason and agent guidance text
│   ├── host-matcher.ts           # allow-list normalization and host matching helpers
│   ├── host-normalization.ts     # host/URL cleanup, validation, and warning metadata
│   ├── prompt-suggestion.ts      # clean editable allow-entry suggestions for repeated blocks
│   └── index.ts                  # policy barrel exports and registration hook
├── ui/
│   ├── protectme-panel.ts        # /protectme command registration and command-mode gating
│   └── protectme-panel/
│       ├── actions.ts            # TUI action orchestration and config-write refresh behavior
│       ├── component.ts          # keyboard routing, in-panel dialogs, panel state, and render caching
│       ├── rendering.ts          # pure one-box layout, dialog rows, settings rows, and text fitting
│       └── types.ts              # shared TUI panel contracts
├── constants.ts                  # shared names, command name, status key, config/log paths
└── extension.ts                  # composition root that calls register* hooks only
```

## Runtime responsibilities

- `extension.ts` imports feature modules and calls `register*` functions only.
- `events/network-guard.ts` registers `session_start`, `session_shutdown`, and `tool_call` behavior.
- `ui/protectme-panel.ts` registers `/protectme` and loads config/log summaries before opening the TUI component.
- `ui/protectme-panel/` keeps keyboard routing, action execution, and pure rendering in separately testable modules.
- `logging/blocked-attempt-log.ts` owns JSONL entry construction, redaction/truncation, directory creation, and appending blocked attempts.
- `config/` owns config schema validation, path resolution, load/merge semantics, normalization, and safe write-back.
- `policy/` owns pure request detection, host normalization, matching, and clean prompt suggestions.

## Config and local state paths

```text
~/.pi/agent/protectme.json       # global config
.pi/protectme.json               # project config
.pi/agent/protectme_log.jsonl    # project blocked-attempt log
```

The implemented config schema is:

```json
{
  "mode": "block",
  "allowList": ["example.com"]
}
```

Project mode overrides global mode when present. Project allow-list entries append to global entries. Missing config defaults to `mode: "block"` and an empty allow list. Invalid or unreadable config fails closed and emits warnings.

## Module ownership

- `config/` owns JSON schema handling for `mode` and `allowList`.
- `policy/` owns pure helpers for request detection and host matching.
- `events/` owns Pi runtime wiring and must stay thin.
- `logging/` owns `.pi/agent/protectme_log.jsonl` writes.
- `ui/` owns the `/protectme` panel and must follow `docs/configuration-tui-design-standard.md`.
- `extension.ts` must stay small and must not contain parsing, matching, logging, or TUI logic.

## Pi extension conventions

- Do not start long-lived processes, file watchers, timers, sockets, or background jobs in the extension factory.
- Start session-scoped resources from `session_start`, a command, or a tool, then clean them up in `session_shutdown`.
- ProtectMe v1 does not register custom agent tools.
- If future custom tools are added, define TypeBox schemas, descriptions, `promptSnippet`, and tool-named `promptGuidelines`.
- Use `StringEnum` from `@earendil-works/pi-ai` for string enum schemas when enum fields are needed.
- If a future custom tool mutates files, use Pi file mutation queue helpers and resolve paths safely.
- Keep Pi core packages in `peerDependencies` with `"*"`.
- Put non-Pi runtime libraries in `dependencies` and development tooling in `devDependencies`.

## Validation expectations

Keep these checks passing:

```bash
npm run typecheck
npm run test
npm run check:pack
npm run validate
pi --no-extensions -e .
```
