# Plan: ProtectMe architecture

## Task Description
Define the architecture for ProtectMe, a Pi extension package that guards network and website access from Pi agent shell tools. The extension will be packaged as `@senad-d/protectme`, expose the display name `ProtectMe`, and use `/protectme` for a future configuration and information panel.

This architecture is preparation-only. It documents the intended implementation and module boundaries for a later development session.

## Objective
Create a Pi-native network guard that blocks detected shell-based website requests unless the target host is allowed by global or project configuration, while leaving file tools and URL text editing untouched.

## Problem Statement
Pi agents frequently use tools such as `bash`, `read`, `write`, and `edit`. ProtectMe needs to guard real network requests without preventing the agent from reading, writing, or editing text that contains URLs. The extension must distinguish request-making shell commands from harmless URL literals and must keep the session running after a blocked request.

## Solution Approach
ProtectMe will subscribe to Pi lifecycle and `tool_call` events. It will only evaluate `bash` tool calls and only when the command invokes one of the configured request-making CLIs for v1: `curl`, `wget`, `http`, or `https`. It will load a global config first, append project config entries, calculate an effective policy, and block requests when the effective mode is `block` and the host is not matched by the effective `allowList`.

On first block for a host in a session, ProtectMe will block the tool call, log the attempt, and return/queue guidance for the agent explaining why the request was blocked and how to continue. On the second blocked attempt for the same host, ProtectMe will prompt the user when UI is available with choices to allow once, edit an allow-list entry and choose project/global config in the final save confirmation, or keep blocked.

## Relevant Files

### Existing files to update during implementation
- `src/extension.ts` - default extension entry point; keep small and only call registration functions.
- `src/constants.ts` - shared names, config filenames, status keys, command names, and log paths.
- `package.json` - package metadata, Pi manifest, runtime/development dependency declarations.
- `README.md` - user-facing setup, config schema, matching rules, and command behavior.
- `SECURITY.md` - trust model, file writes, network behavior, and privacy notes.
- `docs/STRUCTURE.md` - project-specific module layout and ownership.
- `test/*.test.mjs` - preparation and future pure-helper tests.

### New files
- `src/config/config-types.ts` - config and effective-policy TypeScript types.
- `src/config/config-paths.ts` - resolve global, project, and log paths using Pi config-directory conventions.
- `src/config/config-loader.ts` - read, validate, normalize, merge, and write configs.
- `src/policy/host-normalization.ts` - clean URLs/hosts, strip scheme/path, normalize case and trailing dots.
- `src/policy/host-matcher.ts` - match request hosts against `allowList` entries.
- `src/policy/bash-url-extractor.ts` - parse `bash` commands and extract URL candidates only from supported network CLIs.
- `src/policy/block-message.ts` - build consistent block guidance returned to the agent.
- `src/events/network-guard.ts` - register lifecycle, prompt-guidance, and `tool_call` handlers.
- `src/logging/blocked-attempt-log.ts` - append blocked attempts to `.pi/agent/protectme_log.jsonl`.
- `src/ui/protectme-panel.ts` - `/protectme` configuration and information TUI.
- `test/config-loader.test.mjs` - config merge and schema behavior.
- `test/host-matcher.test.mjs` - host matching behavior.
- `test/bash-url-extractor.test.mjs` - request detection behavior.
- `test/project-metadata.test.mjs` - package metadata and preparation invariants.

## Architecture Decisions

### Package and extension identity
- Package name: `@senad-d/protectme`.
- Display name: `ProtectMe`.
- Default exported function: `protectMeExtension`.
- Slash command: `/protectme`.
- Status key: `protectme`.

### Config schema
Use JSON with exactly the user-facing terms `mode` and `allowList`.

```json
{
  "mode": "block",
  "allowList": ["example.com", "api.example2.com"]
}
```

