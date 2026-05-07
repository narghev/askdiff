# askdiff

[![npm version](https://img.shields.io/npm/v/askdiff)](https://www.npmjs.com/package/askdiff)
[![CI](https://github.com/narghev/askdiff/actions/workflows/ci.yml/badge.svg)](https://github.com/narghev/askdiff/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

**Treat your AI as a coworker — ask questions about its changes in the same session that wrote the code.**

`/askdiff` from inside any Claude Code session opens a GitHub-style diff
viewer in your browser. Hover a line, click `+`, type a question. The
answer streams back inline — and because each ask resumes the same
Claude Code session that wrote the code, the model already remembers
the file, the conversation, and why it made the change.

![askdiff demo](https://raw.githubusercontent.com/narghev/askdiff/main/assets/output.gif)

## Quickstart

```bash
# 1. One-time skill install
npx -y askdiff install-skill

# 2. From any Claude Code session
/askdiff
```

That's it. No API key, no global install, no config. The browser opens
to a syntax-highlighted diff of your working tree; comments stream
back as the model thinks.

## Why askdiff?

Developers often prompt AIs to write the code, then, if the diff becomes large enough, open draft GitHub PRs in order to review it better.
Then, if there are any questions, take the diff back to the terminal, ask questions about it, and repeat.

**Askdiff** simplifies this process by combining the diff viewer and the Q&A interface into one seamless experience, directly integrated with the very same Claude Code session that wrote the code. It makes you treat the model truly as a coworker who already knows the entire context and the reasoning behind every single line of the diff.

## How it works

Each ask spawns the `claude` CLI with `--resume <your-session-id>`.
So your question becomes a real turn in the running session's transcript:

- **No diff sent to the model.** The resumed session already has the
  full context that wrote the code; the prompt is just your question.
- **No Anthropic API key needed.** askdiff doesn't talk to the API —
  it shells out to the `claude` CLI you've already auth'd via
  subscription or whatever.
- **No process cleanup.** The server self-exits after 5 minutes of
  inactivity — close the browser tab and forget about it.

## Features

<table>
  <tr>
    <td><a href="#inline-comments">Inline comments</a></td>
    <td>Click the <code>+</code> gutter button to comment on any line. Drag to comment on a range.</td>
  </tr>
  <tr>
    <td><a href="#streaming-answers">Streaming answers</a></td>
    <td>Tokens stream in as Claude generates them — same model context that wrote the code.</td>
  </tr>
  <tr>
    <td><a href="#threaded-discussions">Threaded discussions</a></td>
    <td>Multiple asks per line, each its own thread, all anchored to the diff.</td>
  </tr>
</table>

### Inline comments

Hover any line in the diff. A `+` button appears in the gutter.
Click it for a single-line question, or click and drag to range over
multiple lines. The comment widget renders below the selected lines;
type a question and hit `Cmd/Ctrl+Enter` (or click `Send`).

### Streaming answers

Tokens stream in as the model generates them — usually starting within
~1 second, typing speed-of-thought. Click `Stop` mid-stream to abort.
Markdown is rendered live, including syntax-highlighted code blocks
in any of 30+ languages.

### Threaded discussions

Each line can have multiple ask/answer pairs. They render as a
threaded conversation inline with the diff, so you can ask a
follow-up without losing context.

## Configuration

All optional. Set as env vars before running `npx -y askdiff` — or
let the skill resolve them automatically.

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `7837` | Auto-bumps if taken. |
| `ASKDIFF_SESSION_ID` | (resolved from `$PPID`) | Force a specific Claude Code session UUID. |
| `ASKDIFF_PROJECT_CWD` | (parent CC manifest, then `process.cwd()`) | Project directory to diff. |
| `ASKDIFF_MODEL` | (inherits resumed session's model) | Override the Claude model for asks. |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Where Claude Code stores `sessions/`, `projects/`. |

CLI flags also work (`askdiff --port 7838 --no-open --session <uuid>`).
Run `askdiff --help` for the full list.

## Updating

When you next run `/askdiff` and a newer version is on npm, the skill
prints `UPDATE_AVAILABLE: pinned=X latest=Y` and asks whether to
upgrade or proceed. Upgrade is one command:

```bash
npx -y askdiff@latest install-skill --force
```

This rewrites the skill to pin to the new version. The first
subsequent `/askdiff` runs the upgraded CLI.

## Skills shipped

`install-skill` writes one file: `~/.claude/skills/askdiff/SKILL.md`.
That's the entire surface area in your CC config.

In this repo (for contributors) there is one more:

- `/askdiff-dev` — local Vite dev server with HMR + tsx-run WS server.
  Use when editing `packages/server` or `packages/ui-browser`. Re-invoking
  `/askdiff-dev` (or `/askdiff`) from the same session kills the previous
  server, reuses its port, and points at a freshly-written diff — that's
  the refresh path. The WS server idle-shuts after 5 min with no clients.

## Architecture

The npm package (`packages/cli`) is a single esbuild-bundled Node
binary that hosts an HTTP server (serving the prebuilt UI bundle in
`dist/ui/`) and a WebSocket on the same port at `/ws`. The CLI
imports `startServer` from `@askdiff/server`, which spawns
`claude --resume` per ask and forwards `text_delta` events to the
client. The browser UI (`packages/ui-browser`) is React 19 + Vite +
Tailwind v4 + zustand, with `react-diff-view` for rendering and
refractor for syntax highlighting.

## Development

```bash
git clone https://github.com/narghev/askdiff
cd askdiff
pnpm install
pnpm test
pnpm lint
pnpm run build
```

From a Claude Code session in this repo:

```
/askdiff-dev                    # first launch: Vite + WS server with HMR
/askdiff-dev                    # again: kills the WS server, restarts on same port with a fresh diff
/askdiff-dev last commit        # description-driven: HEAD~1..HEAD
```

The WS server idle-shuts after 5 min with no connected clients; Vite is
intentionally persistent (HMR is the whole point). Kill Vite via
Activity Monitor or `pkill -f 'ui-browser.*vite'` on the rare occasion
you want it gone.

To exercise the production-shaped binary locally:

```bash
pnpm run build
node packages/cli/dist/index.js --port 7838
```

## Troubleshooting

**"Claude session: (none — set ASKDIFF_SESSION_ID or use --session)"**
The skill couldn't read the parent CC manifest. You're either running
askdiff from outside a Claude Code session (no `$PPID.json` in
`~/.claude/sessions/`), or `CLAUDE_CONFIG_DIR` points somewhere
else. Pass `--session <uuid>` explicitly to override.

**"Port 7837 is already in use"**
Another askdiff (from a different session) is running, or something
else grabbed the port. Same-session re-invocations don't hit this —
they reuse their session's saved port. Pass `--port 7838` to force a
specific port, or wait 5 min for the idle WS server to self-terminate.

**Browser opens, UI loads, but never connects**
The WS upgrade is failing. Check `/tmp/askdiff.<suffix>.log` (where
`<suffix>` is your CC session UUID) — usually it's an old UI cached
against a new server (reload the browser tab) or a hung
`claude --resume` subprocess (check `ps aux | grep claude`).

**`/askdiff` doesn't appear in Claude Code's skill picker**
Run `npx -y askdiff install-skill` to write
`~/.claude/skills/askdiff/SKILL.md`. If it's there but still missing,
restart Claude Code or run `/reload-plugins`.

## License

[MIT](./LICENSE) © [narghev](https://github.com/narghev)
