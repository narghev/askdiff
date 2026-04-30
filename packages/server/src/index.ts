import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { ClaudeCliError, streamAnswer } from "./claude";
import { getDiff } from "./util/diff";
import { GitError } from "./util/git";
import { PROTOCOL_VERSION, parseClientMessage, type AskMessage } from "@askdiff/protocol";
import { DEFAULT_PORT, PROJECT_NAME } from "./util/constants";
import {
  isValidSessionId,
  resolveInitialSessionId,
  sessionExists,
} from "./util/session";
import { broadcast, send } from "./util/ws";

export interface ServerState {
  cwd: string;
  claudeSessionId: string | null;
  clients: Set<WebSocket>;
}

async function sendDiff(ws: WebSocket, cwd: string): Promise<void> {
  try {
    const { raw, files } = await getDiff(cwd);
    send(ws, { type: "diff", raw, files });
  } catch (err) {
    const message =
      err instanceof GitError ? err.message : `unexpected diff error: ${String(err)}`;
    send(ws, { type: "error", message });
  }
}

async function handleAsk(
  ws: WebSocket,
  state: ServerState,
  ask: AskMessage,
  controllers: Map<string, AbortController>,
): Promise<void> {
  if (controllers.has(ask.id)) {
    send(ws, { type: "error", id: ask.id, message: `duplicate ask id: ${ask.id}` });
    return;
  }
  if (!state.claudeSessionId) {
    send(ws, {
      type: "error",
      id: ask.id,
      message:
        `No Claude Code session configured. Start ${PROJECT_NAME} from inside a session, or send \`set_session\` with a valid session_id.`,
    });
    return;
  }

  const controller = new AbortController();
  controllers.set(ask.id, controller);

  try {
    for await (const delta of streamAnswer({
      cwd: state.cwd,
      sessionId: state.claudeSessionId,
      ask,
      signal: controller.signal,
    })) {
      if (controller.signal.aborted) return;
      send(ws, { type: "chunk", id: ask.id, delta });
    }

    if (!controller.signal.aborted) {
      send(ws, { type: "done", id: ask.id });
    }
  } catch (err) {
    if (controller.signal.aborted) return;
    send(ws, { type: "error", id: ask.id, message: errorMessage(err) });
  } finally {
    controllers.delete(ask.id);
  }
}

async function handleSetSession(
  ws: WebSocket,
  state: ServerState,
  requestedId: string,
): Promise<void> {
  if (!isValidSessionId(requestedId)) {
    send(ws, {
      type: "error",
      message: `invalid session_id: ${requestedId} (expected UUID)`,
    });
    return;
  }
  if (!(await sessionExists(state.cwd, requestedId))) {
    send(ws, {
      type: "error",
      message: `session ${requestedId} not found under project ${state.cwd}`,
    });
    return;
  }
  state.claudeSessionId = requestedId;
  broadcast(state, { type: "session", session_id: requestedId });
}

function errorMessage(err: unknown): string {
  if (err instanceof ClaudeCliError) return err.message;
  if (err instanceof GitError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

function readIdleShutdownMs(): number {
  const raw = process.env.ASKDIFF_IDLE_SHUTDOWN_MS;
  if (raw === undefined) return 5 * 60_000;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : 5 * 60_000;
}

async function main(): Promise<void> {
  const cwd = process.env.ASKDIFF_PROJECT_CWD || process.cwd();
  const port = parseInt(process.env.PORT || '0') || DEFAULT_PORT;

  const initialSession = await resolveInitialSessionId(cwd);

  const state: ServerState = {
    cwd,
    claudeSessionId: initialSession,
    clients: new Set(),
  };

  const wss = new WebSocketServer({ port });

  // Idle shutdown: when the last client disconnects, exit after this many
  // ms of inactivity. Set ASKDIFF_IDLE_SHUTDOWN_MS=0 to disable.
  const idleShutdownMs = readIdleShutdownMs();
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const clearIdleTimer = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };
  const armIdleTimer = () => {
    clearIdleTimer();
    if (idleShutdownMs <= 0) return;
    idleTimer = setTimeout(() => {
      console.log(
        `no clients for ${String(Math.round(idleShutdownMs / 1000))}s; shutting down.`,
      );
      wss.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 5000).unref();
    }, idleShutdownMs);
  };

  wss.on("listening", () => {
    console.log(`${PROJECT_NAME} server listening on ws://localhost:${port}`);
    console.log(`  protocol: ${PROTOCOL_VERSION}`);
    console.log(`  project:  ${cwd}`);
    console.log(
      `  claude session: ${state.claudeSessionId ?? "(none — send set_session before asking)"}`,
    );
    if (idleShutdownMs > 0) {
      console.log(
        `  idle shutdown: ${String(Math.round(idleShutdownMs / 1000))}s after last client`,
      );
    }
    // Start the timer immediately so a server that nobody ever connects
    // to doesn't linger forever.
    armIdleTimer();
  });

  wss.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`port ${port} is already in use — set PORT to a free port and retry`);
      process.exit(1);
    }
    console.error("server error:", err);
    process.exit(1);
  });

  wss.on("connection", (ws) => {
    const connectionId = randomUUID();
    const controllers = new Map<string, AbortController>();

    clearIdleTimer();
    state.clients.add(ws);

    send(ws, {
      type: "hello",
      protocol: PROTOCOL_VERSION,
      project: cwd,
    });

    send(ws, { type: "session", session_id: state.claudeSessionId });

    void sendDiff(ws, cwd);

    ws.on("message", (data) => {
      const text = Buffer.isBuffer(data)
        ? data.toString("utf8")
        : Array.isArray(data)
          ? Buffer.concat(data).toString("utf8")
          : Buffer.from(data).toString("utf8");
      const parsed = parseClientMessage(text);

      if (!parsed.ok) {
        send(ws, { type: "error", message: parsed.error });
        return;
      }

      const msg = parsed.value;

      switch (msg.type) {
        case "ask":
          void handleAsk(ws, state, msg, controllers);
          return;
        case "cancel": {
          const controller = controllers.get(msg.id);
          if (controller) {
            controller.abort();
            controllers.delete(msg.id);
          }
          return;
        }
        case "diff_request":
          void sendDiff(ws, cwd);
          return;
        case "ping":
          send(ws, { type: "pong" });
          return;
        case "set_session":
          void handleSetSession(ws, state, msg.session_id);
          return;
      }
    });

    ws.on("close", () => {
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
      state.clients.delete(ws);
      if (state.clients.size === 0) armIdleTimer();
    });

    ws.on("error", (err) => {
      console.error(`[${connectionId}] socket error:`, err);
    });
  });

  const shutdown = (signal: string) => {
    console.log(`\n${signal} received, shutting down.`);
    wss.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  console.error("fatal:", err);
  process.exit(1);
});
