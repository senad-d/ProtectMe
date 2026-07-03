# Plan: ProtectMe implementation guidelines

## Task Description
Define engineering, Pi integration, packaging, testing, and security guidelines for the future ProtectMe implementation. These guidelines apply to all later tasks in this repository.

This document is preparation-only. It must guide future implementation without completing runtime behavior in the preparation session.

## Objective
Create a consistent development standard for ProtectMe so future work preserves the approved behavior, stays Pi-native, avoids accidental overreach, and remains testable.

## Problem Statement
ProtectMe is a security-sensitive extension because it blocks network requests and writes policy/config files. Future contributors need explicit rules for what the extension may inspect, what it may write, how it should interact with Pi events and UI, and how to validate behavior without compromising user workflows.

## Solution Approach
Use narrow, explicit boundaries:
- Evaluate only supported request-making `bash` commands in v1.
- Treat config and logs as the only file mutation surfaces.
- Keep all parsing and matching helpers pure and heavily tested.
- Keep UI separate from policy enforcement.
- Use Pi lifecycle and tool-call interception APIs as documented.

## Relevant Files
- `src/extension.ts` - must remain the small composition root.
- `src/constants.ts` - shared stable names and paths.
- `src/config/*` - config path, schema, parsing, merge, and write-back code.
- `src/policy/*` - URL/host normalization, shell-command extraction, and host matching.
- `src/events/*` - Pi event registration and runtime behavior.
- `src/ui/*` - `/protectme` TUI components only.
- `src/logging/*` - blocked-attempt logging.
- `docs/configuration-tui-design-standard.md` - visual standard for the configuration panel.
- `README.md`, `SECURITY.md`, `docs/STRUCTURE.md` - public behavior and development documentation.
- `test/*.test.mjs` - metadata tests now; pure-helper and behavior tests during implementation.

## Development Principles

### Preserve the approved scope
ProtectMe v1 protects only detected network/website access from supported shell commands.

Do not add these without a new approved spec:
- file-write protection outside ProtectMe config/log files,
- path protection,
- secret scanning,
- provider/network payload interception,
- package-install blocking,
- external telemetry,
- background services,
- broad URL scanning across all tool inputs.

### Keep `src/extension.ts` small
The entry point should only import feature modules and call their registration functions.

Approved shape:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerProtectMeCommand } from "./ui/protectme-panel.ts";
import { registerNetworkGuardEvents } from "./events/network-guard.ts";

