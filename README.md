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

![askdiff demo for the working directory path](https://raw.githubusercontent.com/narghev/askdiff/update-readme/assets/working-tree-demo.gif)
![askdiff demo for natural language descriptors](https://raw.githubusercontent.com/narghev/askdiff/update-readme/assets/nl-descriptors-demo.gif)

## Quickstart

**1. One-time skill install** (project-scoped — installs into `<git-root>/.claude/`):

```bash
cd /path/to/your/project
npx -y askdiff install-skill

# Or, install user-level (available from any project):
npx -y askdiff install-skill --global
```

**2. From a Claude Code session in that project:**

```
/askdiff                                                                # working-tree changes
/askdiff last commit attached to the same session that wrote it         # HEAD~1..HEAD
/askdiff main vs feature/x to a session where we investigated the bug   # main…HEAD (PR-style)
/askdiff David's latest commit where he removed the xmpp integration    # author + content search
/askdiff last commit attached to the session where we discussed auth    # send asks to a different past session
```

That's it. No API key, no config. The browser opens to a syntax-highlighted diff; comments stream back as the model thinks.

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
    <td><a href="#diff-selection">Diff selection</a></td>
    <td>Describe which diff to review in plain English — working tree, last commit, branch comparisons, arbitrary refs.</td>
  </tr>
  <tr>
    <td><a href="#session-selection">Session selection</a></td>
    <td>By default asks flow into the invoking session. Add "in our session about X" or "session &lt;uuid&gt;" to attach to a different past session — the one that originally wrote the code, for example.</td>
  </tr>
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

### Diff selection

Anything after `/askdiff` is a description — Claude figures out the
right `git diff` invocation, writes the result to a temp file, and
points the server at it. Some examples:

| You type | What you'll review |
|---|---|
| `/askdiff` | working-tree changes (uncommitted + untracked) |
| `/askdiff last commit` | `HEAD~1..HEAD` |
| `/askdiff last 3 commits` | `HEAD~3..HEAD` |
| `/askdiff the 5th latest commit` | the single commit at `HEAD~4` |
| `/askdiff main vs feature/x` | `main…HEAD` (three-dot, PR-style) |
| `/askdiff abc123 vs def456` | `abc123..def456` |
| `/askdiff staged` | `git diff --cached` |
| `/askdiff the commit where I added the favicon` | Claude searches commit messages, diff content, or file history to find it |

Defaults when ambiguous:
- "branch X against branch Y" between named refs ⇒ three-dot (PR semantics).
- Two arbitrary commits ⇒ two-dot (literal tree diff).
- "Nth latest commit" ⇒ that single commit's changes.

The TopBar shows what diff you're reviewing as a small label
(e.g. `Working tree`, `HEAD~1..HEAD`, `main…feature/x`).

**Re-invoking refreshes.** Run `/askdiff` again from the same session
and the previous server is killed, the diff is recomputed, and the
existing browser tab auto-reconnects on the same port. For working-tree
diffs, an amber banner appears if any reviewed file has been edited
since the diff was captured, prompting you to re-run `/askdiff`.

### Session selection

By default `/askdiff` attaches to the **invoking** session — the one running
the skill. Asks become real turns in that session's transcript.

If the diff you're reviewing was written (or investigated) in a *different*
past session, describe that session in natural language and asks will flow
there instead. The original "ask in the same session that wrote the code"
promise still holds — it's just that the session that wrote the code might
not be the session you're currently in:

| You type | What attaches |
|---|---|
| `/askdiff last commit` | invoking session (default — same as today) |
| `/askdiff last commit in our session about pricing rules` | searches sessions in this project for "pricing rules" mentions; the dominant match attaches |
| `/askdiff abc123 vs def456 attached to the session that authored it` | Claude builds keyword needles from the diff; matches that to a past session |
| `/askdiff session 322bc90a` | exact UUID prefix; resolves to a specific session |
| `/askdiff in session 322bc90a-714f-41b7-914e-109404e46072` | full UUID |

Search is bounded: only sessions touched in the last 30 days, top 5 candidates
by hit count, and `command grep -Ff` over the JSONL transcripts so it stays
fast and uses zero LLM tokens. If multiple sessions match comparably, askdiff
asks you which to use rather than guessing. If nothing matches, it falls back
to the invoking session.

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

The skill asynchronously hits the npm registry after launching askdiff. If a newer version is available, you'll see a passive notice
*after* the launch with the upgrade command pre-formatted:

```
── A new version of askdiff is available ──
  installed: 0.3.0
  latest:    0.3.1
  to update: npx -y askdiff@latest install-skill --force
             (add --global if you installed user-level)
```

You're free to ignore it — the version you have is still working in
front of you. When you do want to upgrade, run the printed command at
the same scope you installed:

```bash
# project-local install (the default)
npx -y askdiff@latest install-skill --force

# user-level install
npx -y askdiff@latest install-skill --global --force
```

The first subsequent `/askdiff` runs the upgraded CLI. Set
`ASKDIFF_SKIP_UPDATE_CHECK=1` to suppress the network call entirely.

## Skills shipped

`install-skill` writes one file: `<git-root>/.claude/skills/askdiff/SKILL.md`
by default — scoped to the current project. That's the entire surface
area in your CC config for that repo. The command walks up from `cwd`
looking for a `.git` directory and refuses (rather than guessing a path)
if none is found.

```bash
cd /path/to/your/project           # default install scope
npx -y askdiff install-skill       # → <git-root>/.claude/skills/askdiff/SKILL.md
```

To install user-level instead — making `/askdiff` available from any
Claude Code session you start — pass `--global`:

```bash
npx -y askdiff install-skill --global
# → ~/.claude/skills/askdiff/SKILL.md
```

Project skills override same-named user skills, so it's safe to have
both: a global install for general use, plus a project install pinning
this repo to a specific askdiff version.

> **Upgrading from `0.2.x`?** The old version installed user-level by
> default. To preserve that behavior on upgrade, run
> `npx -y askdiff@latest install-skill --global --force`. Otherwise the
> upgrade will install project-locally and leave your old user-level
> skill stale.

### Uninstalling

Uninstall is a single `rm` — there's intentionally no `uninstall-skill`
command. Delete whichever scope you installed:

```bash
# project-local install (the default)
rm -rf <git-root>/.claude/skills/askdiff

# user-level install (--global)
rm -rf ~/.claude/skills/askdiff
```

It's safe to `rm -rf` the whole `skills/askdiff/` directory — askdiff
keeps no other state under `~/.claude` or your project. Anything left
in `/tmp/askdiff*` is session-scoped scratch and clears itself out
within the WS server's idle-shutdown window.

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
Run `npx -y askdiff install-skill` from inside the project (writes
`<git-root>/.claude/skills/askdiff/SKILL.md`), or
`npx -y askdiff install-skill --global` to install user-level
(`~/.claude/skills/askdiff/SKILL.md`). If the file is there but still
missing from the picker, restart Claude Code or run `/reload-plugins`.

## Star History

<a href="https://www.star-history.com/?repos=narghev%2Faskdiff&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=narghev/askdiff&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=narghev/askdiff&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=narghev/askdiff&type=date&legend=top-left" />
 </picture>
</a>

## License

[MIT](./LICENSE) © [narghev](https://github.com/narghev)
