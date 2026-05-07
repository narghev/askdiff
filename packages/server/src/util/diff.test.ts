import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { DiffError, getDiff, parseUnifiedDiff } from "./diff";

describe("parseUnifiedDiff", () => {
  it("returns an empty array for empty input", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });

  it("returns an empty array for whitespace-only input", () => {
    // No `diff --git ` header → no file ever opened.
    expect(parseUnifiedDiff("\n\n\n")).toEqual([]);
  });

  it("parses a single-file modification with one hunk", () => {
    const raw = [
      "diff --git a/src/foo.ts b/src/foo.ts",
      "index abc123..def456 100644",
      "--- a/src/foo.ts",
      "+++ b/src/foo.ts",
      "@@ -10,3 +10,4 @@",
      " context",
      "-removed",
      "+added one",
      "+added two",
      " more context",
    ].join("\n");

    const files = parseUnifiedDiff(raw);
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("src/foo.ts");
    expect(files[0]?.hunks).toHaveLength(1);
    expect(files[0]?.hunks[0]?.from_line).toBe(10);
    expect(files[0]?.hunks[0]?.to_line).toBe(13); // 10 + 4 - 1
    expect(files[0]?.hunks[0]?.content).toContain("@@ -10,3 +10,4 @@");
    expect(files[0]?.hunks[0]?.content).toContain("+added one");
  });

  it("parses a file with multiple hunks", () => {
    const raw = [
      "diff --git a/file b/file",
      "--- a/file",
      "+++ b/file",
      "@@ -1,3 +1,3 @@",
      " a",
      "-b",
      "+B",
      " c",
      "@@ -50,2 +50,3 @@",
      " d",
      "+inserted",
      " e",
    ].join("\n");

    const files = parseUnifiedDiff(raw);
    expect(files).toHaveLength(1);
    expect(files[0]?.hunks).toHaveLength(2);
    expect(files[0]?.hunks[0]?.from_line).toBe(1);
    expect(files[0]?.hunks[1]?.from_line).toBe(50);
    expect(files[0]?.hunks[1]?.to_line).toBe(52);
  });

  it("parses multiple files in one diff stream", () => {
    const raw = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,1 +1,1 @@",
      "-a",
      "+A",
      "diff --git a/b.ts b/b.ts",
      "--- a/b.ts",
      "+++ b/b.ts",
      "@@ -1,1 +1,1 @@",
      "-b",
      "+B",
    ].join("\n");

    const files = parseUnifiedDiff(raw);
    expect(files).toHaveLength(2);
    expect(files[0]?.path).toBe("a.ts");
    expect(files[1]?.path).toBe("b.ts");
  });

  it("handles a new file (--- /dev/null, +++ b/path)", () => {
    const raw = [
      "diff --git a/new.ts b/new.ts",
      "new file mode 100644",
      "index 0000000..abc123",
      "--- /dev/null",
      "+++ b/new.ts",
      "@@ -0,0 +1,3 @@",
      "+line 1",
      "+line 2",
      "+line 3",
    ].join("\n");

    const files = parseUnifiedDiff(raw);
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("new.ts");
    expect(files[0]?.hunks[0]?.from_line).toBe(1);
    expect(files[0]?.hunks[0]?.to_line).toBe(3);
  });

  it("handles a deleted file (--- a/path, +++ /dev/null)", () => {
    const raw = [
      "diff --git a/old.ts b/old.ts",
      "deleted file mode 100644",
      "--- a/old.ts",
      "+++ /dev/null",
      "@@ -1,3 +0,0 @@",
      "-line 1",
      "-line 2",
      "-line 3",
    ].join("\n");

    const files = parseUnifiedDiff(raw);
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("old.ts");
    // Deletion-only hunk: newCount=0 → from_line=to_line=newStart (0).
    expect(files[0]?.hunks[0]?.from_line).toBe(0);
    expect(files[0]?.hunks[0]?.to_line).toBe(0);
  });

  it("captures the `\\ No newline at end of file` marker as part of the body", () => {
    const raw = [
      "diff --git a/x b/x",
      "--- a/x",
      "+++ b/x",
      "@@ -1,1 +1,1 @@",
      "-old",
      "\\ No newline at end of file",
      "+new",
      "\\ No newline at end of file",
    ].join("\n");

    const files = parseUnifiedDiff(raw);
    expect(files[0]?.hunks[0]?.content).toContain("\\ No newline at end of file");
  });

  it("treats a hunk header without ,count as count=1", () => {
    // `@@ -10 +20 @@` — git omits ,count for single-line hunks.
    const raw = [
      "diff --git a/x b/x",
      "--- a/x",
      "+++ b/x",
      "@@ -10 +20 @@",
      "-old",
      "+new",
    ].join("\n");

    const files = parseUnifiedDiff(raw);
    expect(files[0]?.hunks[0]?.from_line).toBe(20);
    expect(files[0]?.hunks[0]?.to_line).toBe(20); // 20 + 1 - 1
  });

  it("ignores junk lines outside of a hunk body", () => {
    const raw = [
      "diff --git a/x b/x",
      "index abc..def",
      "Binary files differ",
      "--- a/x",
      "+++ b/x",
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
    ].join("\n");

    const files = parseUnifiedDiff(raw);
    // The "Binary files differ" line is not preceded by a hunk header,
    // and parsing just ignores it. We still get the real hunk.
    expect(files).toHaveLength(1);
    expect(files[0]?.hunks).toHaveLength(1);
  });

  it("skips prologue garbage before the first diff --git line", () => {
    const raw = [
      "stray text not part of any diff",
      "more garbage",
      "diff --git a/real.ts b/real.ts",
      "--- a/real.ts",
      "+++ b/real.ts",
      "@@ -1,1 +1,1 @@",
      "-x",
      "+y",
    ].join("\n");

    const files = parseUnifiedDiff(raw);
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("real.ts");
  });

  it("commits the trailing file when input ends without a fresh delimiter", () => {
    // No newline-terminating delimiter; flushFile() at end-of-loop must catch it.
    const raw = [
      "diff --git a/last.ts b/last.ts",
      "--- a/last.ts",
      "+++ b/last.ts",
      "@@ -1,1 +1,1 @@",
      "-x",
      "+y",
    ].join("\n");

    const files = parseUnifiedDiff(raw);
    expect(files).toHaveLength(1);
    expect(files[0]?.hunks).toHaveLength(1);
  });
});

describe("getDiff", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "askdiff-test-"));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads a unified diff from disk and parses it", async () => {
    const path = join(dir, "good.diff");
    const raw = [
      "diff --git a/src/x.ts b/src/x.ts",
      "--- a/src/x.ts",
      "+++ b/src/x.ts",
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
      "",
    ].join("\n");
    writeFileSync(path, raw, "utf8");

    const result = await getDiff(path);
    expect(result.raw).toBe(raw);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.path).toBe("src/x.ts");
  });

  it("returns an empty result for an empty file", async () => {
    const path = join(dir, "empty.diff");
    writeFileSync(path, "", "utf8");

    const result = await getDiff(path);
    expect(result.raw).toBe("");
    expect(result.files).toEqual([]);
  });

  it("throws DiffError when the file is missing", async () => {
    const path = join(dir, "does-not-exist.diff");
    await expect(getDiff(path)).rejects.toBeInstanceOf(DiffError);
  });
});
