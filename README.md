# Taskent

[![npm](https://img.shields.io/npm/v/taskent)](https://www.npmjs.com/package/taskent)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

One dashboard for all your AI coding agents. This is the **collector**: it captures task-status
changes from Claude Code, ZCode and other MCP-speaking harnesses and reports them to your
[Taskent](https://taskent.io) server — reliably, and without ever getting in the agent's way.

[中文说明](README.zh-CN.md) · [Website](https://taskent.io) · [Dashboard](https://app.taskent.io)

## How it works

- **Hooks capture (main channel)** — listens to your agent's task/session events. No agent
  cooperation required; task changes are picked up as they happen.
- **MCP server** (stdio) — exposes `task_upsert` / `task_list` tools so agents can report
  progress explicitly and pick unfinished tasks back up.
- **Local queue first** — hook invocations append to an on-disk queue and return immediately
  (milliseconds, works offline). A background forwarder ships batches to your server with
  exponential backoff (1m/5m/30m capped) and at-least-once + idempotent upserts.

## Requirements

- Node.js ≥ 18
- A taskent account: sign in with **GitHub or Google** at [app.taskent.io](https://app.taskent.io),
  then create a **collector token** under *Settings → Collector tokens* (one per machine, revocable)

## Quickstart

```bash
npm install -g taskent   # hooks need the local binary (millisecond startup, offline-safe)
taskent init             # interactive setup; prints ready-to-paste MCP + hooks snippets
taskent doctor           # health check: config / version / queue / server connectivity
```

Try without installing: `npx taskent init`.

`taskent init` asks for your collector token, a machine name and your primary harness
(`zcode` / `claude-code` / `other`), then prints harness-specific snippets to paste into
your agent's config. The blocks below are what it prints (shown for reference):

### ZCode

Both blocks go into `~/.zcode/cli/config.json` — merge them with your existing keys.
Two ZCode specifics: config-file hooks must set `"enabled": true` and nest events under
`events`, and there is no `Notification` event (waiting-for-input is not captured on ZCode).
Open a new ZCode session to activate.

MCP registration (`mcp` key):

```json
{ "mcp": { "servers": { "taskent": { "command": "taskent", "args": ["mcp"], "env": { "TASKENT_HARNESS": "zcode" } } } } }
```

Task capture (`hooks` key):

```json
{
  "hooks": {
    "enabled": true,
    "events": {
      "PostToolUse": [
        { "matcher": "Task|TodoWrite", "hooks": [ { "type": "command", "command": "taskent hook --harness zcode --event PostToolUse" } ] }
      ],
      "Stop": [
        { "hooks": [ { "type": "command", "command": "taskent hook --harness zcode --event Stop" } ] }
      ]
    }
  }
}
```

### Claude Code

MCP registration (`.mcp.json` or `claude mcp add`):

```json
{ "mcpServers": { "taskent": { "command": "taskent", "args": ["mcp"], "env": { "TASKENT_HARNESS": "claude-code" } } } }
```

Hooks (`~/.claude/settings.json`):

```json
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "Task|TodoWrite", "hooks": [ { "type": "command", "command": "taskent hook --harness claude-code --event PostToolUse" } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command", "command": "taskent hook --harness claude-code --event Stop" } ] }
    ],
    "Notification": [
      { "hooks": [ { "type": "command", "command": "taskent hook --harness claude-code --event Notification" } ] }
    ]
  }
}
```

### Other harnesses

The MCP server is standard stdio MCP — register `taskent mcp` wherever your harness
reads MCP servers. Hooks are the auto-capture channel; if your harness has
Claude-Code-compatible hook events (stdin JSON with `tool_name` / `tool_input` /
`session_id`), the same hook commands work as-is.

Now open [app.taskent.io](https://app.taskent.io) with the same account, run a task with your agent,
and watch it appear on the dashboard within ~30 seconds.

## End-to-end encryption (opt-in)

```bash
taskent encrypt           # set a passphrase; keys are derived locally (PBKDF2-SHA256, 600k)
```

Your passphrase never leaves the machine. Task titles, progress and project names are sealed
with AES-256-GCM before upload; the server only sees ciphertext and blind IDs. Enter the same
passphrase in the dashboard's E2EE card to decrypt. Encrypted projects show up as `P1`, `P2`, …
(editable aliases) — status, grouping and push triggers keep working. Lost passphrase = data is
unrecoverable.

## Commands

| Command | Purpose |
|---|---|
| `taskent init` | Interactive setup; prints MCP/hooks registration snippets |
| `taskent mcp` | Start the MCP server (stdio, for harness registration) |
| `taskent hook --harness H --event E` | Hooks entry point (reads JSON payload from stdin) |
| `taskent encrypt [--passphrase P]` | Enable/reset end-to-end encryption |
| `taskent flush` | Manually drain the local queue |
| `taskent upgrade` | Self-update (`npm i -g taskent@latest`) |
| `taskent doctor [--force]` | Health check |

## Privacy

Only task metadata is reported (title, status, project name, agent/machine name, timestamps) —
never task bodies, code, prompts or diffs. With E2EE on, even the metadata above is ciphertext
to the server. Config, queue and keys live under `~/.taskent/`.

## Upgrades & compatibility

- `taskent upgrade` self-updates in one command.
- Version checks happen at most once a day (3s timeout, prompt-only); the hook path never
  touches the network for version checks.
- Backward-compat promise: old clients can always report — payloads carry a version field,
  the server ignores unknown fields, and hooks always exit 0 so your coding session is never
  disturbed.

## Status

v0.2.0 — early access. Multi-user accounts (GitHub/Google sign-in, per-user data isolation, per-machine collector tokens) landed in 0.2.0. The collector is functional (queue, hooks, MCP, E2EE, doctor);
onboarding is currently manual (paste snippets). Automatic harness configuration is next.

## License

[MIT](LICENSE)
