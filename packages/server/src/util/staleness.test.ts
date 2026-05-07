import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import type { DiffFile } from "@askdiff/protocol";
import { checkStaleness } from "./staleness";

// Each test gets its own scratch directory so the diff-file mtime and
// per-file mtimes can be set independently without bleed across cases.
const fakeDiffFiles = (...paths: string[]): DiffFile[] =>
  paths.map((p) => ({ path: p, hunks: [] }));

const setMtime = async (path: string, mtime: Date) => {
  await utimes(path, mtime, mtime);
};

describe("checkStaleness", () => {
  let dir: string;
  let diffFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "askdiff-staleness-test-"));
    diffFile = join(dir, "diff");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns not stale for an empty files array", async () => {
    writeFileSync(diffFile, "");
    const result = await checkStaleness(diffFile, dir, []);
    expect(result).toEqual({ stale: false, staleFiles: [] });
  });

  it("returns not stale when the diff file does not exist", async () => {
    // Skipping the diff-file write entirely — checkStaleness should swallow
    // the stat ENOENT and degrade to "no staleness signal".
    const result = await checkStaleness(
      join(dir, "missing.diff"),
      dir,
      fakeDiffFiles("foo.ts"),
    );
    expect(result).toEqual({ stale: false, staleFiles: [] });
  });

  it("flags a file whose mtime is newer than the diff file's mtime", async () => {
    const past = new Date(Date.now() - 60_000);
    const now = new Date();

    writeFileSync(diffFile, "");
    await setMtime(diffFile, past);

    const filePath = join(dir, "newer.ts");
    writeFileSync(filePath, "");
    await setMtime(filePath, now);

    const result = await checkStaleness(diffFile, dir, fakeDiffFiles("newer.ts"));
    expect(result).toEqual({ stale: true, staleFiles: ["newer.ts"] });
  });

  it("does not flag a file whose mtime is older than the diff file's mtime", async () => {
    const past = new Date(Date.now() - 60_000);
    const now = new Date();

    const filePath = join(dir, "older.ts");
    writeFileSync(filePath, "");
    await setMtime(filePath, past);

    writeFileSync(diffFile, "");
    await setMtime(diffFile, now);

    const result = await checkStaleness(diffFile, dir, fakeDiffFiles("older.ts"));
    expect(result).toEqual({ stale: false, staleFiles: [] });
  });

  it("flags a file that no longer exists on disk", async () => {
    writeFileSync(diffFile, "");
    // "missing.ts" is in the diff but never created on disk — should be
    // treated as stale (file deleted since the diff was taken).
    const result = await checkStaleness(diffFile, dir, fakeDiffFiles("missing.ts"));
    expect(result).toEqual({ stale: true, staleFiles: ["missing.ts"] });
  });

  it("returns only the stale entries from a mixed set", async () => {
    const past = new Date(Date.now() - 60_000);
    const now = new Date();

    writeFileSync(diffFile, "");
    await setMtime(diffFile, past);

    const oldFile = join(dir, "old.ts");
    writeFileSync(oldFile, "");
    await setMtime(oldFile, past);

    const newFile = join(dir, "new.ts");
    writeFileSync(newFile, "");
    await setMtime(newFile, now);

    // "ghost.ts" is missing → stale.
    const result = await checkStaleness(
      diffFile,
      dir,
      fakeDiffFiles("old.ts", "new.ts", "ghost.ts"),
    );

    expect(result.stale).toBe(true);
    // Order isn't guaranteed (Promise.all + .push()), so compare as a set.
    expect(result.staleFiles.sort()).toEqual(["ghost.ts", "new.ts"]);
    expect(result.staleFiles).not.toContain("old.ts");
  });

  it("skips entries with an empty path string", async () => {
    writeFileSync(diffFile, "");
    // Defensive: parseUnifiedDiff can produce a `{ path: "", ... }` entry
    // for prologue-only input (see diff.ts:60). checkStaleness should
    // ignore those rather than stat the cwd itself.
    const result = await checkStaleness(diffFile, dir, [{ path: "", hunks: [] }]);
    expect(result).toEqual({ stale: false, staleFiles: [] });
  });

  it("treats files in nested subdirectories the same as top-level", async () => {
    const past = new Date(Date.now() - 60_000);
    const now = new Date();

    writeFileSync(diffFile, "");
    await setMtime(diffFile, past);

    // Build a nested path: <dir>/src/util/nested.ts.
    const nestedDir = join(dir, "src", "util");
    mkdirSync(nestedDir, { recursive: true });
    const nested = join(nestedDir, "nested.ts");
    writeFileSync(nested, "");
    await setMtime(nested, now);

    const result = await checkStaleness(
      diffFile,
      dir,
      fakeDiffFiles("src/util/nested.ts"),
    );
    expect(result).toEqual({
      stale: true,
      staleFiles: ["src/util/nested.ts"],
    });
  });
});
