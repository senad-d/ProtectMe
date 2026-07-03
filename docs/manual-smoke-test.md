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
6. Run `!echo https://example.invalid`; it should not be blocked because no supported request CLI is used.
7. Optional agent guard check: ask the agent to run `curl https://example.invalid/protectme-smoke`. ProtectMe should block before the command proceeds. If prompted on repeat, choose **Keep blocked**.
8. Optional user bash guard check: run `!curl https://example.invalid/protectme-user-smoke`. ProtectMe should return a blocked bash result before the command proceeds. Repeat it and choose **Keep blocked** if prompted.
9. Reopen `/protectme` and verify recent blocked hosts/counts refresh if an optional guard check was performed.

## Evidence template

Use this template when recording a real isolated Pi TUI smoke run. Keep screenshots/logs local unless they are safe to share.

```markdown
- Date:
- ProtectMe commit/version:
- Pi version:
- Command run: `pi --no-extensions -e .`
- Project trust state observed:
- `/protectme` opened in TUI mode: yes/no
- Config paths, mode, site counts, and recent blocked hosts displayed: yes/no
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
