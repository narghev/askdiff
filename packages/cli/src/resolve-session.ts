import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

const DEFAULT_MAX_AGE_DAYS = 30;
const DEFAULT_TOP = 5;
const SECONDS_PER_DAY = 86400;
const SECONDS_PER_HOUR = 3600;
const DIFF_PATH_PREFIX = "+++ b/";

export interface ResolveSessionOptions {
  // Project cwd. Used (with configDir) to derive the sessions dir.
  cwd: string;
  // Override for ${CLAUDE_CONFIG_DIR:-~/.claude}.
  configDir?: string;
  // Session UUID to exclude from results (the invoking session always
  // matches its own JSONL because the user just typed the keywords into it).
  invoking?: string;
  // User-supplied keyword phrases.
  keywords?: readonly string[];
  // Commit SHAs (description-based diffs only).
  shas?: readonly string[];
  // Branch names (X...Y / X..Y diff form).
  branches?: readonly string[];
  // Optional path to a unified-diff file. `+++ b/<path>` lines are extracted
  // as additional needles — catches sessions that Read/Edit/Write'd those files.
  diffFile?: string;
  // mtime cutoff in days. Default 30.
  maxAgeDays?: number;
  // Cap on returned candidates. Default 5.
  top?: number;
  // Test seam: override Date.now().
  now?: number;
}

export interface SessionCandidate {
  uuid: string;
  count: number;
  age: string;
}

export interface ResolveSessionResult {
  candidates: SessionCandidate[];
}

export const resolveSession = async (
  opts: ResolveSessionOptions,
): Promise<ResolveSessionResult> => {
  const configDir =
    opts.configDir ?? process.env["CLAUDE_CONFIG_DIR"] ?? join(homedir(), ".claude");
  const sessionsDir = join(
    configDir,
    "projects",
    encodeProjectPath(resolve(opts.cwd)),
  );
  const maxAgeDays = opts.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
  const top = opts.top ?? DEFAULT_TOP;
  const nowMs = opts.now ?? Date.now();
  const cutoffMs = nowMs - maxAgeDays * SECONDS_PER_DAY * 1000;

  const needles = await buildNeedles({
    keywords: opts.keywords ?? [],
    shas: opts.shas ?? [],
    branches: opts.branches ?? [],
    ...(opts.diffFile !== undefined ? { diffFile: opts.diffFile } : {}),
  });
  if (needles.length === 0) return { candidates: [] };

  const files = await listRecentJsonls(sessionsDir, cutoffMs, opts.invoking ?? "");
  const counted: { uuid: string; count: number; mtimeMs: number }[] = [];
  for (const f of files) {
    const count = await countMatchingLines(f.path, needles);
    if (count > 0) counted.push({ uuid: f.uuid, count, mtimeMs: f.mtimeMs });
  }

  counted.sort((a, b) => b.count - a.count);
  return {
    candidates: counted.slice(0, top).map((c) => ({
      uuid: c.uuid,
      count: c.count,
      age: formatAge(c.mtimeMs, nowMs),
    })),
  };
};

const encodeProjectPath = (absolute: string): string => absolute.replace(/\//g, "-");

interface NeedleInputs {
  keywords: readonly string[];
  shas: readonly string[];
  branches: readonly string[];
  diffFile?: string;
}

const buildNeedles = async (inputs: NeedleInputs): Promise<string[]> => {
  const set = new Set<string>();
  const add = (s: string) => {
    const trimmed = s.trim();
    if (trimmed.length > 0) set.add(trimmed);
  };
  for (const k of inputs.keywords) add(k);
  for (const s of inputs.shas) add(s);
  for (const b of inputs.branches) add(b);
  if (inputs.diffFile !== undefined) {
    try {
      const text = await readFile(inputs.diffFile, "utf8");
      for (const line of text.split("\n")) {
        if (line.startsWith(DIFF_PATH_PREFIX)) {
          add(line.slice(DIFF_PATH_PREFIX.length));
        }
      }
    } catch {
      // Diff file missing/unreadable is benign — proceed with the other needles.
    }
  }
  return Array.from(set);
};

interface JsonlEntry {
  path: string;
  uuid: string;
  mtimeMs: number;
}

const listRecentJsonls = async (
  dir: string,
  cutoffMs: number,
  excludeUuid: string,
): Promise<JsonlEntry[]> => {
  const dirents = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: JsonlEntry[] = [];
  for (const e of dirents) {
    if (!e.isFile() || !e.name.endsWith(".jsonl")) continue;
    const uuid = e.name.slice(0, -".jsonl".length);
    if (uuid === excludeUuid) continue;
    const path = join(dir, e.name);
    const s = await stat(path).catch(() => null);
    if (s === null) continue;
    if (s.mtimeMs < cutoffMs) continue;
    out.push({ path, uuid, mtimeMs: s.mtimeMs });
  }
  return out;
};

const countMatchingLines = async (
  filePath: string,
  needles: readonly string[],
): Promise<number> => {
  let count = 0;
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      for (const n of needles) {
        if (line.includes(n)) {
          count++;
          break;
        }
      }
    }
  } catch {
    // Partial result on read error — return what we have rather than crash.
  }
  return count;
};

export const formatAge = (mtimeMs: number, nowMs: number): string => {
  const ageSec = Math.max(0, Math.floor((nowMs - mtimeMs) / 1000));
  if (ageSec < SECONDS_PER_DAY) {
    return `${String(Math.floor(ageSec / SECONDS_PER_HOUR))}h ago`;
  }
  return `${String(Math.floor(ageSec / SECONDS_PER_DAY))}d ago`;
};
