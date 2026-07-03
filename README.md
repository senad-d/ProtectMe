# ProtectMe

ProtectMe is a Pi extension that guards Pi agent network and website access by checking supported shell-network requests against global and project allow lists.

## What ProtectMe guards

ProtectMe inspects `bash` tool calls for supported request-making CLIs:

- `curl`
- `wget`
- `http`
- `https`

It intentionally ignores raw URL text when no supported request CLI is present, and it does not parse `read`, `write`, `edit`, or other file/content tool inputs just because they contain URLs.

ProtectMe also inspects approved non-network wrappers such as `sudo`, `env`, `time`, `timeout`, and `nice` when they launch a supported request CLI. URL-bearing proxy/resolver options are guarded as additional destinations. Static option sources that can hide network destinations, such as `curl --config` or `wget --input-file`, fail closed because ProtectMe cannot inspect those files safely before execution.

ProtectMe itself does not make network calls, does not require credentials, and does not send telemetry.

## Installation

Install the extension with Pi from npm or GitHub:

```bash
pi install npm:@senad-d/protectme@<version>
pi install git:github.com/senad-d/pi-protectme@<tag>
```

For local development in this repository:

```bash
npm install
pi --no-extensions -e .
```

Use `--no-extensions -e .` for isolated smoke testing so unrelated installed extensions cannot affect behavior.

## Configuration

ProtectMe reads two JSON config files:

| Scope | Path |
| --- | --- |
| Global | `~/.pi/agent/protectme.json` |
| Project | `.pi/protectme.json` |

Project config is honored only when Pi reports the current project as trusted. In untrusted projects, ProtectMe does not read `.pi/protectme.json` and reports the project config as ignored.

Schema:

```json
{
  "mode": "block",
  "allowList": ["example.com", "api.example2.com"]
}
```

Fields:

- `mode`: optional, either `"block"` or `"allow"`.
- `allowList`: optional array of host entries.

Mode behavior:

- `"block"`: ProtectMe blocks detected network requests unless the destination host matches the effective `allowList`.
- `"allow"`: ProtectMe allows detected requests without prompts or blocked-attempt logs.

Missing config defaults to:

```json
{
  "mode": "block",
  "allowList": []
}
```

### Merge behavior

- Global config loads first.
- Trusted project config appends additional `allowList` entries.
- Trusted project `mode` overrides global `mode` when present.
- Untrusted project config is ignored without reading project-local contents.
- Otherwise global `mode` applies.
- Otherwise mode defaults to `"block"`.
- Entries are normalized and deduplicated in the effective config.
- If any loaded global or trusted-project config is invalid or unreadable, the entire effective config fails closed with `mode: "block"` and an empty `allowList`.
- Missing config and ignored untrusted-project config do not force fail-closed behavior.

## Host matching rules

Allow-list entries are normalized by removing schemes, paths, query strings, fragments, ports, trailing dots, and case differences.

Examples:

- `example.com` allows `example.com`, `example.com/login`, `api.example.com`, and deeper child subdomains.
- `api.example2.com` allows itself and child subdomains, but not parent domain `example2.com`.
- Public suffix entries such as `com` or `co.uk` are ignored and reported as config warnings.
- Single-label non-localhost entries such as `internal-service` match only that exact host, not `api.internal-service`.
- `localhost`, IPv4, and IPv6 entries match exactly.
- Invalid entries are ignored and reported as config warnings.

## Blocking and prompts

When effective mode is `"block"`:

1. The first detected request to a disallowed host is blocked. The Pi session is not aborted; ProtectMe returns a block reason and sends concise guidance not to retry blindly.
2. The second and later blocked attempts for the same host prompt in UI-capable mode with these choices:
   - allow once,
   - add to project config and allow this call,
   - add to global config and allow this call,
   - keep blocked.
3. If UI confirmation is unavailable, repeated attempts fail closed.

When ProtectMe writes config from a prompt, it shows a clean editable suggested host entry before saving. Prompt and `/protectme` edits serialize read-modify-write updates per config file so concurrent changes preserve existing mode and allow-list data.

## `/protectme` TUI panel

Run:

```text
/protectme
```

The command opens only in Pi TUI mode and warns otherwise.

The panel displays:

- global config path,
- project config path,
- effective mode,
- global/project/effective site counts,
- recent blocked hosts.

It also provides TUI actions to:

- choose project or global write target,
- toggle mode between `block` and `allow`,
- add a cleaned/editable allow-list entry,
- remove entries from project or global config.

Counts and effective config refresh after writes. Write failures are shown as errors without corrupting existing config files, and concurrent panel/prompt edits to the same config file are serialized.

## Blocked-attempt log

ProtectMe logs blocked attempts only at:

```text
.pi/agent/protectme_log.jsonl
```

Each line is JSON and includes bounded metadata such as timestamp, cwd, tool name, host, attempt count, mode, config source metadata, outcome, redacted request targets, and a redacted/truncated command snippet. URL credentials, sensitive query values, cookies, authorization headers, API keys, and common auth flags are redacted before persistence. Allowed requests are not logged.

The log is project-local and append-only. ProtectMe does not compact, upload, or delete it automatically. `/protectme` reads only a bounded tail window when showing recent blocked hosts, so large historical logs do not need to be loaded into memory. Delete or truncate `.pi/agent/protectme_log.jsonl` when you no longer need local blocked-attempt history; ProtectMe recreates it on the next blocked attempt.

## Troubleshooting

- Unexpected block: run `/protectme`, inspect the effective mode and counts, then add the intended host to project or global config.
- Config warning: fix invalid JSON/schema, unreadable files, or ignored invalid allow-list entries; while any loaded source is invalid or unreadable, ProtectMe uses `block` mode with an empty effective allow-list.
- Prompt unavailable: use Pi TUI mode for confirmation prompts, or edit config manually.
- Need to bypass protection temporarily: set project config to `{ "mode": "allow" }`.
- Want a clean smoke test: run `pi --no-extensions -e .` from this repository.

## Development validation

```bash
npm run typecheck
npm run test
npm run test:coverage
npm run check:pack
npm run validate
```

Package dry-run checks ensure generated artifacts, `.pi/`, logs, specs, and local state are not published.

For a manual isolated Pi smoke test, run:

```bash
pi --no-extensions -e .
```

Follow [`docs/manual-smoke-test.md`](docs/manual-smoke-test.md) for the full safe smoke checklist.

## Specs

Implementation history and remaining backlog live in:

- [`specs/spec-protectme-architecture.md`](specs/spec-protectme-architecture.md)
- [`specs/spec-protectme-guidelines.md`](specs/spec-protectme-guidelines.md)
- [`specs/spec-protectme-tasks.md`](specs/spec-protectme-tasks.md)

## Security

See [`SECURITY.md`](SECURITY.md).

## License

MIT
