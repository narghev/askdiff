// Standalone script entry. Used by:
//   - the in-repo dev path (`tsx packages/server/src/main.ts`)
//   - the `/askdiff-dev` skill
//
// The published `askdiff` CLI imports `startServer` from `./index` and
// runs its own bootstrap; it does not invoke this file.
import { PROTOCOL_VERSION } from "@askdiff/protocol";
import { startServer, WS_PATH } from "./index";
import { DEFAULT_IDLE_SHUTDOWN_MS, DEFAULT_PORT, PROJECT_NAME } from "./util/constants";
import { resolveInitialSessionId } from "./util/session";

function readIdleShutdownMs(): number {
  const raw = process.env.ASKDIFF_IDLE_SHUTDOWN_MS;
  if (raw === undefined) return DEFAULT_IDLE_SHUTDOWN_MS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : DEFAULT_IDLE_SHUTDOWN_MS;
}

async function main(): Promise<void> {
  const cwd = process.env["ASKDIFF_PROJECT_CWD"] ?? process.cwd();
  const port = Number.parseInt(process.env["PORT"] ?? "0", 10) || DEFAULT_PORT;
  const idleShutdownMs = readIdleShutdownMs();

  const initialSession = await resolveInitialSessionId(cwd);

  await startServer({
    cwd,
    sessionId: initialSession,
    port,
    idleShutdownMs,
    onListening: (resolvedPort) => {
      console.log(
        `${PROJECT_NAME} server listening on ws://localhost:${String(resolvedPort)}${WS_PATH}`,
      );
      console.log(`  protocol: ${PROTOCOL_VERSION}`);
      console.log(`  project:  ${cwd}`);
      console.log(
        `  claude session: ${initialSession ?? "(none — send set_session before asking)"}`,
      );
      if (idleShutdownMs > 0) {
        console.log(
          `  idle shutdown: ${String(Math.round(idleShutdownMs / 1000))}s after last client`,
        );
      }
    },
  });

  const shutdown = (signal: string) => {
    console.log(`\n${signal} received, shutting down.`);
    setTimeout(() => process.exit(0), 100).unref();
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  console.error("fatal:", err);
  process.exit(1);
});
