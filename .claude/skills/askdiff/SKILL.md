---
name: askdiff
description: Start the askdiff WebSocket server for interactive diff review.
user-invocable: true
allowed-tools: Bash
---

Compute the unified diff the user wants to review, write it to a temp file,
then launch the published `askdiff` CLI in the background pointing at that
file. The server is intentionally git-illiterate — it only reads the file
you produce and serves it to the browser. Skipping the file is a startup
error.

> **Keep Steps 1–4 in sync with `.claude/skills/askdiff-dev/SKILL.md`.** The
> diff-resolution and session-resolution flow (interpret → git → temp file
> → label → pick session) must behave identically in both skills; only
> Step 5 (launch) differs. If you change any block below — including the
> session-resolution logic in Step 4 — change it in the dev skill too.

## Step 1 — figure out which diff the user wants (and which session)

Look at the message that invoked this skill. Anything after `/askdiff` is
free-form natural language that may carry **two** kinds of information:

1. A **diff description** — what to diff (handled by the table/ladder
   below). This part is what Step 2 turns into a `git diff` command.
2. An optional **session hint** — which Claude session to attach to
   (handled by the *Session hint* subsection at the end of this step,
   then resolved in Step 4).

Either or both may be empty. The diff-description part may be empty
(working tree); the session hint defaults to "the invoking session" when
absent. Treat them independently — first identify and set aside the
session hint, then pass the rest to the diff resolution below.

| `diff_description` | git command | Suggested label |
|---|---|---|
| (empty) | working tree — see Step 2 | `Working tree` |
| `last commit` | `git diff HEAD~1 HEAD` | `HEAD~1..HEAD` |
| `last 3 commits` | `git diff HEAD~3 HEAD` | `HEAD~3..HEAD` |
| `the 5th latest commit` | `git diff HEAD~5 HEAD~4` | `HEAD~5..HEAD~4` |
| `current branch against feature/test` | `git diff feature/test...HEAD` (three-dot, PR semantics) | `feature/test…HEAD` |
| `main vs my branch` | `git diff main...HEAD` | `main…HEAD` |
| `abc123 vs def456` | `git diff abc123 def456` | `abc123..def456` |
| `staged` | `git diff --cached` | `staged` |

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

**Stay within git — never read file contents to disambiguate.** The four
steps above use git only: `git log` (with `--author`, `--grep`, `-S`,
`-G`, `--follow`, `--diff-filter`) and `git ls-files | grep` on
path names. **Do not** `cat`/`head` files, **do not** `grep -r` or `rg`
into working-tree contents, **do not** Read the contents of candidate
files. If the four-step ladder doesn't pin down a unique commit, **stop
and ask the user via `AskUserQuestion`** — surface the candidates the
ladder turned up and let the user pick, or ask for a more specific
description. Reading file contents during search is a token-cost cliff
that requires explicit user consent.

**Validate every ref first.** Run `git rev-parse --verify <ref>^{commit}` for
each ref the user named directly. If any fails, stop and tell the user
which ref didn't resolve — do not launch the server. (Refs returned by the
search ladder are already validated by virtue of `git log` finding them.)

### Session hint (optional)

By default `/askdiff` attaches the WS server to the **invoking** session
(the one running this skill). The user may override that by carrying a
phrase about the target session in their input. Decompose the input into
two parts:

