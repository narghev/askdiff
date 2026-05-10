import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatAge, resolveSession } from "./resolve-session";

const HOUR_S = 3600;
const DAY_S = 86400;
const HOUR_MS = HOUR_S * 1000;
const DAY_MS = DAY_S * 1000;

const UUIDS = {
  invoking: "11111111-1111-4111-8111-111111111111",
  hot: "22222222-2222-4222-8222-222222222222",
  warm: "33333333-3333-4333-8333-333333333333",
  cold: "44444444-4444-4444-8444-444444444444",
  stale: "55555555-5555-4555-8555-555555555555",
};

const PROJECT_CWD = "/fake/project/path";

const writeJsonl = (
  dir: string,
  uuid: string,
  lines: readonly string[],
  mtimeMs: number,
): string => {
  const path = join(dir, `${uuid}.jsonl`);
  writeFileSync(path, lines.join("\n"));
  const mtime = mtimeMs / 1000;
  utimesSync(path, mtime, mtime);
  return path;
};

describe("formatAge", () => {
  const now = Date.UTC(2026, 4, 9, 12, 0, 0);

  it("formats sub-day ages in hours", () => {
    expect(formatAge(now - 1 * HOUR_MS, now)).toBe("1h ago");
    expect(formatAge(now - 5 * HOUR_MS, now)).toBe("5h ago");
    expect(formatAge(now - (DAY_MS - 1), now)).toBe("23h ago");
  });

  it("formats day+ ages in days", () => {
    expect(formatAge(now - 1 * DAY_MS, now)).toBe("1d ago");
    expect(formatAge(now - 7 * DAY_MS, now)).toBe("7d ago");
  });

  it("clamps negative (clock-skew) ages to 0h", () => {
    expect(formatAge(now + 5 * HOUR_MS, now)).toBe("0h ago");
  });
});

