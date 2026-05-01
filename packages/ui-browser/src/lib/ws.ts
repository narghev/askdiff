import {
  ServerMessageSchema,
  type ClientMessage,
  type ServerMessage,
} from "@askdiff/protocol";
import { useStore } from "./store";

const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000];
const PING_INTERVAL_MS = 25000;

// Same-origin WS URL. In production the Node server hosts both the UI
// and the WebSocket on one port; in dev Vite proxies `/ws` to the
// askdiff server (configured via `ASKDIFF_DEV_WS_TARGET` in vite.config).
const wsUrl = (): string => {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
};

type Connection = {
  socket: WebSocket;
  pingTimer: ReturnType<typeof setInterval>;
};

let current: Connection | null = null;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let stopped = false;

const send = (msg: ClientMessage) => {
  if (current && current.socket.readyState === WebSocket.OPEN) {
    current.socket.send(JSON.stringify(msg));
  } else {
    useStore.getState().pushToast("Not connected to askdiff server");
  }
};

const dispatch = (msg: ServerMessage) => {
  const s = useStore.getState();
  switch (msg.type) {
    case "hello":
      s.setProtocol(msg.protocol);
      s.setProject(msg.project);
      return;
    case "session":
      s.setSessionId(msg.session_id);
      return;
    case "diff":
      s.setDiff(msg.raw, msg.files);
      return;
    case "chunk":
      s.appendChunk(msg.id, msg.delta);
      return;
    case "done":
      s.finishAsk(msg.id, "done");
      return;
    case "error":
      if (msg.id) {
        s.finishAsk(msg.id, "error", msg.message);
      } else {
        s.pushToast(msg.message);
      }
      return;
    case "pong":
      return;
  }
};

const handleMessage = (raw: string) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    useStore
      .getState()
      .pushToast(
        `Bad JSON from server: ${err instanceof Error ? err.message : String(err)}`,
      );
    return;
  }
  const result = ServerMessageSchema.safeParse(parsed);
  if (!result.success) {
    useStore
      .getState()
      .pushToast(`Unrecognized server message: ${result.error.message}`);
    return;
  }
  dispatch(result.data);
};

const teardown = () => {
  if (current) {
    clearInterval(current.pingTimer);
    try {
      current.socket.close();
    } catch {
      // already closing
    }
    current = null;
  }
};

const scheduleReconnect = () => {
  if (stopped) return;
  if (reconnectTimer) return;
  const delay =
    RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)] ??
    10000;
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
};

export const connect = () => {
  stopped = false;
  teardown();
  const url = wsUrl();
  useStore.getState().setConn({ state: "connecting" });
  const socket = new WebSocket(url);

  socket.addEventListener("open", () => {
    reconnectAttempt = 0;
    useStore.getState().setConn({ state: "open" });
  });

  socket.addEventListener("message", (ev) => {
    if (typeof ev.data === "string") handleMessage(ev.data);
  });

  socket.addEventListener("error", () => {
    useStore.getState().setConn({ state: "error", error: `connect failed: ${url}` });
  });

  socket.addEventListener("close", (ev) => {
    useStore
      .getState()
      .setConn({ state: "closed", reason: ev.reason || "socket closed" });
    teardown();
    scheduleReconnect();
  });

  const pingTimer = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "ping" } satisfies ClientMessage));
    }
  }, PING_INTERVAL_MS);

  current = { socket, pingTimer };
  useStore.getState().setSend(send);
};

export const disconnect = () => {
  stopped = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  teardown();
};
