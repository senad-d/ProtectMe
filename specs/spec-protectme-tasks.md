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

### 2. Validate the 0.1.6 patch release and fix Sonar findings

- [x] Bump the package and lockfile to 0.1.6, fix active Sonar findings, and verify the release checks.

#### Why
The pending fixes need a matching patch version and fresh validation before release.

#### How
Replace backtracking-prone git-entry parsing with string operations and expose bounded reverse log reads as an async iterator. Add regression tests and run local validation, coverage, and Sonar analysis.

#### Where
- `package.json`
- `package-lock.json`
- `src/config/config-paths.ts`
- `src/logging/blocked-attempt-log.ts`
- `test/config-defaults.test.mjs`
- `test/blocked-attempt-log.test.mjs`
- `CHANGELOG.md`

#### Acceptance criteria
- Package and lockfile versions are 0.1.6, with release notes in the changelog.
- Git-entry parsing handles valid relative paths and malformed entries without regex backtracking.
- Recent-host reads remain bounded, newest-first, and stop once enough unique hosts are found.
- Local validation and coverage tests pass.
- A fresh Sonar analysis passes the quality gate with no active issues.

#### Validation
- `npm run validate`: passed, including 139 tests and package-content checks.
- `npm run test:coverage`: passed and generated `coverage/lcov.info`.
- Sonar analysis for 0.1.6: quality gate passed, 98.0% coverage, no active issues, vulnerabilities, or security hotspots.