Rules:
- `mode: "block"` means ProtectMe is active. Detected network requests are blocked unless the host matches `allowList`.
- `mode: "allow"` means ProtectMe is effectively disabled. Detected requests are allowed and no block prompts are shown.
- Missing global config is initialized automatically with `mode: "block"` and the built-in starter allow list: `localhost`, `127.0.0.1`, `::1`, `pi.dev`, `github.com`, `npmjs.com`, `registry.npmjs.org`, and `nodejs.org`; missing project config falls back to the same built-in starter policy.
- Invalid config fails closed as `mode: "block"` with an empty effective allow list and a visible warning.
- Unknown keys are ignored but preserved only when safe write-back behavior is implemented.

### Config locations and merge order
- Global config: `~/.pi/agent/protectme.json`.
- Project config: `.pi/protectme.json` under `ctx.cwd`.
- A missing global config is initialized automatically with the built-in default config.
- Built-in starter entries load first.
- Global config appends additional `allowList` entries.
- Project config appends additional `allowList` entries when the project is trusted.
- Effective `mode` is project `mode` when present, otherwise global `mode`, otherwise `block`.
- Effective `allowList` is normalized starter entries followed by normalized global entries and normalized project entries, with duplicates removed.

### Host matching
- Request hosts are normalized to lowercase, stripped of trailing dots, and matched as hosts only.
- Allow entries are normalized from user input by stripping `http://`, `https://`, path, query, fragment, and port.
- Entry `example.com` allows:
  - `example.com`
  - `example.com/login`
  - `api.example.com`
  - deeper child subdomains such as `v2.api.example.com`
- Entry `api.example2.com` allows:
  - `api.example2.com`
  - `api.example2.com/v1`
  - deeper child subdomains such as `v2.api.example2.com`
- Entry `api.example2.com` does not allow parent `example2.com`.
- Localhost and IP hosts are supported as exact entries; child-subdomain matching applies only to DNS names.
- Add local subdomains such as `app.localhost` explicitly when a local test workflow uses them.

### Suggested entry cleanup
When prompting the user after a repeated block:
- Derive the blocked host from the request URL.
- Offer a clean editable default entry.
- Prefer the registrable/base domain when it can be safely detected.
- Fall back to the exact host for IP addresses, localhost, single-label internal hosts, and parsing failures.
- Let the user edit the entry before choosing the global or project config in the final save confirmation.

Use `tldts` or an equivalent maintained domain parser for registrable-domain suggestions, with a deterministic fallback to the normalized host.

### Tool-call interception
ProtectMe evaluates only `bash` tool calls for v1.

Do not evaluate these tools for network policy:
- `read`
- `write`
- `edit`
- `grep`
- `find`
- `ls`
- any custom tool unless explicitly added in a future version

Supported v1 network CLIs inside `bash`:
- `curl`
- `wget`
- `http`
- `https`

Parsing behavior:
- Split command into segments across common shell separators such as `;`, `&&`, `||`, and pipes while respecting quotes.
- Tokenize arguments without executing the shell.
- For `curl` and `wget`, ignore flag values that are not URL operands.
- For `http` and `https`, treat URL-like positional arguments as request targets.
- Ignore raw URL literals in commands that are not attached to supported request-making CLIs.

### Blocking behavior
When a detected request host is not allowed and effective `mode` is `block`:
1. Append a blocked-attempt log entry.
2. Increment the in-memory attempt count for the normalized host.
3. Return `{ block: true, reason }` from `tool_call` with a concise explanation and next steps.
4. Do not call `ctx.abort()`.
5. On first block for a host, queue or expose guidance that tells the agent:
   - the host was blocked by ProtectMe,
   - the request should not be retried blindly,
   - the agent should continue with local or already allowed work, or ask the user when access is necessary.
6. On second and later blocks for the same host, prompt the user when UI is available.

Prompt choices:
- Allow once.
- Edit allow-list entry and choose config before saving.
- Keep blocked.

Save confirmation choices:
- Save to project config and allow this call.
- Save to global config and allow this call.
- Cancel without saving.

Non-UI behavior:
- No prompt is possible.
- Repeated attempts remain blocked.
- The block reason must tell the agent that UI confirmation is unavailable.