- `diff_description` — what to diff (everything Step 1's table/ladder uses)
- `session_hint` — one of `none`, `explicit-id <uuid-or-prefix>`, or
  `keywords <a, b, c, …>`

**Trigger phrases** for `session_hint` (illustrative — generalize from
these):

- "attached to (the/a) session …"
- "connected to (the/a) session/conversation/chat …"
- "in (the/a/our) session [about / where / that] …"
- "from (the/a) [chat / conversation] [where / about] …"
- "the session in which …", "session that …"
- "session id `<uuid>`", "session `<uuid>`", or a bare UUID-shaped token
  (8+ hex chars, optionally with dashes)

**Examples:**

| User input | `diff_description` | `session_hint` |
|---|---|---|
| `last commit` | `last commit` | none |
| (empty) | (working tree) | none |
| `the staleness commit attached to the session where we discussed mtime checks` | `the staleness commit` | keywords: "mtime checks" |
| `last commit in our session about pricing rules and tax math` | `last commit` | keywords: "pricing rules", "tax math" |
| `session 322bc90a` | (working tree) | explicit-id: `322bc90a` |
| `abc123 vs def456 in session 322bc90a-714f-41b7-914e-109404e46072` | `abc123 vs def456` | explicit-id: full UUID |

**Be conservative.** If parsing is itself ambiguous (e.g. "the foo session"
— is "session" a noun in the diff or a trigger?), treat the whole input
as `diff_description` (no session hint). Don't ask the user to clarify the
parse — just resolve the diff and proceed; the default attachment to the
invoking session is always safe.

The session hint is consumed in Step 4. Steps 2 and 3 use only
`diff_description`.

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

`<args>` is whatever you resolved in Step 1 (e.g. `HEAD~1 HEAD` or
`feature/test...HEAD` or `--cached`).

For the description path, if the resulting file is empty, **stop** — tell the
user the requested diff is empty and don't launch. (`/askdiff HEAD vs HEAD`
is the canonical empty case.) The working-tree path *can* legitimately be
empty (clean tree); launch anyway and the UI will show "No changes."

**Mark the diff as volatile if you took the working-tree path.** Set
`volatile=1` if Step 2 used the working-tree block (the diff can drift as
the user keeps editing); set `volatile=0` for description-based diffs
(immutable git history). Step 5 forwards this to the server as
`ASKDIFF_DIFF_VOLATILE`, which gates the per-file mtime staleness check.

## Step 3 — pick a short label

Use the "Suggested label" column above. For the working-tree case, use
`Working tree`. Keep it under ~40 chars. This becomes `ASKDIFF_DIFF_LABEL`.

## Step 4 — resolve the target session

Compute `attached_session` and `session_source` from `session_hint`
(captured in Step 1). The default is the invoking session — that path
matches today's behavior and skips all the matching logic below.

```bash
attached_session="$session_id"      # default = invoking
session_source="invoking"

sessions_dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects/$(echo "$project_cwd" | tr '/' '-')"
```

### 4a. No hint → invoking session (default)

If `session_hint` is `none`, leave the defaults and skip to Step 5.

### 4b. Explicit ID → resolve

If `session_hint` is `explicit-id <X>`:

```bash
explicit_id="<X>"

if echo "$explicit_id" | grep -qE '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'; then
  # Full UUID: trust it if the file exists.
  if [ -f "$sessions_dir/$explicit_id.jsonl" ]; then
    attached_session="$explicit_id"
    session_source="explicit"
  else
    # → AskUserQuestion: session not found, use current?
    :
  fi
else
  # Short prefix: glob and disambiguate.
  shopt -s nullglob
  matches=( "$sessions_dir/${explicit_id}"*.jsonl )
  shopt -u nullglob
  case ${#matches[@]} in
    1)
      attached_session=$(basename "${matches[0]}" .jsonl)
      session_source="explicit"
      ;;
    0)
      # → AskUserQuestion: no session matches "<prefix>", use current?
      : ;;
    *)
      # → AskUserQuestion: pick one of N candidates (list short-uuid · age)
      : ;;
  esac
fi
```

For the AskUserQuestion branches above:

- **Not found / 0 matches**: options are "Use current session" and "Cancel" (do not launch).
- **Multiple prefix matches**: one option per UUID labelled `<short-uuid> · <age>` (compute age below), plus "Use current session". Set `attached_session` and `session_source="explicit"` from the user's pick.

### 4c. Keywords → grep, decide, possibly ask

If `session_hint` is `keywords <a, b, c, …>`:

