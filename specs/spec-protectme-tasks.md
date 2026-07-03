# ProtectMe implementation tasks

This retained backlog records the original implementation sequence for ProtectMe. Completed items remain checked so the project metadata test can verify that the preparation-era task history is still available.

### 1. Replace preparation placeholder with extension module registrations

- [x] Register the ProtectMe extension entry point and compose the config, policy, logging, event, and UI modules from `src/extension.ts`.

#### Why
The package needed to move from a preparation placeholder to a real Pi extension composition root.

#### How
Keep feature logic in dedicated modules and call their registration functions from the extension entry point.

#### Where
- `src/extension.ts`
- `src/config/index.ts`
- `src/events/network-guard.ts`
- `src/ui/protectme-panel.ts`

#### Acceptance criteria
- The package declares `./src/extension.ts` as its Pi extension entry file.
- Runtime feature modules remain discoverable through registration functions.
- The extension entry point stays small and does not contain parsing, matching, logging, or TUI logic.