### Agent guidance strategy
Use two complementary channels:
- The blocked tool result reason gives immediate feedback for the blocked tool call.
- A short ProtectMe guidance message or next-turn system-prompt addition reinforces the blocked-host policy so the agent does not keep retrying.

The guidance should be compact and should include only recent blocked hosts for the current session.

### Logging
Log only blocked attempts.

Path:

```text
.pi/agent/protectme_log.jsonl
```

Each line should be JSON with fields such as:
- `timestamp`
- `cwd`
- `toolName`
- `command`
- `rawUrl`
- `normalizedUrl`
- `host`
- `attempt`
- `mode`
- `configSources`
- `outcome`: `blocked`, `prompt_denied`, `prompt_unavailable`, or similar

Do not log allowed requests. Do not log secrets beyond the minimum needed to debug blocked network attempts. Consider truncating long commands.

### TUI architecture
The `/protectme` command opens a configuration and information panel.

Panel responsibilities:
- Show global config path.
- Show project config path.
- Show effective mode.
- Show global site count, project site count, and effective site count.
- Add a host entry to global or project config.
- Remove an entry from global or project config.
- Toggle mode between `block` and `allow`.
- Surface recent blocked hosts where useful.

The panel should follow `docs/configuration-tui-design-standard.md` after repository preparation moves the reusable TUI design guide under `docs/`.

### State and cleanup
- Keep session attempt counts in memory and reset them on `session_start`.
- Rebuild config state on `session_start` and reload it when needed in `tool_call`.
- Do not start watchers, timers, sockets, or background processes in the extension factory.
- Clean up UI/status state in `session_shutdown` when applicable.

## Implementation Phases

### Phase 1: Foundation
- Rename package/project identity.
- Replace template runtime registrations with a non-functional entry-point scaffold.
- Add config, policy, logging, and UI module placeholders.
- Add preparation-level tests for metadata and spec presence.

### Phase 2: Core Implementation
- Implement config parsing and merge behavior.
- Implement host normalization and matching.
- Implement supported bash request detection.
- Implement block logging and first/second attempt behavior.
- Add unit tests for pure helpers and event behavior where feasible.

### Phase 3: TUI and Polish
- Implement `/protectme` panel.
- Add editable allow-entry flow.
- Add mode toggle flow.
- Improve docs, security notes, troubleshooting, and smoke-test instructions.

## Testing Strategy
- Unit-test config loading, missing file defaults, invalid JSON fallback, merge order, and write-back behavior.
- Unit-test host normalization and matching for apex domains, subdomains, localhost, IPs, trailing dots, ports, and paths.
- Unit-test shell command extraction for supported CLIs and ignored URL literals.
- Use integration-style tests or lightweight fakes for `tool_call` handler behavior.
- Keep TUI render tests focused on line-width safety and visible state, not terminal internals.

## Acceptance Criteria
- Architecture separates config, policy matching, command parsing, logging, events, and UI.
- `src/extension.ts` remains small and only registers feature modules.
- The extension evaluates only actual request-making `bash` commands in v1.
- `read`, `write`, and `edit` content is never evaluated for network blocking.
- Config uses `mode` and `allowList` exactly.
- Global and project config merge behavior is deterministic.
- First and repeated blocked attempts follow the approved UX.
- Blocked attempts are logged to `.pi/agent/protectme_log.jsonl`.
- No feature behavior is implemented during preparation.

## Validation Commands
Use these after implementation tasks, not during this preparation spec creation unless explicitly requested:

- `npm run typecheck` - verify TypeScript compiles.
- `npm run test` - run unit tests.
- `npm run check:pack` - verify package dry-run contents.
- `npm run validate` - run full repository validation.
- `pi --no-extensions -e .` - isolated Pi smoke test.

## Notes
- Keep Pi core packages in `peerDependencies` with `"*"`.
- Put non-Pi runtime libraries such as a domain parser in `dependencies`.
- Put development tools in `devDependencies`.
- If a custom tool is added in a future version, define clear TypeBox schemas, descriptions, `promptSnippet`, and tool-named `promptGuidelines`.
- If enum schemas are needed in future tools, use `StringEnum` from `@earendil-works/pi-ai`.
