import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { PROJECT_NAME_UPPER_CASE, UUID_RE } from "./constants";

const claudeConfigDir = (): string => process.env["CLAUDE_CONFIG_DIR"] ?? join(homedir(), ".claude");

const resolveProjectDir = (cwd: string): string => join(claudeConfigDir(), "projects", encodeProjectPath(cwd));

const encodeProjectPath = (absolutePath: string): string => absolutePath.replace(/\//g, "-");

export const isValidSessionId = (value: string):boolean => UUID_RE.test(value);

export const sessionExists = async (cwd: string, sessionId: string): Promise<boolean> => {
  if (!isValidSessionId(sessionId))
    throw new Error(`invalid session id: ${sessionId}`);

  try {
    // Just checks for the existence of the session file, we don't need to read it here
    await stat(join(resolveProjectDir(cwd), `${sessionId}.jsonl`));
    return true;
  } catch {
    return false;
  }
}

export const resolveInitialSessionId = async (cwd: string): Promise<string | null> => {
  const envSession = process.env[`${PROJECT_NAME_UPPER_CASE}_SESSION_ID`];
  if (!envSession) return null;

  // sessionExists throws on malformed UUID; here we additionally treat
  // "valid UUID but no JSONL on disk" as a hard startup failure so the
  // server doesn't silently come up with a misconfigured session.
  if (!(await sessionExists(cwd, envSession))) {
    throw new Error(
      `${PROJECT_NAME_UPPER_CASE}_SESSION_ID="${envSession}" is not a valid Claude Code session under ${cwd}`,
    );
  }

  return envSession;
}
