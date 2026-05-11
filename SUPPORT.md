# Support

Before filing an issue, please skim the common problems below — most
askdiff bugs have a known cause.

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

## Filing an issue

If the troubleshooting above doesn't cover your case, open an issue at
[github.com/narghev/askdiff/issues](https://github.com/narghev/askdiff/issues)
with:

- askdiff version (`npx askdiff --version`)
- Claude Code version (`claude --version`)
- Node version (`node --version`) and OS
- The relevant `/tmp/askdiff.<suffix>.log` excerpt (the suffix is your
  CC session UUID — find it via `ls -t /tmp/askdiff.*.log | head -1`)
- What you ran and what you expected

## Contributing

For development setup, architecture, and the `/askdiff-dev` skill, see
[CONTRIBUTING.md](./CONTRIBUTING.md).
