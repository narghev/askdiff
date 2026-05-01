---
name: askdiff
description: Start the askdiff WebSocket server for interactive diff review.
user-invocable: true
allowed-tools: Bash
---

Start the published `askdiff` CLI in the background. Before launching,
check whether a newer version is available on npm. If so, halt with
the line `UPDATE_AVAILABLE: pinned=X latest=Y` so we can ask the user
whether to upgrade or proceed on the pinned version.

Run this as a single Bash command:

```
set +e

# Pinned version (substituted by the build script when bundling into
# the npm tarball; the in-repo source uses 'latest' so /askdiff in
# this repo always pulls the newest published version).
ASKDIFF_VERSION="latest"

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
- the log file: `/tmp/askdiff.log`
- the UI URL (last echoed line) — already opened in their default browser

If the `claude session:` line says `(none ...)`, the parent CC manifest
was not found at `$session_file`. That usually means askdiff was
launched from outside a Claude Code session.
