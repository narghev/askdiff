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

> **Keep Step 1–3 in sync with `.claude/skills/askdiff-dev/SKILL.md`.** The
> diff-resolution flow (interpret → git → temp file → label) must behave
> identically in both skills; only Step 4 (launch) differs. If you change
> the table or the bash blocks below, change them in the dev skill too.

## Step 1 — figure out which diff the user wants

Look at the message that invoked this skill. Anything after `/askdiff` is the
user's diff description (may be empty).

| User said | git command | Suggested label |
|---|---|---|
| `/askdiff` (no args) | working tree — see Step 2 | `Working tree` |
| `/askdiff last commit` | `git diff HEAD~1 HEAD` | `HEAD~1..HEAD` |
| `/askdiff last 3 commits` | `git diff HEAD~3 HEAD` | `HEAD~3..HEAD` |
| `/askdiff the 5th latest commit` | `git diff HEAD~5 HEAD~4` | `HEAD~5..HEAD~4` |
| `/askdiff current branch against feature/test` | `git diff feature/test...HEAD` (three-dot, PR semantics) | `feature/test…HEAD` |
| `/askdiff main vs my branch` | `git diff main...HEAD` | `main…HEAD` |
| `/askdiff abc123 vs def456` | `git diff abc123 def456` | `abc123..def456` |
| `/askdiff staged` | `git diff --cached` | `staged` |

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

## Step 2 — write the diff to a temp file

```bash
diff_file=$(mktemp /tmp/askdiff-diff.XXXXXX)
```

(macOS `mktemp` only substitutes trailing X's, so the template can't have
a `.diff` suffix. The server doesn't care about the extension.)

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

## Step 3 — pick a short label

Use the "Suggested label" column above. For the working-tree case, use
`Working tree`. Keep it under ~40 chars. This becomes `ASKDIFF_DIFF_LABEL`.

## Step 4 — launch

Run as a single Bash command. Substitute `EXTRA_DIFF_FILE` and
`EXTRA_DIFF_LABEL` literally with the values from Step 2/3.

```
set +e

# Pinned version (substituted by the build script when bundling into
# the npm tarball; the in-repo source uses 'latest' so /askdiff in
# this repo always pulls the newest published version).
ASKDIFF_VERSION="latest"

# Filled in by Step 2/3.
EXTRA_DIFF_FILE=""
EXTRA_DIFF_LABEL=""

# 1. Resolve parent Claude Code session + cwd.
session_file="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/sessions/$PPID.json"
session_id=""
project_cwd="$PWD"
if [ -f "$session_file" ]; then
  session_id=$(sed -n 's/.*"sessionId":"\([^"]*\)".*/\1/p' "$session_file")
  manifest_cwd=$(sed -n 's/.*"cwd":"\([^"]*\)".*/\1/p' "$session_file")
  [ -n "$manifest_cwd" ] && project_cwd="$manifest_cwd"
fi

# 2. Update check. Skipped if explicitly disabled, or if pinned to
#    'latest' (in-repo dev case where every run already pulls newest).
#    Network failures are silently ignored — never block on a flaky DNS.
if [ -z "$ASKDIFF_SKIP_UPDATE_CHECK" ] && [ "$ASKDIFF_VERSION" != "latest" ]; then
  latest=$(curl -fsSL --max-time 2 https://registry.npmjs.org/askdiff/latest 2>/dev/null \
    | sed -n 's/.*"version":"\([^"]*\)".*/\1/p' | head -1)
  if [ -n "$latest" ] && [ "$latest" != "$ASKDIFF_VERSION" ]; then
    echo "UPDATE_AVAILABLE: pinned=$ASKDIFF_VERSION latest=$latest"
    exit 0
  fi
fi

# 3. Launch.
cd "$project_cwd" \
  && ASKDIFF_SESSION_ID="$session_id" \
     ASKDIFF_PROJECT_CWD="$project_cwd" \
     ASKDIFF_DIFF_FILE="$EXTRA_DIFF_FILE" \
     ASKDIFF_DIFF_LABEL="$EXTRA_DIFF_LABEL" \
     nohup npx -y askdiff@"$ASKDIFF_VERSION" --no-open > /tmp/askdiff.log 2>&1 &
disown

# Wait for the listening line to land in the log.
for _ in $(seq 1 60); do
  grep -q "listening on" /tmp/askdiff.log 2>/dev/null && break
  sleep 0.25
done

url=$(sed -nE 's|.*listening on (http://localhost:[0-9]+).*|\1|p' /tmp/askdiff.log | head -1)
[ -z "$url" ] && url="http://localhost:7837"

(open "$url" >/dev/null 2>&1 || xdg-open "$url" >/dev/null 2>&1) &

head -10 /tmp/askdiff.log
echo ""
echo "UI: $url"
```

**If the output is the single line `UPDATE_AVAILABLE: pinned=X latest=Y`**
(no listening URL printed, no `UI:` line), an upgrade is available. Use
`AskUserQuestion` to present two options:

- **"Upgrade to Y" (Recommended)**: run
  `npx -y askdiff@latest install-skill --force` — this overwrites the
  user's `~/.claude/skills/askdiff/SKILL.md` with the version bundled
  in `Y` (which has its own pin to `Y`). Then re-invoke `/askdiff` so
  the now-updated skill body picks up the new version.
- **"Keep X this time"**: re-run the bash above with
  `ASKDIFF_SKIP_UPDATE_CHECK=1` prepended. The skill will skip the
  check and launch the pinned version. They'll be re-prompted on the
  next `/askdiff`.

**Otherwise (no UPDATE_AVAILABLE line, or check failed silently)**, the
launch already happened. Tell the user:
- the WS server URL (the `listening on http://...` line)
- the resolved Claude session ID (the `claude session:` line)
- the diff label (always set)
- the log file: `/tmp/askdiff.log`
- the UI URL (last echoed line) — already opened in their default browser

If the `claude session:` line says `(none ...)`, the parent CC manifest
was not found at `$session_file`. That usually means askdiff was
launched from outside a Claude Code session.