describe("resolveSession", () => {
  const NOW = Date.UTC(2026, 4, 9, 12, 0, 0);
  let configDir: string;
  let projectDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "askdiff-resolve-"));
    projectDir = join(configDir, "projects", "-fake-project-path");
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it("returns no candidates when there are no needles", async () => {
    writeJsonl(projectDir, UUIDS.hot, ["any text"], NOW - HOUR_MS);
    const r = await resolveSession({
      cwd: PROJECT_CWD,
      configDir,
      now: NOW,
    });
    expect(r.candidates).toEqual([]);
  });

  it("returns no candidates when the sessions dir doesn't exist", async () => {
    const r = await resolveSession({
      cwd: "/nonexistent/path",
      configDir,
      keywords: ["foo"],
      now: NOW,
    });
    expect(r.candidates).toEqual([]);
  });

  it("counts matching lines (one match per line, regardless of needle count)", async () => {
    writeJsonl(
      projectDir,
      UUIDS.hot,
      [
        "line about foo",
        "line about bar",
        "line about both foo and bar",
        "no match here",
      ],
      NOW - HOUR_MS,
    );
    const r = await resolveSession({
      cwd: PROJECT_CWD,
      configDir,
      keywords: ["foo", "bar"],
      now: NOW,
    });
    expect(r.candidates).toEqual([
      { uuid: UUIDS.hot, count: 3, age: "1h ago" },
    ]);
  });

  it("excludes the invoking session", async () => {
    writeJsonl(projectDir, UUIDS.invoking, ["foo foo foo"], NOW - HOUR_MS);
    writeJsonl(projectDir, UUIDS.hot, ["foo"], NOW - HOUR_MS);
    const r = await resolveSession({
      cwd: PROJECT_CWD,
      configDir,
      invoking: UUIDS.invoking,
      keywords: ["foo"],
      now: NOW,
    });
    expect(r.candidates.map((c) => c.uuid)).toEqual([UUIDS.hot]);
  });

  it("filters out files older than maxAgeDays", async () => {
    writeJsonl(projectDir, UUIDS.hot, ["foo"], NOW - 5 * DAY_MS);
    writeJsonl(projectDir, UUIDS.stale, ["foo"], NOW - 60 * DAY_MS);
    const r = await resolveSession({
      cwd: PROJECT_CWD,
      configDir,
      keywords: ["foo"],
      maxAgeDays: 30,
      now: NOW,
    });
    expect(r.candidates.map((c) => c.uuid)).toEqual([UUIDS.hot]);
  });

  it("sorts results by count descending and truncates to top N", async () => {
    writeJsonl(projectDir, UUIDS.hot, ["foo", "foo", "foo"], NOW - HOUR_MS);
    writeJsonl(projectDir, UUIDS.warm, ["foo", "foo"], NOW - HOUR_MS);
    writeJsonl(projectDir, UUIDS.cold, ["foo"], NOW - HOUR_MS);
    const r = await resolveSession({
      cwd: PROJECT_CWD,
      configDir,
      keywords: ["foo"],
      top: 2,
      now: NOW,
    });
    expect(r.candidates).toEqual([
      { uuid: UUIDS.hot, count: 3, age: "1h ago" },
      { uuid: UUIDS.warm, count: 2, age: "1h ago" },
    ]);
  });

  it("extracts diff '+++ b/<path>' lines as additional needles", async () => {
    const diffFile = join(configDir, "diff.txt");
    writeFileSync(
      diffFile,
      [
        "diff --git a/src/a.ts b/src/a.ts",
        "--- a/src/a.ts",
        "+++ b/src/a.ts",
        "@@ -1 +1 @@",
        "-old",
        "+new",
        "diff --git a/src/b.ts b/src/b.ts",
        "+++ b/src/b.ts",
      ].join("\n"),
    );
    writeJsonl(
      projectDir,
      UUIDS.hot,
      [
        "I touched src/a.ts here",
        "and also src/b.ts",
        "totally unrelated",
      ],
      NOW - HOUR_MS,
    );
    const r = await resolveSession({
      cwd: PROJECT_CWD,
      configDir,
      diffFile,
      now: NOW,
    });
    expect(r.candidates).toEqual([
      { uuid: UUIDS.hot, count: 2, age: "1h ago" },
    ]);
  });

  it("ignores a missing diff file but still uses other needles", async () => {
    writeJsonl(projectDir, UUIDS.hot, ["foo line"], NOW - HOUR_MS);
    const r = await resolveSession({
      cwd: PROJECT_CWD,
      configDir,
      diffFile: "/no/such/file.diff",
      keywords: ["foo"],
      now: NOW,
    });
    expect(r.candidates).toEqual([
      { uuid: UUIDS.hot, count: 1, age: "1h ago" },
    ]);
  });

  it("ignores empty and whitespace-only needles", async () => {
    writeJsonl(projectDir, UUIDS.hot, ["foo line"], NOW - HOUR_MS);
    const r = await resolveSession({
      cwd: PROJECT_CWD,
      configDir,
      keywords: ["", "  ", "foo"],
      shas: [""],
      branches: ["   "],
      now: NOW,
    });
    expect(r.candidates).toEqual([
      { uuid: UUIDS.hot, count: 1, age: "1h ago" },
    ]);
  });

  it("dedupes overlapping needles across keywords/shas/branches", async () => {
    // 'foo' appears in keywords AND shas — should be a single needle.
    writeJsonl(projectDir, UUIDS.hot, ["a foo b", "c foo d"], NOW - HOUR_MS);
    const r = await resolveSession({
      cwd: PROJECT_CWD,
      configDir,
      keywords: ["foo"],
      shas: ["foo"],
      now: NOW,
    });
    expect(r.candidates[0]?.count).toBe(2);
  });

  it("ignores subdirectories and non-jsonl files in the sessions dir", async () => {
    mkdirSync(join(projectDir, "subdir"));
    writeFileSync(join(projectDir, "not-jsonl.txt"), "foo foo foo");
    writeJsonl(projectDir, UUIDS.hot, ["foo"], NOW - HOUR_MS);
    const r = await resolveSession({
      cwd: PROJECT_CWD,
      configDir,
      keywords: ["foo"],
      now: NOW,
    });
    expect(r.candidates).toEqual([
      { uuid: UUIDS.hot, count: 1, age: "1h ago" },
    ]);
  });

  it("returns empty candidates when no JSONL has any matches", async () => {
    writeJsonl(projectDir, UUIDS.hot, ["nothing here"], NOW - HOUR_MS);
    const r = await resolveSession({
      cwd: PROJECT_CWD,
      configDir,
      keywords: ["foo"],
      now: NOW,
    });
    expect(r.candidates).toEqual([]);
  });
});
