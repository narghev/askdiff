# Contributing to askdiff

Thanks for poking at askdiff. This doc covers the dev loop, repo layout,
and the in-repo `/askdiff-dev` skill you'll use to test changes.

## Setup

```bash
git clone https://github.com/narghev/askdiff
cd askdiff
pnpm install
pnpm test
pnpm lint
pnpm run build
```

Node 24+ (current active LTS) and pnpm are the only requirements. There is
no Anthropic API key to set — askdiff shells out to the `claude` CLI.

## Architecture

The npm package (`packages/cli`) is a single esbuild-bundled Node binary
that hosts an HTTP server (serving the prebuilt UI bundle in `dist/ui/`)
and a WebSocket on the same port at `/ws`. The CLI imports `startServer`
from `@askdiff/server`, which spawns `claude --resume` per ask and
forwards `text_delta` events to the client. The browser UI
(`packages/ui-browser`) is React 19 + Vite + Tailwind v4 + zustand, with
`react-diff-view` for rendering and refractor for syntax highlighting.

`SPEC.md` has the full wire protocol, repository layout, and design
rationale. Read it before making changes that touch the protocol or the
launch flow.

## Dev loop

From a Claude Code session in this repo:

```
/askdiff-dev                    # first launch: Vite + WS server with HMR
/askdiff-dev                    # again: kills the WS server, restarts on same port with a fresh diff
/askdiff-dev last commit        # description-driven: HEAD~1..HEAD
```

`/askdiff-dev` runs the in-repo TypeScript via `tsx` and pairs the WS
server with a local Vite dev server, so UI changes hot-reload. Use it
(not `/askdiff`) to test changes to the server, the CLI, or the
natural-language flow — `/askdiff` always pulls `npx -y askdiff@latest`,
so unpublished work won't run there.

The WS server idle-shuts after 5 min with no connected clients; Vite is
intentionally persistent (HMR is the whole point). Kill Vite via
Activity Monitor or `pkill -f 'ui-browser.*vite'` on the rare occasion
you want it gone.

To exercise the production-shaped binary locally:

```bash
pnpm run build
node packages/cli/dist/index.js --port 7838
```

## Tests and lint

```bash
pnpm test                                              # jest, all packages
pnpm test:watch
pnpm lint                                              # eslint, all packages
pnpm --filter @askdiff/protocol  exec tsc --noEmit
pnpm --filter @askdiff/server    exec tsc --noEmit
pnpm --filter @askdiff/ui-browser exec tsc --noEmit
pnpm --filter @askdiff/ui-browser build                # production build sanity check
```

Tests are co-located as `*.test.ts`. `@askdiff/ui-browser` deliberately
has no tests yet — the surface is too new and visual to lock in. Add
tests once the UX is stable; React Testing Library is the natural fit.

## Coding conventions

- Strict TypeScript — no `any`, no `ts-ignore`, no non-null assertions in hot paths.
- Named exports only (no default exports except entry points).
- Module-level functions in `util/` are arrow functions for consistency.
- Errors at the WS boundary are surfaced as `error` messages, never thrown across the socket.
- `zod.safeParse` on every incoming message; never trust raw input.
- Comments explain *why* — only when the why isn't obvious from the code or the SPEC.

See `CLAUDE.md` for the full set of conventions and the "do not" list
(e.g. don't reintroduce the Anthropic SDK, don't inject the diff into
the prompt, don't run git from the server).

## Pull requests

- Match existing style; run `pnpm lint` and `pnpm test` before pushing.
- Keep `.claude/skills/askdiff/SKILL.md` and `.claude/skills/askdiff-dev/SKILL.md`
  in sync on Steps 1–4 prose, table, and routing — only the launch
  command differs.
- If you change the wire protocol, update `SPEC.md` in the same PR.
