# Project Definition Brief

## 1. Bootstrap

- Template source: `/Users/senad/Documents/Code/Moj_git/pi-tmp`
- Target directory: `/Users/senad/Documents/Code/Moj_git/pi-protectme`
- Copy status: template copied into the target directory and prepared for ProtectMe.

## 2. Project identity

- Package name: `@senad-d/protectme`
- Display name: `ProtectMe`
- Exported extension function: `protectMeExtension`
- Repository URL: `https://github.com/senad-d/pi-protectme`
- One-sentence pitch: ProtectMe blocks unapproved network and website requests from Pi agent shell tools while allowing normal file editing and URL text handling.

## 3. Users and use cases

- Primary users: Pi users who want network egress guardrails for agent sessions.
- Primary use cases:
  - Block supported shell-based network requests to unapproved hosts.
  - Merge global and project-specific allowed site configuration.
  - Prompt the user on repeated blocked requests for the same host.
  - Manage ProtectMe configuration through `/protectme`.
- Non-goals:
  - File/content tool protection.
  - Secret scanning.
  - Broad URL scanning across every tool input.
  - Telemetry or external reporting.

## 4. Pi integration surface

| Surface | Name | Purpose | Notes |
| --- | --- | --- | --- |
| Command | `/protectme` | Open TUI configuration and information panel | Planned, not implemented during preparation |
| Tool | none | No custom agent tool for v1 | ProtectMe intercepts existing `bash` calls |
| Event | `session_start` | Load config, reset counters, set status | Planned |
| Event | `before_agent_start` | Add compact policy guidance when needed | Planned |
| Event | `tool_call` | Inspect supported network commands and block/prompt | Planned |
| Event | `session_shutdown` | Clear status/session state | Planned |
| UI | ProtectMe panel | Show paths/counts/mode and edit config | Planned |
| Resource | none | No skills, prompts, or themes planned |  |

## 5. Architecture

- Planned files:
  - `src/config/*`
  - `src/policy/*`
  - `src/events/network-guard.ts`
  - `src/logging/blocked-attempt-log.ts`
  - `src/ui/protectme-panel.ts`
- Module boundaries:
  - Config loading/writing is separate from policy matching.
  - Bash command extraction is pure and tested.
  - Runtime event handlers stay thin.
  - TUI code is separate from enforcement logic.
  - `src/extension.ts` stays small.
- Dependencies:
  - Pi packages remain peer dependencies.
  - `@earendil-works/pi-tui` is available for planned TUI implementation.
  - `tldts` is planned for clean domain suggestions.

## 6. Config, state, and persistence

- Global config: `~/.pi/agent/protectme.json`
- Project config: `.pi/protectme.json`
- Block log: `.pi/agent/protectme_log.jsonl`
- Config schema:

```json
{
  "mode": "block",
  "allowList": ["example.com", "api.example2.com"]
}
```

- `mode: "block"`: detected requests are blocked unless allowed.
- `mode: "allow"`: ProtectMe is effectively disabled and detected requests are allowed.
- Effective `allowList`: global entries plus project entries.
- Effective `mode`: project mode when present, otherwise global mode, otherwise `block`.
- Session state: in-memory blocked-host attempt counts, reset per session.

## 7. Security and privacy

- Shell execution: ProtectMe does not execute shell commands itself.
- File access/mutation: ProtectMe writes only its config files and blocked-attempt log.
- Network access: ProtectMe does not make network calls.
- Credentials/secrets: no credentials required.
- Telemetry/retention: no telemetry; blocked logs remain project-local.
- User confirmations: repeated blocked host attempts can prompt in UI-capable mode.

## 8. Documentation and packaging

- README describes planned behavior, schema, matching rules, and implementation status.
- SECURITY documents the trust model and planned file/network behavior.
- CHANGELOG records repository preparation.
- `package.json` identifies `@senad-d/protectme` and keeps `pi.extensions` pointed at `./src/extension.ts`.
- Distribution plan: npm package and local checkout development with `pi --no-extensions -e .`.

## 9. Validation plan

- Typecheck: `npm run typecheck`
- Tests: `npm run test`
- Package dry-run: `npm run check:pack`
- Full validation: `npm run validate`
- Isolated Pi smoke test: `pi --no-extensions -e .`

## 10. Open questions and assumptions

- Questions: none for preparation.
- Assumptions:
  - Runtime behavior starts in a separate implementation session.
  - `mode: "allow"` allows detected requests without block prompts.
  - The `/protectme` TUI is part of v1 but follows core blocking logic in task order.
- Decisions:
  - Use `mode` and `allowList` exactly.
  - Protect only supported shell-based network requests in v1.
  - Do not evaluate file/content tools for URL text.
