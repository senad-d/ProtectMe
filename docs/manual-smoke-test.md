# Manual isolated Pi smoke test

Use this checklist to verify ProtectMe manually without loading unrelated installed Pi extensions.

## Preconditions

- Dependencies are installed with `npm install`.
- Automated validation passes before manual testing:

```bash
npm run validate
```

## Start isolated Pi

From the repository root, run:

```bash
pi --no-extensions -e .
```

`--no-extensions` prevents globally/user-installed extensions from changing behavior. `-e .` loads only this local ProtectMe extension.

## Smoke checklist

Inside the isolated Pi TUI session:

1. Run `/protectme`.
2. Verify the ProtectMe panel opens in TUI mode.
3. Verify the panel shows global config path, project config path, effective mode, site counts, and recent blocked hosts.
4. Press `q` to close the panel.
5. Ask the agent to run a harmless non-network URL literal command such as `echo https://example.invalid`; it should not be blocked because no supported request CLI is used.
6. Optional guard check: ask the agent to run `curl https://example.invalid/protectme-smoke`. ProtectMe should block before the command proceeds. If prompted on repeat, choose **Keep blocked**.
7. Reopen `/protectme` and verify recent blocked hosts/counts refresh if the optional guard check was performed.

## Cleanup

The optional guard check may create local runtime state under `.pi/agent/`, including `protectme_log.jsonl`. This path is gitignored and excluded from package contents. Delete it if you want a clean working tree:

```bash
rm -rf .pi/agent
```

Do not commit local `.pi/` state or smoke-test logs.
