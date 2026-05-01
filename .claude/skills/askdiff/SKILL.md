---
name: askdiff
description: Start the askdiff WebSocket server for interactive diff review.
user-invocable: true
allowed-tools: Bash
---

Start the published `askdiff` CLI in the background, detached. We resolve
the parent Claude Code session in bash and pass it via env vars (rather
than relying on `$PPID` lookup inside the CLI, because `npx` adds an
extra process hop that breaks PPID resolution).

Run this as a single Bash command:

```
set +e

# Resolve parent Claude Code session + cwd from the manifest the CC
# harness writes for each session.
session_file="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/sessions/$PPID.json"
session_id=""
project_cwd="$PWD"
if [ -f "$session_file" ]; then
  session_id=$(sed -n 's/.*"sessionId":"\([^"]*\)".*/\1/p' "$session_file")
  manifest_cwd=$(sed -n 's/.*"cwd":"\([^"]*\)".*/\1/p' "$session_file")
  [ -n "$manifest_cwd" ] && project_cwd="$manifest_cwd"
fi

cd "$project_cwd" \
  && ASKDIFF_SESSION_ID="$session_id" \
     ASKDIFF_PROJECT_CWD="$project_cwd" \
     nohup npx -y askdiff --no-open > /tmp/askdiff.log 2>&1 &
disown

# Wait for the listening line.
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

Then tell the user:
- the WS server port (visible in the `listening on http://...` line)
- the resolved Claude session ID (from the `claude session:` line)
- the log file: `/tmp/askdiff.log`
- the UI URL (last echoed line) — already opened in their default browser

If the `claude session:` line says `(none ...)`, the parent CC manifest
was not found at `$session_file`. That usually means askdiff was
launched from outside a Claude Code session.
