---
user-invocable: true
allowed-tools: Bash
---

Stop everything `/askdiff` and `/askdiff-dev` started: the WebSocket
server, the Vite dev server (when `/askdiff-dev` was used), and any
pnpm/esbuild helpers spawned along the way.

Run this as a single Bash command:

```
set +e

found_any=false

# 1. Vite tracked by the pid file `/askdiff-dev` writes (graceful kill first).
ui_pid_file=/tmp/askdiff-ui.pid
if [ -f "$ui_pid_file" ]; then
  prev_pid=$(cat "$ui_pid_file" 2>/dev/null)
  if [ -n "$prev_pid" ] && kill -0 "$prev_pid" 2>/dev/null; then
    kill "$prev_pid" 2>/dev/null
    found_any=true
    echo "killed Vite dev server (pid $prev_pid)"
  fi
  rm -f "$ui_pid_file"
fi

# 2. Anything whose command line mentions our workspace packages —
#    pnpm filters (`@askdiff/server`, `@askdiff/ui-browser`), the tsx-run
#    server entry, and the Vite binary inside the ui-browser package.
patterns='@askdiff/(server|ui-browser)|packages/(server/src/index\.ts|ui-browser/[^ ]*vite)'
pids=$(pgrep -f "$patterns" 2>/dev/null | sort -u)

if [ -n "$pids" ]; then
  echo "killing: $(echo $pids | tr '\n' ' ')"
  kill $pids 2>/dev/null
  found_any=true
  sleep 0.7
  # Force-kill any survivors.
  for pid in $pids; do
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null
      echo "force-killed pid $pid"
    fi
  done
fi

# 3. Final sweep — anything still listening on a typical askdiff WS port.
for port in $(seq 7837 7847); do
  lsof_pid=$(lsof -iTCP:$port -sTCP:LISTEN -t 2>/dev/null)
  if [ -n "$lsof_pid" ]; then
    # Only kill if it looks like ours — match against our patterns again.
    if ps -p "$lsof_pid" -o command= 2>/dev/null | grep -qE "$patterns"; then
      kill -9 "$lsof_pid" 2>/dev/null
      echo "killed leftover on :$port (pid $lsof_pid)"
      found_any=true
    fi
  fi
done

if ! $found_any; then
  echo "no askdiff processes running"
fi
```

Then tell the user what was killed (or that nothing was running).
