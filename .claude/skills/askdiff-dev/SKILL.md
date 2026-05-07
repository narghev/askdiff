---
name: askdiff-dev
description: Start the askdiff WS server AND a local Vite dev server for in-repo UI development.
user-invocable: true
allowed-tools: Bash
---

Local-development variant of `/askdiff`. Starts the WS server **and** the
browser UI's Vite dev server (with HMR), and exercises the in-repo
TypeScript instead of the published npm package. Vite is configured to
proxy `/ws` to the WS server, so the UI uses the same same-origin
`new WebSocket('ws://host/ws')` URL in dev as in prod. The
`ASKDIFF_DEV_WS_TARGET` env var tells Vite which port to forward to.

Use this when editing `packages/server` or `packages/ui-browser` and you
want changes to reload instantly instead of rebuilding/republishing.

> **Keep Step 1–3 in sync with `.claude/skills/askdiff/SKILL.md`.** The
> diff-resolution flow (interpret → git → temp file → label) must behave
> identically in both skills; only Step 4 (launch) differs. If you change
> the table or the bash blocks below, change them in the user-facing
> `askdiff` skill too.

## Step 1 — figure out which diff the user wants

Look at the message that invoked this skill. Anything after `/askdiff-dev`
is the user's diff description (may be empty).

| User said | git command | Suggested label |
|---|---|---|
| `/askdiff-dev` (no args) | working tree — see Step 2 | `Working tree` |
| `/askdiff-dev last commit` | `git diff HEAD~1 HEAD` | `HEAD~1..HEAD` |
| `/askdiff-dev last 3 commits` | `git diff HEAD~3 HEAD` | `HEAD~3..HEAD` |
| `/askdiff-dev the 5th latest commit` | `git diff HEAD~5 HEAD~4` | `HEAD~5..HEAD~4` |
| `/askdiff-dev current branch against feature/test` | `git diff feature/test...HEAD` (three-dot, PR semantics) | `feature/test…HEAD` |
| `/askdiff-dev main vs my branch` | `git diff main...HEAD` | `main…HEAD` |
| `/askdiff-dev abc123 vs def456` | `git diff abc123 def456` | `abc123..def456` |
| `/askdiff-dev staged` | `git diff --cached` | `staged` |

Defaults when the user is ambiguous:
- "branch X against branch Y" / "X vs Y" between two named refs ⇒ three-dot
  (`git diff X...Y`) — matches how GitHub renders PRs.
- Two arbitrary commits ⇒ two-dot (`git diff A B`).
- "Nth latest commit" ⇒ that single commit's changes
  (`git diff HEAD~N HEAD~(N-1)`).

### When the description is vague

If the description doesn't fit the table — e.g. "the commit where I added
the favicon", "the last commit by my coworker David", "where we ripped out
the old auth code", "the commit that broke CI last week" — pin down a
single commit with the ladder below, then diff `<sha>^..<sha>` (same shape
as the "Nth latest commit" pattern). Try in order until exactly one commit
matches; if several match, pick the most recent and **tell the user which
one you chose**; if none match, stop and ask — do not guess.

1. **Author.** "by <name>", "<name>'s last", "by my coworker":
   ```bash
   git log --author=<pattern> -i -1 --format='%H %an %s'
   ```

2. **Commit message.** "the migration commit", "where I bumped deps":
   ```bash
   git log --grep=<keyword> -i -1 --format='%H %s'
   ```

3. **Diff content.** "where I added/removed/touched <thing>". `-S` matches
   when a string's count changed in any file; `-G` is a regex over the
   diff text:
   ```bash
   git log -S"<distinctive-string>" -1 --format='%H %s'
   git log -G"<regex>" -1 --format='%H %s'
   ```

4. **File history.** When you can identify the file but not the commit
   (e.g. "where the homepage was added" — search the working tree for a
   plausible path first, then ask git):
   ```bash
   git ls-files | grep -i <hint>                                     # find candidate path
   git log --follow -1 --format='%H %s' -- <path>                    # most recent touch
   git log --follow --diff-filter=A -1 --format='%H %s' -- <path>    # commit that introduced it
   ```

