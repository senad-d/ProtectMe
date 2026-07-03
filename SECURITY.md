# Security Policy

## Trust model

ProtectMe is a Pi extension package. Pi extensions run with the full local permissions of the user account that starts Pi. Review extension source before installing it, pin versions in sensitive environments, and install only from trusted sources.

```bash
pi install npm:@senad-d/protectme@<version>
pi install git:github.com/senad-d/pi-protectme@<tag>
```

ProtectMe is a guardrail for supported Pi `bash` tool calls and Pi user bash commands typed with `!` or `!!`, not a sandbox, firewall, proxy, or operating-system network policy. It only evaluates supported request-making commands that Pi sends through the extension event flow.

## Implemented security-sensitive behavior

ProtectMe currently:

- inspects supported LLM `bash` tool calls for request-making commands: `curl`, `wget`, `http`, and `https`,
- inspects supported Pi user bash commands typed with `!` or `!!` for the same request-making commands,
- ignores file/content tools such as `read`, `write`, and `edit` even if their inputs contain URLs,
- blocks detected network requests when effective `mode` is `block` and the host is not in the effective `allowList`,
- allows detected requests without prompts or blocked-attempt logs when effective `mode` is `allow`,
- prompts in UI-capable mode on second and later blocked attempts for the same host,
- fails closed when repeated-attempt confirmation is unavailable,
- exposes `/protectme` in TUI mode for config inspection and edits,
- resets per-session blocked-host attempt counters on session start,
- shows config warnings for invalid/unreadable config and ignored invalid allow-list entries.

ProtectMe does not:

- guard shell commands executed outside Pi's `bash` tool-call or `user_bash` event flow,
- guard unsupported network CLIs beyond `curl`, `wget`, `http`, and `https`,
- execute shell commands itself,
- make network calls itself,
- require API keys, tokens, credentials, or secrets,
- send telemetry,
- log allowed requests,
- start background watchers, timers, sockets, or long-lived processes.

## Config reads and writes

ProtectMe reads configuration from:

- global config: `~/.pi/agent/protectme.json`,
- project config: `.pi/protectme.json`.

ProtectMe can write those files only through explicit user-facing flows:

- repeated blocked-attempt prompt choices,
- `/protectme` TUI editing actions.

Project config writes target `.pi/protectme.json`. Global config writes target `~/.pi/agent/protectme.json`. Writes create parent directories as needed and serialize JSON with two-space indentation. Write failures are shown as errors, and existing config files are not intentionally corrupted or partially rewritten.

Invalid or unreadable config fails closed: ProtectMe uses `mode: "block"` with valid normalized entries only and reports warning metadata.

## Blocked-attempt logs

ProtectMe logs blocked attempts only at:

```text
.pi/agent/protectme_log.jsonl
```

Each JSON line may include:

- timestamp,
- cwd,
- Pi tool name,
- host,
- raw/normalized request target where available,
- attempt count,
- effective mode,
- config source metadata,
- outcome (`blocked`, `prompt_denied`, `prompt_error`, or `prompt_unavailable`),
- command snippet metadata.

Command snippets are bounded, visibly truncated when long, and redact common authorization headers and secret assignment fragments. Logs can still contain sensitive project paths, hostnames, command structure, or non-redacted arguments. Do not commit or share `.pi/agent/protectme_log.jsonl` from sensitive repositories.

Allowed requests are not logged.

## Safe usage guidance

- Keep allow-list entries as narrow as practical.
- Prefer project config for repository-specific hosts.
- Use global config only for hosts trusted across projects.
- Review `/protectme` before switching mode to `allow`.
- Treat `mode: "allow"` as a temporary bypass because it disables ProtectMe blocking.
- Use isolated smoke tests with `pi --no-extensions -e .`.
- Do not commit local `.pi/` state, logs, coverage, generated reports, or package tarballs.

## Reporting vulnerabilities

Please report suspected security vulnerabilities privately by email: <senad.dizdarevic@proton.me>.

For non-sensitive issues, use the repository issue tracker:

<https://github.com/senad-d/pi-protectme/issues>

Do not open public issues for security-sensitive reports that include exploit details, private repository contents, secrets, or credentials.

## Secure development checklist

- Document any new file, shell, network, or credential access added by the extension.
- Keep ProtectMe's scope limited to supported shell-based network request detection unless a new spec approves more.
- Avoid starting background resources in the extension factory.
- Keep package contents minimal with `npm run check:pack`.
- Keep `npm run validate` passing.
- Use isolated smoke tests with `pi --no-extensions -e .`.
