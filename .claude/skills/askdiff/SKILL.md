---
name: askdiff
description: Start the askdiff WebSocket server for interactive diff review.
user-invocable: true
allowed-tools: Bash
---

Start the askdiff server in the background, detached. Pull the parent
Claude Code session ID and project cwd from
`${CLAUDE_CONFIG_DIR:-$HOME/.claude}/sessions/$PPID.json` and pass them
in explicitly. Open the hosted browser UI at the URL given by
`$ASKDIFF_UI_URL` (default `https://askdiff.pages.dev`), wiring the
local WS server URL in via the `?server=` query parameter.

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

# 3. Start the WS server (idempotent: each invocation gets its own port).
cd "$project_cwd" && PORT=$port ASKDIFF_SESSION_ID="$session_id" ASKDIFF_PROJECT_CWD="$project_cwd" nohup pnpm --filter @askdiff/server exec tsx src/main.ts > /tmp/askdiff.log 2>&1 &
disown
sleep 1.5
head -5 /tmp/askdiff.log

# 4. Build the UI URL and open the default browser.
ui_base="${ASKDIFF_UI_URL:-https://askdiff.pages.dev}"
ui_url="${ui_base}/?server=ws%3A%2F%2Flocalhost%3A${port}"

(open "$ui_url" >/dev/null 2>&1 || xdg-open "$ui_url" >/dev/null 2>&1) &

echo ""
echo "UI: $ui_url"
```

Then tell the user:
- the WS server port (visible in the `listening on ws://...` line)
- the resolved Claude session ID (from the `claude session:` line)
- the WS log file: `/tmp/askdiff.log`
- the UI URL (last echoed line) — already opened in their default browser

If the `claude session:` line says `(none ...)`, the parent CC manifest was
not found at `$session_file`. That usually means the server was launched
from outside a Claude Code session.

To point at a local UI dev server instead of the hosted one:
`ASKDIFF_UI_URL=http://localhost:5173 /askdiff` (start Vite separately
with `pnpm --filter @askdiff/ui-browser dev`).
