import { randomUUID } from "node:crypto";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
} from "node:http";
import type { Socket } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import { ClaudeCliError, streamAnswer } from "./claude";
import { getDiff } from "./util/diff";
import { GitError } from "./util/git";
import { PROTOCOL_VERSION, parseClientMessage, type AskMessage } from "@askdiff/protocol";
import { DEFAULT_HOST, DEFAULT_IDLE_SHUTDOWN_MS, PROJECT_NAME } from "./util/constants";
import { isValidSessionId, sessionExists } from "./util/session";
import { broadcast, send } from "./util/ws";

export const WS_PATH = "/ws";

export interface ServerState {
  cwd: string;
  claudeSessionId: string | null;
  clients: Set<WebSocket>;
}

export interface StartServerOptions {
  cwd: string;
  sessionId: string | null;
  // Standalone mode: pass `port` (and optionally `host`) and the server
  // creates its own HTTP listener.
  port?: number;
  host?: string;
  // Mount mode: pass an already-constructed HTTP server (e.g. one that
  // also serves static files) and the WebSocket upgrade is attached to it.
  // When set, `port` and `host` are ignored — the caller owns lifecycle.
  httpServer?: HttpServer;
  idleShutdownMs?: number;
  onListening?: (port: number) => void;
}

export interface ServerHandle {
  port: number;
  close: () => Promise<void>;
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

export async function startServer(opts: StartServerOptions): Promise<ServerHandle> {
  const idleShutdownMs = opts.idleShutdownMs ?? DEFAULT_IDLE_SHUTDOWN_MS;

  const state: ServerState = {
    cwd: opts.cwd,
    claudeSessionId: opts.sessionId,
    clients: new Set(),
  };

  const wss = new WebSocketServer({ noServer: true, maxPayload: 1_048_576 });

  const ownsHttpServer = !opts.httpServer;
  const httpServer: HttpServer =
    opts.httpServer ??
    createHttpServer((_req, res) => {
      // Standalone mode: this HTTP server only exists to host the WS
      // upgrade. Any actual GET request gets a 404.
      res.statusCode = 404;
      res.end();
    });

  // Idle shutdown: when the last client disconnects, exit after this many
  // ms of inactivity. Set to 0 to disable.
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
      // Best-effort close, then exit. The CLI/script entry point relies on
      // this to release the port; tests that use this library directly can
      // pass `idleShutdownMs: 0` to opt out.
      wss.close();
      if (ownsHttpServer) httpServer.close();
      setTimeout(() => process.exit(0), 100).unref();
      setTimeout(() => process.exit(1), 5000).unref();
    }, idleShutdownMs);
  };

  wss.on("connection", (ws) => {
    const connectionId = randomUUID();
    const controllers = new Map<string, AbortController>();

    clearIdleTimer();
    state.clients.add(ws);

    send(ws, {
      type: "hello",
      protocol: PROTOCOL_VERSION,
      project: opts.cwd,
    });

    send(ws, { type: "session", session_id: state.claudeSessionId });

    void sendDiff(ws, opts.cwd);

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
          void sendDiff(ws, opts.cwd);
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

  const upgradeHandler = (req: IncomingMessage, socket: Socket, head: Buffer) => {
    if (req.url !== WS_PATH) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  };
  httpServer.on("upgrade", upgradeHandler);

  let resolvedPort: number;
  if (ownsHttpServer) {
    const desiredPort = opts.port ?? 0;
    const host = opts.host ?? DEFAULT_HOST;
    await new Promise<void>((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException) => {
        httpServer.off("listening", onListening);
        reject(err);
      };
      const onListening = () => {
        httpServer.off("error", onError);
        resolve();
      };
      httpServer.once("error", onError);
      httpServer.once("listening", onListening);
      httpServer.listen(desiredPort, host);
    });
    const addr = httpServer.address();
    if (addr === null || typeof addr === "string") {
      throw new Error("httpServer.address() returned unexpected value");
    }
    resolvedPort = addr.port;
  } else {
    const addr = httpServer.address();
    if (addr === null || typeof addr === "string") {
      throw new Error(
        "httpServer must be listening before being passed to startServer()",
      );
    }
    resolvedPort = addr.port;
  }

  opts.onListening?.(resolvedPort);
  // Arm the idle timer immediately so a server with zero connects also retires.
  armIdleTimer();

  return {
    port: resolvedPort,
    close: async () => {
      clearIdleTimer();
      httpServer.off("upgrade", upgradeHandler);
      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
      if (ownsHttpServer) {
        await new Promise<void>((resolve) => {
          httpServer.close(() => resolve());
        });
      }
    },
  };
}