```bash
needles_file=$(mktemp)

# 1. The user's session keywords (literal phrases — one per line).
printf '%s\n' "<keyword 1>" "<keyword 2>" >> "$needles_file"

# 2. Changed file paths from the resolved diff (additional signal,
#    catches sessions that Read/Edit/Write'd those files).
command grep -E '^\+\+\+ b/' "$diff_file" | sed -E 's|^\+\+\+ b/||' >> "$needles_file"

# 3. Commit SHAs (only for description-based diffs — Claude knows these
#    from Step 1's resolution). Skip for working-tree diffs.
for sha in "<sha1>" "<sha2>"; do
  [ -n "$sha" ] && printf '%s\n' "$sha" >> "$needles_file"
done

# 4. Branch names (only for the X...Y / X..Y form).
for br in "<branch1>" "<branch2>"; do
  [ -n "$br" ] && printf '%s\n' "$br" >> "$needles_file"
done

# Search recent JSONLs (mtime −30d), filter out the invoking session
# (it always matches its own JSONL because the user just typed the
# keywords into it), return at most 5 rows of "<count> <uuid>" sorted
# by hit count desc.
#
# Three subtle things below — change them at your peril:
#   - `command grep` bypasses any shell function/alias that wraps grep.
#     Claude Code's harness wraps grep as a function that proxies to
#     ugrep with extra flags, and that wrapper breaks `-Ff <patternfile>`.
#   - We pipe `find` directly into `while read`, instead of `for f in
#     $(find ...)`. zsh doesn't word-split unquoted variable expansions
#     on newlines by default; that for-loop iterates exactly ONCE with
#     $f containing every path concatenated.
#   - `count=$(grep -c ...)` then `[ -z "$count" ] && count=0` — do NOT
#     write `count=$(grep -c ... || echo 0)`. grep -c always prints a
#     number (0 on no match) AND exits non-zero when there are no
#     matches, so the `|| echo 0` doubles the output to "0\n0" and
#     breaks the numeric `-gt` comparison.
results=$(
  find "$sessions_dir" -name '*.jsonl' -mtime -30 -type f 2>/dev/null \
  | while read -r f; do
      uuid=$(basename "$f" .jsonl)
      [ "$uuid" = "$session_id" ] && continue
      count=$(command grep -cFf "$needles_file" "$f" 2>/dev/null)
      [ -z "$count" ] && count=0
      [ "$count" -gt 0 ] && echo "$count $uuid"
    done | sort -rn | head -5
)
rm -f "$needles_file"
```

Read `$results` and route:

| Result shape | Action |
|---|---|
| 0 lines | AskUserQuestion: "no session matched `<keywords>`. Use current session?" → "Use current" or "Cancel and refine" |
| 1 line | use that UUID; `attached_session=$uuid`, `session_source="matched"` |
| 2+ lines, top count ≥ 2× second | use top-1; `session_source="matched"` |
| 2–5 lines, comparable counts | AskUserQuestion: list each candidate as `<short-uuid> · <age> · <count> hits`, plus "Use current session" |

For ages (used in AskUserQuestion labels):

```bash
now=$(date +%s)
mtime=$(stat -f %m "$sessions_dir/$uuid.jsonl" 2>/dev/null || stat -c %Y "$sessions_dir/$uuid.jsonl")
age_sec=$(( now - mtime ))
if [ $age_sec -lt 86400 ]; then
  age_str="$((age_sec / 3600))h ago"
else
  age_str="$((age_sec / 86400))d ago"
fi
```

**Don't widen the search automatically.** If results are empty or
unclear, surface that to the user via AskUserQuestion. Re-run with
broader scope (e.g. `mtime -90`) only if the user explicitly says to.

## Step 5 — launch

Run as a single Bash command. Substitute `EXTRA_DIFF_FILE` and
`EXTRA_DIFF_LABEL` literally with the values from Step 2/3.

```
set +e

# Pinned version (substituted by the build script when bundling into
# the npm tarball; the in-repo source uses 'latest' so /askdiff in
# this repo always pulls the newest published version).
ASKDIFF_VERSION="latest"

# Filled in by Steps 2/3/4 (session_id, project_cwd, suffix come from
# Step 2's preamble; attached_session and session_source come from
# Step 4 — keep both blocks above this one in your final invocation).
EXTRA_DIFF_FILE=""
EXTRA_DIFF_LABEL=""

log_file="/tmp/askdiff.$suffix.log"
pid_file="/tmp/askdiff.$suffix.pid"

# 1. If a server for this session is already running, kill it and remember
#    its port so the new server reuses it. Reusing the port keeps the
#    open browser tab's URL valid across the restart — the WS will
#    auto-reconnect (see lib/ws.ts) and load the freshly-written diff.
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

# 2. Launch. Pass --port if we have one to reuse; otherwise the CLI picks 7837+.
#    The update check is intentionally NOT done here — it would block the
#    launch on an npm registry round-trip. We do it after the server is
#    up (step 4 below) and just print a passive notice.
port_arg=""
[ -n "$saved_port" ] && port_arg="--port $saved_port"

