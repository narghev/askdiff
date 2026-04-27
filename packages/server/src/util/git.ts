import { MAX_DIFF_BUFFER } from "./constants";
import { execFileAsync } from "./helpers";

export class GitError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = "GitError";
  }
}

interface ExecFileErrorLike extends Error {
  code?: number;
  stdout?: string;
  stderr?: string;
}

export const hasHead = async (cwd: string): Promise<boolean> => {
  try {
    await execFileAsync("git", ["rev-parse", "--verify", "HEAD"], { cwd });
    return true;
  } catch {
    return false;
  }
}

export const getTrackedDiff = async (cwd: string, base: string): Promise<string> => {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["diff", base, "--no-color"],
      { cwd, maxBuffer: MAX_DIFF_BUFFER },
    );
    return stdout;
  } catch (err) {
    throw new GitError(
      `git diff failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }
}

const diffNoIndex = async (cwd: string, path: string): Promise<string> => {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["diff", "--no-index", "--no-color", "--", "/dev/null", path],
      { cwd, maxBuffer: MAX_DIFF_BUFFER },
    );

    return stdout;
  } catch (err) {
    const e = err as ExecFileErrorLike;
    if (e.code === 1 && typeof e.stdout === "string") 
      return e.stdout;

    return "";
  }
}

export const getUntrackedDiff = async (cwd: string): Promise<string> => {
  let listing: string;

  try {
    const { stdout } = await execFileAsync(
      "git",
      ["ls-files", "--others", "--exclude-standard", "-z"],
      { cwd, maxBuffer: MAX_DIFF_BUFFER },
    );
    listing = stdout;
  } catch (err) {
    throw new GitError(
      `git ls-files failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

  const paths = listing.split("\0").filter((p) => p.length > 0);
  if (paths.length === 0) return "";

  const parts: string[] = [];
  for (const path of paths) {
    const piece = await diffNoIndex(cwd, path);
    if (piece.length > 0) parts.push(piece);
  }

  return parts.join("");
}