export default function protectMeExtension(pi: ExtensionAPI) {
  registerNetworkGuardEvents(pi);
  registerProtectMeCommand(pi);
}
```

During preparation, runtime registrations may remain absent. During implementation, each registration must be backed by tests and documentation updates.

### Do not start resources in the extension factory
Never start long-lived processes, file watchers, timers, sockets, or background jobs directly in `protectMeExtension`.

If future behavior needs session-scoped resources:
- start them from `session_start`, a command, or a tool,
- clean them up in `session_shutdown`,
- document why they are needed.

ProtectMe v1 should not need any long-lived resources.

## Config Guidelines

### Schema names are user-facing API
Use this schema exactly:

```json
{
  "mode": "block",
  "allowList": ["example.com"]
}
```

Rules:
- `mode` values are only `block` and `allow`.
- `allowList` is camelCase.
- Do not reintroduce alternate names in public docs.
- Missing project config defaults to `mode: "block"` with the built-in starter `allowList`: `localhost`, `127.0.0.1`, `::1`, `pi.dev`, `github.com`, `npmjs.com`, `registry.npmjs.org`, and `nodejs.org`; missing global config is initialized automatically with that default file content.

### Config locations
- Global config: `~/.pi/agent/protectme.json`.
- Project config: `.pi/protectme.json`.
- Block log: `.pi/agent/protectme_log.jsonl`.

Use Pi config-directory constants where applicable instead of hardcoding `.pi` if a Pi API provides the directory name.

### Merge behavior
- Load built-in starter allow-list entries first.
- Read global config next.
- Read project config second only when project config is allowed by trust context.
- Effective `allowList` is starter plus global plus project, normalized and deduplicated.
- Effective `mode` is project mode when present, otherwise global mode, otherwise `block`.

### Write behavior
- Runtime startup must create `~/.pi/agent/protectme.json` with default config when the global config is missing.
- Project writes must create `.pi/` when needed.
- Log writes must create `.pi/agent/` when needed.
- Global writes must create `~/.pi/agent/` when needed.
- Use atomic-ish writes for JSON config when practical: write temp file, then rename.
- Preserve readable formatting with two-space JSON indentation.
- Avoid destructive rewrites of unknown keys until preservation support is explicit and tested.

## Policy Guidelines

### Evaluate only request-making shell tools
Only inspect `bash` tool calls in v1.

Supported request CLIs:
- `curl`
- `wget`
- `http`
- `https`

Never block a tool just because its input contains a URL unless that input is part of a supported network command.

### Tools that must remain outside policy evaluation
Do not evaluate these for ProtectMe network policy:
- `read`
- `write`
- `edit`
- `grep`
- `find`
- `ls`

This protects normal development workflows such as adding URLs to docs, source files, tests, or config.

### Host matching rules
- Normalize hosts to lowercase.
- Strip scheme, path, query, fragment, port, and trailing dot from config entries.
- Treat each entry as allowing itself and child subdomains.
- Never allow parent domains from a child entry.
- Treat localhost and IP entries as exact hosts.
- Document that users can add exact local subdomains such as `app.localhost` for local test workflows.
- Deduplicate normalized entries.

### Block behavior
- Return a `tool_call` block result with a helpful reason.
- Do not call `ctx.abort()` for ProtectMe blocks.
- Do not stop the whole session on first block.
- On first blocked host attempt, guide the agent to continue safely.
- On second blocked host attempt, prompt the user when UI is available.
- In non-UI modes, keep blocking and explain that confirmation is unavailable.

### Prompt wording
Block reasons and guidance should be short and explicit:
- name ProtectMe,
- name the blocked host,
- explain that `mode: "block"` allows only configured hosts,
- tell the agent not to retry blindly,
- suggest continuing with local work or asking the user.

## Pi Integration Guidelines

### Lifecycle events
Use:
- `session_start` to load config, reset host attempt counters, and set status.
- `before_agent_start` to append compact policy guidance when needed.
- `tool_call` to intercept supported request-making bash commands.
- `session_shutdown` to clear status/widgets and session state.

### User interaction
Use `ctx.hasUI` before prompting.

For second-attempt prompts:
- use `ctx.ui.select`, `ctx.ui.confirm`, `ctx.ui.input`, or a small custom dialog,
- keep choices clear,
- timeouts should fail closed unless explicitly designed otherwise,
- let the user edit the suggested entry before choosing project or global config in the save confirmation.

### TUI command
`/protectme` should use `ctx.mode === "tui"` before opening a custom TUI component.

If TUI is unavailable:
- show a concise notification or message explaining that `/protectme` requires TUI mode,
- do not try to render custom components.

### Custom tools
ProtectMe v1 should not register a custom agent tool.

If a future version adds one:
- define TypeBox schemas,
- include `description`, `promptSnippet`, and `promptGuidelines`,
- each `promptGuidelines` bullet must name the tool explicitly,
- use `StringEnum` from `@earendil-works/pi-ai` for string enum fields,
- truncate large outputs and tell the agent when truncation happens,
- use Pi file mutation queue helpers for file-mutating tools.

## TUI Guidelines

The `/protectme` panel must follow `docs/configuration-tui-design-standard.md`:
- wide screens use a two-pane framed layout,
- narrow screens use a one-pane framed layout,
- tiny screens use a minimal no-border fallback,
- rows use `▶ ` as the selection marker,
- values are right-aligned,
- line widths never exceed terminal width,
- theme roles are used instead of hardcoded ANSI colors.

Minimum panel content:
- effective mode: `block` or `allow`,
- global config path,
- project config path,
- global site count,
- project site count,
- effective site count,
- recent blocked hosts if useful,
- actions to add, remove, toggle mode, and close.

## Logging Guidelines

Log only blocked attempts.

Do not log:
- allowed requests,
- model prompts,
- arbitrary file contents,
- environment variables,
- credentials or tokens beyond what appears in the blocked command snippet.

When logging command snippets:
- keep them bounded,
- redact obvious credential patterns if feasible,
- include enough context for the user to understand what was blocked.

## Packaging Guidelines

### Dependencies
- Keep `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, and `typebox` in `peerDependencies` with `"*"` when imported.
- Keep local development packages in `devDependencies`.
- Put non-Pi runtime libraries such as a domain parser in `dependencies`.
- Do not bundle local state, generated reports, coverage, `.pi/`, or planning specs in the published package.

### Pi manifest
Keep:

```json
{
  "pi": {
    "extensions": ["./src/extension.ts"]
  }
}
```

Only change the extension path if the entry point moves and tests/docs are updated together.

## Documentation Guidelines

Update docs in the same task as behavior changes:
- `README.md` for user-facing behavior and examples,
- `SECURITY.md` for trust, file writes, and network behavior,
- `CHANGELOG.md` for release-visible changes,
- `docs/STRUCTURE.md` for module layout changes,
- relevant specs or task notes when decisions change.

Docs must clearly distinguish:
- prepared/planned behavior,
- implemented behavior,
- manual smoke-test steps.

## Testing Guidelines

### Pure helper tests first
Prioritize deterministic tests for:
- config parse/merge/default behavior,
- host normalization,
- host matching,
- command tokenization and URL extraction,
- block-message formatting.

### Runtime behavior tests
Use fakes or small harnesses for event handlers. Test:
- first block returns a block reason and logs,
- second block prompts in UI mode,
- no-UI repeated blocks fail closed,
- `mode: "allow"` allows detected requests,
- ignored tools are never evaluated.

### TUI tests
Keep TUI tests focused on:
- render output line widths,
- visible counts and paths,
- mode value display,
- add/remove/toggle action wiring through faked callbacks.

## Validation Commands
Run before completing future implementation tasks:

- `npm run typecheck`
- `npm run test`
- `npm run check:pack`
- `npm run validate`
- `pi --no-extensions -e .`

Use isolated smoke testing with `pi --no-extensions -e .` so unrelated installed extensions cannot affect results.

## Acceptance Criteria
- Future implementation follows the approved `mode` and `allowList` schema.
- Future implementation never evaluates file/content tools for URL text.
- Runtime code keeps config, policy, events, logging, and UI separate.
- `/protectme` TUI follows the project TUI design guide.
- Package metadata keeps Pi core packages as peers.
- Tests cover the security-sensitive decisions before release.
- Documentation remains aligned with implemented behavior.