cd "$project_cwd" \
  && ASKDIFF_SESSION_ID="$attached_session" \
     ASKDIFF_PROJECT_CWD="$project_cwd" \
     ASKDIFF_DIFF_FILE="$EXTRA_DIFF_FILE" \
     ASKDIFF_DIFF_LABEL="$EXTRA_DIFF_LABEL" \
     ASKDIFF_DIFF_VOLATILE="${volatile:-0}" \
     nohup npx -y askdiff@"$ASKDIFF_VERSION" --no-open $port_arg > "$log_file" 2>&1 &
new_pid=$!
disown

# Wait for the listening line to land in the log. (`command grep`
# bypasses the harness's grep wrapper — see Step 4c for context.)
for _ in $(seq 1 60); do
  command grep -q "listening on" "$log_file" 2>/dev/null && break
  sleep 0.25
done

# 3. Persist <pid> <port> so the next /askdiff invocation in this session
#    can find and replace this server (the file path is session-keyed in
#    Step 2's preamble).
port=$(sed -nE 's|.*listening on http://localhost:([0-9]+).*|\1|p' "$log_file" | head -1)
[ -z "$port" ] && port=7837
echo "$new_pid $port" > "$pid_file"

url="http://localhost:$port/"

# Only auto-open the browser on the *first* launch (no saved_port). On
# refresh-style re-invocations, the user's tab is still open and will
# reconnect automatically; opening another tab would be annoying.
if [ -z "$saved_port" ]; then
  (open "$url" >/dev/null 2>&1 || xdg-open "$url" >/dev/null 2>&1) &
fi

head -10 "$log_file"
echo ""
if [ -n "$saved_port" ]; then
  echo "Refreshed: same port, new diff. Browser tab will auto-reconnect."
fi
echo "UI: $url"
echo "Log: $log_file"
echo "PID: $new_pid (saved to $pid_file)"

# 4. Update check. Runs *after* the server is up and the URL has been
#    printed, so it never blocks launch. Skipped if explicitly disabled,
#    or if pinned to 'latest' (in-repo dev case). Network failures are
#    silently ignored — never block on a flaky DNS. If a newer version
#    exists we print a passive notice with the upgrade command; we do
#    NOT prompt or interrupt — the user already has their UI.
if [ -z "$ASKDIFF_SKIP_UPDATE_CHECK" ] && [ "$ASKDIFF_VERSION" != "latest" ]; then
  latest=$(curl -fsSL --max-time 2 https://registry.npmjs.org/askdiff/latest 2>/dev/null \
    | sed -n 's/.*"version":"\([^"]*\)".*/\1/p' | head -1)
  if [ -n "$latest" ] && [ "$latest" != "$ASKDIFF_VERSION" ]; then
    echo ""
    echo "── A new version of askdiff is available ──"
    echo "  installed: $ASKDIFF_VERSION"
    echo "  latest:    $latest"
    echo "  to update: npx -y askdiff@latest install-skill --force"
    echo "             (add --global if you installed user-level)"
  fi
fi
```

The launch always happens — there's no halt-and-prompt branch anymore.
Tell the user:
- the WS server URL (the `listening on http://...` line)
- the resolved Claude session ID (the `claude session:` line) — and
  if `$session_source` is `explicit` or `matched`, say so explicitly
  (e.g. "attached to matched session 322bc90a (was: invoking)") so the
  user knows their asks are not landing in the current session's
  transcript
- the diff label (always set)
- the log file: `/tmp/askdiff.$suffix.log` (printed as the last `Log:` line)
- the UI URL (last echoed `UI:` line) — opened on first launch; on a
  refresh-style re-invocation (the `Refreshed:` line is present), the
  user's existing tab will reconnect automatically
- **if the output ends with the "A new version of askdiff is available"
  block**, surface that to the user verbatim — the upgrade command is
  already on a copyable line, no `AskUserQuestion` needed. They can run
  it whenever they want; their current `/askdiff` is already working.

If the `claude session:` line says `(none ...)`, the parent CC manifest
was not found at `$session_file`. That usually means askdiff was
launched from outside a Claude Code session.
