import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Path to the built CLI bundle. Tests run after `pnpm --filter askdiff run build`,
// or directly during dev — when the bundle isn't present, tests are skipped to
// avoid masking the real failure.
const REPO_ROOT = resolvePath(__dirname, "..", "..", "..");
const CLI_PATH = join(REPO_ROOT, "packages", "cli", "dist", "index.js");

const FAKE_PROJECT_CWD = "/fake/integration/project";
const ENCODED = "-fake-integration-project";
const HOUR_MS = 3600 * 1000;

const writeJsonl = (
  dir: string,
  uuid: string,
  lines: readonly string[],
  mtimeMs: number,
): void => {
  const path = join(dir, `${uuid}.jsonl`);
  writeFileSync(path, lines.join("\n"));
  const mtime = mtimeMs / 1000;
  utimesSync(path, mtime, mtime);
};

describe("CLI integration: resolve-session subcommand", () => {
  let configDir: string;
  let projectDir: string;
  let cliExists = true;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "askdiff-cli-integration-"));
    projectDir = join(configDir, "projects", ENCODED);
    mkdirSync(projectDir, { recursive: true });

    // Skip cleanly if the build hasn't run.
    cliExists = existsSync(CLI_PATH);
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  const runCli = async (args: readonly string[]): Promise<{ stdout: string; stderr: string }> =>
    execFileAsync("node", [CLI_PATH, ...args], {
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: configDir,
      },
    });

  it("respects --cwd when explicitly passed (regression: commander v14 parent/sub flag overlap)", async () => {
    if (!cliExists) {
      console.warn(`skipping — CLI bundle not built at ${CLI_PATH}`);
      return;
    }
    const NOW = Date.now();
    writeJsonl(projectDir, "11111111-1111-4111-8111-111111111111", ["foo bar"], NOW - HOUR_MS);

    // Empty --cwd dir → no project dir under our isolated CLAUDE_CONFIG_DIR → empty.
    const empty = await runCli([
      "resolve-session",
      "--cwd",
      "/different/path/with/no/sessions",
      "--keyword",
      "foo",
    ]);
    expect(JSON.parse(empty.stdout)).toEqual({ candidates: [] });

    // Real --cwd → finds the fixture session.
    const found = await runCli([
      "resolve-session",
      "--cwd",
      FAKE_PROJECT_CWD,
      "--keyword",
      "foo",
    ]);
    const parsed = JSON.parse(found.stdout) as { candidates: { uuid: string; count: number }[] };
    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.candidates[0]?.uuid).toBe("11111111-1111-4111-8111-111111111111");
    expect(parsed.candidates[0]?.count).toBe(1);
  });

  it("accepts repeated --keyword flags", async () => {
    if (!cliExists) return;
    const NOW = Date.now();
    writeJsonl(
      projectDir,
      "22222222-2222-4222-8222-222222222222",
      ["mentions alpha", "mentions beta", "mentions both alpha and beta", "neither"],
      NOW - HOUR_MS,
    );

    const r = await runCli([
      "resolve-session",
      "--cwd",
      FAKE_PROJECT_CWD,
      "--keyword",
      "alpha",
      "--keyword",
      "beta",
    ]);
    const parsed = JSON.parse(r.stdout) as { candidates: { count: number }[] };
    expect(parsed.candidates[0]?.count).toBe(3); // 3 lines contain at least one needle
  });

  it("filters by --invoking", async () => {
    if (!cliExists) return;
    const NOW = Date.now();
    writeJsonl(projectDir, "33333333-3333-4333-8333-333333333333", ["foo"], NOW - HOUR_MS);
    writeJsonl(projectDir, "44444444-4444-4444-8444-444444444444", ["foo foo"], NOW - HOUR_MS);

    const r = await runCli([
      "resolve-session",
      "--cwd",
      FAKE_PROJECT_CWD,
      "--invoking",
      "44444444-4444-4444-8444-444444444444",
      "--keyword",
      "foo",
    ]);
    const parsed = JSON.parse(r.stdout) as { candidates: { uuid: string }[] };
    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.candidates[0]?.uuid).toBe("33333333-3333-4333-8333-333333333333");
  });

  it("emits empty candidates when no needles passed", async () => {
    if (!cliExists) return;
    const r = await runCli(["resolve-session", "--cwd", FAKE_PROJECT_CWD]);
    expect(JSON.parse(r.stdout)).toEqual({ candidates: [] });
  });
});

// The askdiff-dev skill calls the CLI via `tsx src/index.ts resolve-session …`.
// Static imports of `@askdiff/protocol` (CJS) at the top of `src/index.ts`
// would break this path under ESM. This test guards against re-introducing
// such imports.
describe("CLI integration: dev path (tsx)", () => {
  let configDir: string;
  let projectDir: string;

  const TSX_PATH = join(REPO_ROOT, "node_modules", ".bin", "tsx");
  const CLI_SOURCE = join(REPO_ROOT, "packages", "cli", "src", "index.ts");

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "askdiff-cli-tsx-"));
    projectDir = join(configDir, "projects", ENCODED);
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it("invokes resolve-session via tsx and returns valid JSON (dev-skill path)", async () => {
    if (!existsSync(TSX_PATH)) {
      console.warn(`skipping — tsx not found at ${TSX_PATH}`);
      return;
    }

    const NOW = Date.now();
    writeJsonl(
      projectDir,
      "55555555-5555-4555-8555-555555555555",
      ["dev-path-keyword line"],
      NOW - HOUR_MS,
    );

    const { stdout } = await execFileAsync(
      TSX_PATH,
      [CLI_SOURCE, "resolve-session", "--cwd", FAKE_PROJECT_CWD, "--keyword", "dev-path-keyword"],
      { env: { ...process.env, CLAUDE_CONFIG_DIR: configDir } },
    );
    const parsed = JSON.parse(stdout) as { candidates: { uuid: string; count: number }[] };
    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.candidates[0]?.uuid).toBe("55555555-5555-4555-8555-555555555555");
  }, 15_000);
});