Once a SHA is in hand, build the label as `<short-sha>: <one-line gloss>`
(e.g. `d0b332b: add favicon`) and use `git diff <sha>^ <sha>` as the
diff command. If the user's count and description disagree (e.g. "my 3rd
previous commit, where I added a favicon" but the favicon is at HEAD~2),
trust the description over the count and **flag the off-by-one to the
user** so they know what you picked.

**Validate every ref first.** Run `git rev-parse --verify <ref>^{commit}` for
each ref the user named directly. If any fails, stop and tell the user
which ref didn't resolve — do not launch the server. (Refs returned by the
search ladder are already validated by virtue of `git log` finding them.)

## Step 2 — write the diff to a session-stable file

First resolve the parent Claude Code session and project cwd. All `/tmp`
paths the skill writes (diff file, server log, dev-only UI log/pid file)
key off the session UUID so concurrent `/askdiff` runs from different
sessions don't collide:

```bash
session_file="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/sessions/$PPID.json"
session_id=""
project_cwd="$PWD"
if [ -f "$session_file" ]; then
  session_id=$(sed -n 's/.*"sessionId":"\([^"]*\)".*/\1/p' "$session_file")
  manifest_cwd=$(sed -n 's/.*"cwd":"\([^"]*\)".*/\1/p' "$session_file")
  [ -n "$manifest_cwd" ] && project_cwd="$manifest_cwd"
fi
suffix="${session_id:-pid-$$}"
diff_file="/tmp/askdiff-diff.$suffix"
```

No random component on the diff file — re-invoking `/askdiff` from the
same session overwrites in place, which is exactly what a refresh would
do. Different sessions get different suffixes and don't collide. (If
launched outside a CC session, `session_id` is empty and the suffix
falls back to `pid-<bash-pid>` so we still avoid collisions.)

**Working tree (no description).** Untracked files don't appear in
`git diff HEAD`, so we union them in via `--no-index`:

```bash
{
  git -C "$project_cwd" diff HEAD --no-color
  git -C "$project_cwd" ls-files --others --exclude-standard -z \
    | while IFS= read -r -d '' f; do
        git -C "$project_cwd" diff --no-index --no-color -- /dev/null "$f" || true
      done
} > "$diff_file"
```

(In an empty repo with no HEAD, replace `HEAD` with the empty-tree SHA
`4b825dc642cb6eb9a060e54bf8d69288fbee4904`.)

**Description path.** Just run the resolved command:

```bash
git -C "$project_cwd" diff <args> --no-color > "$diff_file"
```

For the description path, if the resulting file is empty, **stop** — tell the
user the requested diff is empty and don't launch. The working-tree path
*can* legitimately be empty (clean tree); launch anyway and the UI will
show "No changes."

## Step 3 — pick a short label

Use the "Suggested label" column above. For the working-tree case, use
`Working tree`. Keep it under ~40 chars. This becomes `ASKDIFF_DIFF_LABEL`.

## Step 4 — launch (in-repo)

Run as a single Bash command so the discovered values survive into the
launch. Substitute `EXTRA_DIFF_FILE` and `EXTRA_DIFF_LABEL` literally with
the values from Step 2/3.

