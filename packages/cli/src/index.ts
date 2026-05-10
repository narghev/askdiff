import { type Server as HttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import open from "open";
import { resolveSession } from "./resolve-session.js";

// `@askdiff/server`, `@askdiff/protocol`, and `./server-bundle.js` are
// loaded lazily inside `runServer` (the only place that needs them).
// Static imports would force them onto every code path, including
// `resolve-session`, and the protocol package is CJS — statically
// importing it from this ESM module fails under `tsx` (used by the dev
// skill's resolve-session call). Dynamic imports of static-string
// specifiers are bundled by esbuild for the published CLI, so this
// costs nothing at production runtime.

const __dirname = dirname(fileURLToPath(import.meta.url));

const PROJECT_NAME = "askdiff";
const DEFAULT_PORT = 7837;

interface RunOptions {
  port?: number;
  host: string;
  open: boolean;
  session?: string;
  cwd?: string;
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name(PROJECT_NAME)
    .description(
      "Treat your AI as a coworker — ask questions about its changes in any diff viewer.",
    )
    .option("-p, --port <n>", "preferred port (auto-bumps if taken)", (v) =>
      Number.parseInt(v, 10),
    )
    .option("-h, --host <addr>", "bind address", "127.0.0.1")
    .option("--no-open", "do not auto-open the browser")
    .option(
      "-s, --session <uuid>",
      "Claude Code session UUID to resume (defaults to env / parent session)",
    )
    .option(
      "-c, --cwd <path>",
      "project directory (defaults to env / current dir)",
    )
    .action(async (opts: RunOptions) => {
      await runServer(opts);
    });

  program
    .command("install-skill")
    .description(
      "Install the askdiff Claude Code skill into the current project (default: <git-root>/.claude/skills/askdiff/). Pass --global to install user-level instead.",
    )
    .option(
      "--force",
      "overwrite an existing skill file without prompting",
      false,
    )
    .option(
      "--global",
      "install into the user-level config dir (~/.claude/skills/askdiff/) instead of the current project",
      false,
    )
    .action(async (opts: { force: boolean; global: boolean }) => {
      await installSkill(opts.force, opts.global);
    });

  const collect = (v: string, prev: string[]) => [...prev, v];
  const parseIntOpt = (v: string) => Number.parseInt(v, 10);

  program
    .command("resolve-session")
    .description(
      "Search Claude Code session JSONLs in the current project for keyword/path/SHA/branch needles. Prints `{candidates:[{uuid,count,age}]}` JSON to stdout.",
    )
    // Note: `-c, --cwd` is intentionally NOT declared here. Commander v14
    // routes it to the parent program (which already declares `-c, --cwd`)
    // regardless of where it appears on the command line, so we read it
    // from `program.opts()` and fall back to process.cwd().
    .option("--invoking <uuid>", "session UUID to exclude (the invoking one)", "")
    .option("--diff-file <path>", "extract `+++ b/<path>` lines from this diff as additional needles")
    .option("--keyword <text>", "user keyword (repeatable)", collect, [] as string[])
    .option("--sha <sha>", "commit SHA (repeatable)", collect, [] as string[])
    .option("--branch <name>", "branch name (repeatable)", collect, [] as string[])
    .option("--max-age-days <n>", "mtime cutoff in days", parseIntOpt, 30)
    .option("--top <n>", "max candidates", parseIntOpt, 5)
    .action(async (opts: ResolveSessionCliOptions) => {
      const parentCwd = program.opts<{ cwd?: string }>().cwd;
      const result = await resolveSession({
        cwd: parentCwd ?? process.cwd(),
        invoking: opts.invoking,
        ...(opts.diffFile !== undefined ? { diffFile: opts.diffFile } : {}),
        keywords: opts.keyword,
        shas: opts.sha,
        branches: opts.branch,
        maxAgeDays: opts.maxAgeDays,
        top: opts.top,
      });
      console.log(JSON.stringify(result));
    });

  await program.parseAsync(process.argv);
}

interface ResolveSessionCliOptions {
  invoking: string;
  diffFile?: string;
  keyword: string[];
  sha: string[];
  branch: string[];
  maxAgeDays: number;
  top: number;
}

async function runServer(opts: RunOptions): Promise<void> {
  // Lazy-load: see top-of-file note. Keeps `resolve-session` off these
  // imports so the dev-skill `tsx` invocation works.
  const [{ startServer, WS_PATH }, { PROTOCOL_VERSION }, { createUiHttpServer }] =
    await Promise.all([
      import("@askdiff/server"),
      import("@askdiff/protocol"),
      import("./server-bundle.js"),
    ]);

  const resolved = await resolveOptions(opts);
  const port = await pickFreePort(resolved.port, resolved.host);

  const httpServer = createUiHttpServer();
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.once("listening", resolve);
    httpServer.listen(port, resolved.host);
  });

  await startServer({
    cwd: resolved.cwd,
    sessionId: resolved.session,
    diffFile: resolved.diffFile,
    ...(resolved.diffLabel !== undefined ? { diffLabel: resolved.diffLabel } : {}),
    volatile: resolved.volatile,
    httpServer,
    onListening: (resolvedPort) => {
      const url = `http://localhost:${String(resolvedPort)}/`;
      console.log(`${PROJECT_NAME} server listening on ${url}`);
      console.log(`  protocol: ${PROTOCOL_VERSION}`);
      console.log(`  project:  ${resolved.cwd}`);
      console.log(`  claude session: ${resolved.session}`);
      console.log(`  diff file:  ${resolved.diffFile}`);
      if (resolved.diffLabel) console.log(`  diff label: ${resolved.diffLabel}`);
      if (resolved.volatile) console.log(`  diff kind:  volatile (staleness checks enabled)`);
      console.log(`  websocket: ws://localhost:${String(resolvedPort)}${WS_PATH}`);
    },
  });

  const url = `http://localhost:${String(port)}/`;
  if (resolved.open) {
    void open(url);
  }
  console.log(`\nUI: ${url}`);

  process.on("SIGINT", () => shutdown(httpServer, "SIGINT"));
  process.on("SIGTERM", () => shutdown(httpServer, "SIGTERM"));
}

