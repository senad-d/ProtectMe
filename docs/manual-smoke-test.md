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
3. Verify the one-box panel shows `CONFIGURATION` above `INFO`, the global config path, project trust path, effective mode, and global/project site counts.
4. Open `Effective mode`, cancel once, then open it again and confirm a mode change; verify the panel stays open and returns to the top of `CONFIGURATION`.
5. Open `Edit allow-list entry`, cancel once, then add a harmless host and confirm; verify counts refresh without closing the panel.
6. Open `Recent blocked hosts`; verify it appears inside the same box, then return to the main panel.
7. Press `q` to close the panel.
8. Ask the agent to run a harmless non-network URL literal command such as `echo https://example.invalid`; it should not be blocked because no supported request CLI is used.
9. Run `!echo https://example.invalid`; it should not be blocked because no supported request CLI is used.
10. Optional agent guard check: ask the agent to run `curl https://example.invalid/protectme-smoke`. ProtectMe should block before the command proceeds. If prompted on repeat, choose **Keep blocked**.
11. Optional user bash guard check: run `!curl https://example.invalid/protectme-user-smoke`. ProtectMe should return a blocked bash result before the command proceeds. Repeat it and choose **Keep blocked** if prompted.
12. Reopen `/protectme` and verify recent blocked hosts/counts refresh if an optional guard check was performed.

## Evidence template

Use this template when recording a real isolated Pi TUI smoke run. Keep screenshots/logs local unless they are safe to share.

```markdown
- Date:
- ProtectMe commit/version:
- Pi version:
- Command run: `pi --no-extensions -e .`
- Project trust state observed:
- `/protectme` opened in TUI mode: yes/no
- One-box configuration/info layout displayed: yes/no
- In-panel mode confirmation and allow-list confirmation stayed open after changes: yes/no
- In-panel recent blocked hosts view displayed: yes/no
- Agent non-network URL literal was not blocked: yes/no/not run
- User `!echo https://example.invalid` was not blocked: yes/no/not run
- Agent `curl https://example.invalid/protectme-smoke` was blocked before execution: yes/no/not run
- User `!curl https://example.invalid/protectme-user-smoke` was blocked before execution: yes/no/not run
- Repeated-attempt prompt result, if run:
- Cleanup performed:
- Blockers or unexpected behavior:
```

## Cleanup

The optional guard check may create local runtime state under `.pi/agent/`, including `protectme_log.jsonl`. This path is gitignored and excluded from package contents. Delete it if you want a clean working tree:

```bash
rm -rf .pi/agent
```

Do not commit local `.pi/` state or smoke-test logs.