```
set +e

# Filled in by Step 2/3 (session_id, project_cwd, suffix come from Step 2's
# preamble — keep that block above this one in your final invocation).
EXTRA_DIFF_FILE=""
EXTRA_DIFF_LABEL=""

log_file="/tmp/askdiff.$suffix.log"
ui_log="/tmp/askdiff-ui.$suffix.log"
ui_pid_file="/tmp/askdiff-ui.$suffix.pid"
pid_file="/tmp/askdiff.$suffix.pid"

# 1. If a server for this session is already running, kill it and remember
#    its port. Reusing the port matters here especially: Vite's /ws proxy
#    (ASKDIFF_DEV_WS_TARGET) is locked to whatever port we passed when
#    Vite first started. Reusing keeps the browser tab alive — its WS
#    will auto-reconnect (see lib/ws.ts) and load the new diff.
saved_port=""
if [ -f "$pid_file" ]; then
  read -r old_pid saved_port < "$pid_file" 2>/dev/null
  if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
    kill "$old_pid" 2>/dev/null
    if [ -n "$saved_port" ]; then
      for _ in $(seq 1 20); do
        lsof -iTCP:"$saved_port" -sTCP:LISTEN -t >/dev/null 2>&1 || break
        sleep 0.1
      done
    fi
  fi
  rm -f "$pid_file"
fi

# 2. Pick a port: reuse the saved one if present, else pick from 7837 up.
if [ -n "$saved_port" ]; then
  port="$saved_port"
else
  port=7837
  while lsof -iTCP:$port -sTCP:LISTEN -t >/dev/null 2>&1; do
    port=$((port + 1))
  done
fi

# 3. Start the WS server (in-repo via tsx).
cd "$project_cwd" \
  && PORT=$port \
     ASKDIFF_SESSION_ID="$session_id" \
     ASKDIFF_PROJECT_CWD="$project_cwd" \
     ASKDIFF_DIFF_FILE="$EXTRA_DIFF_FILE" \
     ASKDIFF_DIFF_LABEL="$EXTRA_DIFF_LABEL" \
     nohup pnpm --filter @askdiff/server exec tsx src/main.ts > "$log_file" 2>&1 &
new_pid=$!
disown
sleep 1.5
echo "$new_pid $port" > "$pid_file"
head -5 "$log_file"

# 4. Start Vite only if our previous one isn't still alive (per session).
#    Pass ASKDIFF_DEV_WS_TARGET so Vite's proxy points at the chosen port.
ui_running=false
if [ -f "$ui_pid_file" ]; then
  prev_pid=$(cat "$ui_pid_file" 2>/dev/null)
  if [ -n "$prev_pid" ] && kill -0 "$prev_pid" 2>/dev/null; then
    ui_running=true
  fi
fi
if ! $ui_running; then
  : > "$ui_log"
  cd "$project_cwd" && ASKDIFF_DEV_WS_TARGET="ws://localhost:${port}" \
    nohup pnpm --filter @askdiff/ui-browser dev > "$ui_log" 2>&1 &
  echo $! > "$ui_pid_file"
  disown
fi

# 5. Wait for Vite to print its "Local: http://localhost:XXXX/" line.
for _ in $(seq 1 60); do
  grep -q "Local:" "$ui_log" 2>/dev/null && break
  sleep 0.25
done

vite_port=$(sed -E -n 's|.*Local:[^0-9]*([0-9]+)/?.*|\1|p' "$ui_log" | head -1)
[ -z "$vite_port" ] && vite_port=5173

ui_url="http://localhost:${vite_port}/"

# Only auto-open the browser on the *first* launch (no saved_port). On
# refresh-style re-invocations, the user's tab is still open and its WS
# will auto-reconnect; opening another tab would be annoying.
if [ -z "$saved_port" ]; then
  (open "$ui_url" >/dev/null 2>&1 || xdg-open "$ui_url" >/dev/null 2>&1) &
fi

echo ""
if [ -n "$saved_port" ]; then
  echo "Refreshed: same port, new diff. Browser tab will auto-reconnect."
fi
echo "UI: $ui_url"
echo "WS log: $log_file"
echo "UI log: $ui_log"
echo "WS PID: $new_pid (saved to $pid_file)"
```

Then tell the user:
- the WS server port (visible in the `listening on ws://...` line)
- the resolved Claude session ID (from the `claude session:` line)
- the diff label (always set)
- the WS log file (printed as the `WS log:` line — `/tmp/askdiff.<suffix>.log`)
- the Vite log file (printed as the `UI log:` line — `/tmp/askdiff-ui.<suffix>.log`)
- the UI URL (last echoed `UI:` line) — already opened in their default browser

If the `claude session:` line says `(none ...)`, the parent CC manifest was
not found at `$session_file`. That usually means the server was launched
from outside a Claude Code session.

The WS server idle-shuts after 5 min with no connected clients (see
`ASKDIFF_IDLE_SHUTDOWN_MS`); re-invoking `/askdiff-dev` always kills the
previous WS server for this session before starting a new one. Vite
intentionally stays running across re-invocations (HMR is the whole
point) — kill it via Activity Monitor or `pkill -f 'ui-browser.*vite'`
on the rare occasion you want it gone.