async function installSkill(force: boolean, useGlobal: boolean): Promise<void> {
  const source = join(__dirname, "skill.md");
  try {
    await stat(source);
  } catch {
    throw new Error(
      `bundled skill not found at ${source} — this build is broken; please reinstall`,
    );
  }

  const targetDir = useGlobal
    ? join(
        process.env["CLAUDE_CONFIG_DIR"] ?? join(homedir(), ".claude"),
        "skills",
        PROJECT_NAME,
      )
    : join(await resolveProjectRoot(process.cwd()), ".claude", "skills", PROJECT_NAME);
  const target = join(targetDir, "SKILL.md");

  const exists = await stat(target)
    .then(() => true)
    .catch(() => false);
  if (exists && !force) {
    console.log(`skill already installed at ${target}`);
    console.log("re-run with --force to overwrite");
    return;
  }

  await mkdir(targetDir, { recursive: true });
  await copyFile(source, target);
  console.log(`installed askdiff skill at ${target}`);
  if (useGlobal) {
    console.log("invoke /askdiff from any Claude Code session.");
  } else {
    console.log(
      "invoke /askdiff from any Claude Code session inside this project. (Project skills override same-named user-level skills.)",
    );
  }
}

// Walk up from `start` looking for a `.git` directory; that's the project
// root for the default project-level install. Errors out rather than
// guessing a fallback — installing into a random directory is worse than
// refusing.
async function resolveProjectRoot(start: string): Promise<string> {
  let dir = start;
  // Bound the walk by parent-equality so we stop at the filesystem root.
  for (;;) {
    const gitDir = join(dir, ".git");
    const found = await stat(gitDir)
      .then(() => true)
      .catch(() => false);
    if (found) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `install-skill needs a project root, but no .git directory was found at or above ${start}. cd into a git repo (or run \`git init\`) and re-run, or pass --global to install user-level instead.`,
      );
    }
    dir = parent;
  }
}

function shutdown(server: HttpServer, signal: string): void {
  console.log(`\n${signal} received, shutting down.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

interface ResolvedOptions {
  port: number;
  host: string;
  open: boolean;
  session: string;
  cwd: string;
  diffFile: string;
  diffLabel?: string;
  volatile: boolean;
}

async function resolveOptions(opts: RunOptions): Promise<ResolvedOptions> {
  const fromManifest = await readParentManifest();

  const cwd =
    opts.cwd ??
    process.env["ASKDIFF_PROJECT_CWD"] ??
    fromManifest?.cwd ??
    process.cwd();

  const session =
    opts.session ??
    process.env["ASKDIFF_SESSION_ID"] ??
    fromManifest?.sessionId;
  if (!session) {
    throw new Error(
      "Claude Code session is required. Pass --session <uuid>, set ASKDIFF_SESSION_ID, or run from inside a Claude Code session so the parent manifest is found.",
    );
  }

  const port = opts.port ?? (Number(process.env["PORT"]) || DEFAULT_PORT);

  const diffFile = process.env["ASKDIFF_DIFF_FILE"];
  if (!diffFile) {
    throw new Error(
      "ASKDIFF_DIFF_FILE is required. The askdiff skill must compute the diff and pass the path before launching the server.",
    );
  }
  const diffLabel = process.env["ASKDIFF_DIFF_LABEL"];
  const volatile = isTruthy(process.env["ASKDIFF_DIFF_VOLATILE"]);

  return {
    port,
    host: opts.host,
    open: opts.open,
    session,
    cwd,
    diffFile,
    ...(diffLabel ? { diffLabel } : {}),
    volatile,
  };
}

const isTruthy = (v: string | undefined): boolean => {
  if (v === undefined) return false;
  const lower = v.trim().toLowerCase();
  return lower === "1" || lower === "true" || lower === "yes";
};

interface ParentManifest {
  sessionId?: string;
  cwd?: string;
}

async function readParentManifest(): Promise<ParentManifest | null> {
  const ppid = process.ppid;
  if (!ppid) return null;
  const dir = process.env["CLAUDE_CONFIG_DIR"] ?? join(homedir(), ".claude");
  const path = join(dir, "sessions", `${String(ppid)}.json`);
  try {
    const raw = await readFile(path, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;
    const out: ParentManifest = {};
    if (typeof obj["sessionId"] === "string") out.sessionId = obj["sessionId"];
    if (typeof obj["cwd"] === "string") out.cwd = obj["cwd"];
    return out;
  } catch {
    return null;
  }
}

async function pickFreePort(start: number, host: string): Promise<number> {
  for (let port = start; port < start + 100; port++) {
    if (await isPortFree(port, host)) return port;
  }
  throw new Error(
    `could not find a free port in ${String(start)}-${String(start + 99)}`,
  );
}

function isPortFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = createNetServer();
    tester.once("error", () => resolve(false));
    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, host);
  });
}

main().catch((err: unknown) => {
  console.error("fatal:", err);
  process.exit(1);
});
