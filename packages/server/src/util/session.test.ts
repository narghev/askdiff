import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isValidSessionId,
  resolveInitialSessionId,
  sessionExists,
} from "./session";

const VALID_UUID = "b2d21a1d-bb99-4563-b562-92792f911f51";
const ANOTHER_UUID = "b64e5750-773d-48d9-93ef-71a46138ebc6";

describe("isValidSessionId", () => {
  it("accepts canonical lowercase UUIDs", () => {
    expect(isValidSessionId(VALID_UUID)).toBe(true);
  });

  it("accepts uppercase UUIDs (case-insensitive)", () => {
    expect(isValidSessionId(VALID_UUID.toUpperCase())).toBe(true);
  });

  it("rejects empty string", () => {
    expect(isValidSessionId("")).toBe(false);
  });

  it("rejects strings missing hyphens", () => {
    expect(isValidSessionId(VALID_UUID.replace(/-/g, ""))).toBe(false);
  });

  it("rejects strings with extra trailing chars", () => {
    expect(isValidSessionId(`${VALID_UUID}extra`)).toBe(false);
  });

  it("rejects strings with non-hex chars", () => {
    expect(isValidSessionId("zzzzzzzz-bb99-4563-b562-92792f911f51")).toBe(false);
  });

  it("rejects arbitrary non-UUID input", () => {
    expect(isValidSessionId("not-a-uuid")).toBe(false);
  });
});

describe("session-resolution filesystem helpers", () => {
  let configDir: string;
  let projectCwd: string;
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  const originalEnvSession = process.env.ASKDIFF_SESSION_ID;

  beforeEach(() => {
    // Isolated tmp config dir per test.
    configDir = mkdtempSync(join(tmpdir(), "askdiff-test-"));
    process.env.CLAUDE_CONFIG_DIR = configDir;

    // Mock project cwd; must be encoded by replacing / with -.
    projectCwd = "/fake/project/path";
    const projectDir = join(configDir, "projects", "-fake-project-path");
    mkdirSync(projectDir, { recursive: true });

    // Two pre-existing session JSONLs in that project dir.
    writeFileSync(join(projectDir, `${VALID_UUID}.jsonl`), "");
    writeFileSync(join(projectDir, `${ANOTHER_UUID}.jsonl`), "");

    delete process.env.ASKDIFF_SESSION_ID;
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
    if (originalEnvSession === undefined) delete process.env.ASKDIFF_SESSION_ID;
    else process.env.ASKDIFF_SESSION_ID = originalEnvSession;
  });

  describe("sessionExists", () => {
    it("returns true when the JSONL is present", async () => {
      await expect(sessionExists(projectCwd, VALID_UUID)).resolves.toBe(true);
    });

    it("returns false when the JSONL is missing", async () => {
      const missingUuid = "00000000-0000-0000-0000-000000000000";
      await expect(sessionExists(projectCwd, missingUuid)).resolves.toBe(false);
    });

    it("returns false when the project dir doesn't exist", async () => {
      await expect(sessionExists("/nonexistent/cwd", VALID_UUID)).resolves.toBe(false);
    });

    it("throws on a malformed session id", async () => {
      await expect(sessionExists(projectCwd, "not-a-uuid")).rejects.toThrow(/invalid session id/);
    });
  });

  describe("resolveInitialSessionId", () => {
    it("returns null when env is unset (server starts unconfigured)", async () => {
      await expect(resolveInitialSessionId(projectCwd)).resolves.toBeNull();
    });

    it("returns the env session when valid and present on disk", async () => {
      process.env.ASKDIFF_SESSION_ID = VALID_UUID;
      await expect(resolveInitialSessionId(projectCwd)).resolves.toBe(VALID_UUID);
    });

    it("throws when env is set but the session JSONL is missing (hard startup fail)", async () => {
      process.env.ASKDIFF_SESSION_ID = "00000000-0000-0000-0000-000000000000";
      await expect(resolveInitialSessionId(projectCwd)).rejects.toThrow(
        /not a valid Claude Code session/,
      );
    });

    it("throws when env is set to a malformed UUID (via sessionExists)", async () => {
      process.env.ASKDIFF_SESSION_ID = "garbage";
      await expect(resolveInitialSessionId(projectCwd)).rejects.toThrow(/invalid session id/);
    });
  });
});
