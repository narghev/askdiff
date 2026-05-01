---
name: askdiff-dev
description: Start the askdiff WS server AND a local Vite dev server for in-repo UI development.
user-invocable: true
allowed-tools: Bash
---

Local-development variant of `/askdiff`. Starts the WS server **and**
the browser UI's Vite dev server (with HMR). Vite is configured to
proxy `/ws` to the WS server, so the UI uses the same same-origin
`new WebSocket('ws://host/ws')` URL in dev as in prod. The
`ASKDIFF_DEV_WS_TARGET` env var tells Vite which port to forward to.

Use this when editing `packages/ui-browser` and you want changes to
reload instantly instead of rebuilding the npm package.

Run this as a single Bash command so discovered values survive into the
launch:

```
set +e

# 1. Free port for the WS server (default 7837, bump until free).
port=7837
while lsof -iTCP:$port -sTCP:LISTEN -t >/dev/null 2>&1; do
  port=$((port + 1))
done

# 2. Resolve parent Claude Code session + cwd.
session_file="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/sessions/$PPID.json"
session_id=""
project_cwd="$PWD"
if [ -f "$session_file" ]; then
  session_id=$(sed -n 's/.*"sessionId":"\([^"]*\)".*/\1/p' "$session_file")
  manifest_cwd=$(sed -n 's/.*"cwd":"\([^"]*\)".*/\1/p' "$session_file")
  [ -n "$manifest_cwd" ] && project_cwd="$manifest_cwd"
fi

# 3. Start the WS server.
cd "$project_cwd" && PORT=$port ASKDIFF_SESSION_ID="$session_id" ASKDIFF_PROJECT_CWD="$project_cwd" nohup pnpm --filter @askdiff/server exec tsx src/main.ts > /tmp/askdiff.log 2>&1 &
disown
sleep 1.5
head -5 /tmp/askdiff.log

# 4. Start Vite only if our previous one isn't still alive.
#    Pass ASKDIFF_DEV_WS_TARGET so Vite's proxy points at the chosen port.
ui_log=/tmp/askdiff-ui.log
ui_pid_file=/tmp/askdiff-ui.pid
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

(open "$ui_url" >/dev/null 2>&1 || xdg-open "$ui_url" >/dev/null 2>&1) &

echo ""
echo "UI: $ui_url"
```

Then tell the user:
- the WS server port (visible in the `listening on ws://...` line)
- the resolved Claude session ID (from the `claude session:` line)
- the WS log file: `/tmp/askdiff.log`
- the Vite log file: `/tmp/askdiff-ui.log`
- the UI URL (last echoed line) — already opened in their default browser

If the `claude session:` line says `(none ...)`, the parent CC manifest was
not found at `$session_file`. That usually means the server was launched
from outside a Claude Code session.

`/askdiff-stop` cleans up both processes.
