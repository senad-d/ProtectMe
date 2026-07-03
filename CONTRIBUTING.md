# Contributing

ProtectMe is a TypeScript Pi extension package. This repository is prepared for implementation; future feature work should follow the approved specs under `specs/`.

## Development setup

ProtectMe requires Node.js `>=22.19.0`.

```bash
npm install
npm run validate
```

Useful commands:

```bash
npm run typecheck
npm run test
npm run check:pack
pi --no-extensions -e .
```

## Implementation workflow

- Read `docs/PROJECT_DEFINITION_BRIEF.md` first.
- Read all three ProtectMe specs under `specs/`.
- Implement `specs/spec-protectme-tasks.md` one checkbox at a time.
- Keep every checkbox unchecked until its acceptance criteria and validation evidence are complete.
- Update tests and docs in the same task as behavior changes.
- Stop and ask when a spec decision is ambiguous.

## Pull requests

- Keep changes focused and explain user-visible behavior.
- Update README/docs when commands, settings, packaging, validation, or security behavior changes.
- Run `npm run validate` before requesting review, or explain why it could not be run.
- Do not commit secrets, local `.pi/` state, generated package tarballs, `node_modules/`, coverage, generated reports, or machine-local paths.

## Security expectations

Pi extensions run with the user's local permissions. Treat changes that inspect shell commands, block tool calls, read/write config files, or log blocked attempts as security-sensitive and document the behavior.
