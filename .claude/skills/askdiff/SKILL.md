---
name: askdiff
description: Start the askdiff WebSocket server for interactive diff review.
user-invocable: true
allowed-tools: Bash
---

Start the askdiff server in the background, detached from this shell, on the
first free port starting from 7837. Pull the parent Claude Code session ID
and project cwd from `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/sessions/$PPID.json`
and pass them in explicitly.

Run this as a single Bash command so discovered values survive into the launch:

```
port=7837
while lsof -iTCP:$port -sTCP:LISTEN -t >/dev/null 2>&1; do
  port=$((port + 1))
done

session_file="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/sessions/$PPID.json"
session_id=""
project_cwd="$PWD"
if [ -f "$session_file" ]; then
  session_id=$(sed -n 's/.*"sessionId":"\([^"]*\)".*/\1/p' "$session_file")
  manifest_cwd=$(sed -n 's/.*"cwd":"\([^"]*\)".*/\1/p' "$session_file")
  [ -n "$manifest_cwd" ] && project_cwd="$manifest_cwd"
fi

cd "$project_cwd" && PORT=$port ASKDIFF_SESSION_ID="$session_id" ASKDIFF_PROJECT_CWD="$project_cwd" nohup pnpm --filter @askdiff/server exec tsx src/index.ts > /tmp/askdiff.log 2>&1 &
disown
sleep 1.5
head -5 /tmp/askdiff.log
```

Then tell the user:
- the port the server bound to (visible in the `listening on ws://...` line)
- the resolved Claude session ID (from the `claude session:` line)
- the log file: `/tmp/askdiff.log`

If the `claude session:` line says `(none ...)`, the parent CC manifest was
not found at `$session_file`. That usually means the server was launched from
outside a Claude Code session.
