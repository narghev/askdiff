import type { ClientMessage, DiffFile } from "@askdiff/protocol";
import { create } from "zustand";

export type ConnectionState =
  | { state: "idle" }
  | { state: "connecting" }
  | { state: "open" }
  | { state: "closed"; reason?: string }
  | { state: "error"; error: string };

export type AskStatus = "streaming" | "done" | "error" | "cancelled";

export type Ask = {
  id: string;
  file: string;
  fromLine: number;
  toLine: number;
  chunk: string;
  question: string;
  status: AskStatus;
  response: string;
  error?: string;
};

export type AskInput = {
  file: string;
  fromLine: number;
  toLine: number;
  chunk: string;
  question: string;
};

export type Toast = { id: string; message: string };

type Store = {
  // connection
  conn: ConnectionState;
  protocol?: string;
  project?: string;
  sessionId: string | null;

  // diff
  diff?: { raw: string; files: DiffFile[] };
  selectedFile?: string;

  // per-file UI state (path → flag)
  fileViewed: Record<string, boolean>;
  fileCollapsed: Record<string, boolean>;

  // file-tree sidebar: dir path → collapsed? (default expanded)
  treeCollapsed: Record<string, boolean>;

  // bumped to ask DiffPane to scroll a file into view
  scrollRequest?: { path: string; nonce: number };

  // asks
  asks: Record<string, Ask>;
  askOrder: string[];

  openAnchors: Record<string, { fromLine: number; toLine: number; chunk: string }>;

  // toasts
  toasts: Toast[];

  setSend: (fn: (msg: ClientMessage) => void) => void;
  _send: (msg: ClientMessage) => void;

  // server-message hooks (called by ws.ts)
  setConn: (c: ConnectionState) => void;
  setProtocol: (p: string) => void;
  setProject: (p: string) => void;
  setSessionId: (sid: string | null) => void;
  setDiff: (raw: string, files: DiffFile[]) => void;
  selectFile: (path: string) => void;
  toggleViewed: (path: string) => void;
  toggleCollapsed: (path: string) => void;
  toggleTreeNode: (path: string) => void;
  requestScrollTo: (path: string) => void;
  appendChunk: (askId: string, delta: string) => void;
  finishAsk: (askId: string, outcome: "done" | "error", message?: string) => void;
  pushToast: (message: string) => void;
  dismissToast: (id: string) => void;

  // user actions
  openComposer: (input: {
    file: string;
    fromLine: number;
    toLine: number;
    chunk: string;
  }) => void;
  closeComposer: (file: string, fromLine: number) => void;
  startAsk: (input: AskInput) => string;
  cancel: (askId: string) => void;
  setSession: (sid: string) => void;
};

const pickKnown = (
  src: Record<string, boolean>,
  known: Set<string>,
): Record<string, boolean> => {
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(src)) {
    if (known.has(k)) out[k] = v;
  }
  return out;
};

const newId = () =>
  globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const toAskMessage = (ask: Ask): ClientMessage => ({
  type: "ask",
  id: ask.id,
  file: ask.file,
  from_line: ask.fromLine,
  to_line: ask.toLine,
  chunk: ask.chunk,
  question: ask.question,
});

export const useStore = create<Store>((set, get) => ({
  conn: { state: "idle" },
  sessionId: null,
  asks: {},
  askOrder: [],
  openAnchors: {},
  fileViewed: {},
  fileCollapsed: {},
  treeCollapsed: {},
  toasts: [],
  _send: () => {
    get().pushToast("Not connected to askdiff server");
  },

  setSend: (fn) => set({ _send: fn }),
  setConn: (c) => set({ conn: c }),
  setProtocol: (p) => set({ protocol: p }),
  setProject: (p) => set({ project: p }),
  setSessionId: (sid) => set({ sessionId: sid }),

  setDiff: (raw, files) => {
    const s = get();
    const prev = s.selectedFile;
    const stillExists = prev !== undefined && files.some((f) => f.path === prev);
    const next: Partial<Store> = { diff: { raw, files } };
    if (stillExists) {
      next.selectedFile = prev;
    } else {
      const first = files[0]?.path;
      if (first !== undefined) next.selectedFile = first;
    }
    // Drop per-file UI flags for files no longer in the diff. Preserving
    // entries for files still present means review progress survives the
    // server re-sending the same diff (e.g. on reconnect).
    const paths = new Set(files.map((f) => f.path));
    next.fileViewed = pickKnown(s.fileViewed, paths);
    next.fileCollapsed = pickKnown(s.fileCollapsed, paths);
    set(next);
  },

  selectFile: (path) => set({ selectedFile: path }),

  toggleViewed: (path) =>
    set((s) => {
      const willBeViewed = !(s.fileViewed[path] ?? false);
      return {
        fileViewed: { ...s.fileViewed, [path]: willBeViewed },
        // Match GitHub: marking a file viewed also collapses it.
        // Unmarking does not auto-expand — the user can do that explicitly.
        fileCollapsed: willBeViewed
          ? { ...s.fileCollapsed, [path]: true }
          : s.fileCollapsed,
      };
    }),

  toggleCollapsed: (path) =>
    set((s) => ({
      fileCollapsed: {
        ...s.fileCollapsed,
        [path]: !(s.fileCollapsed[path] ?? false),
      },
    })),

  toggleTreeNode: (path) =>
    set((s) => ({
      treeCollapsed: {
        ...s.treeCollapsed,
        [path]: !(s.treeCollapsed[path] ?? false),
      },
    })),

  requestScrollTo: (path) =>
    set((s) => ({
      selectedFile: path,
      scrollRequest: { path, nonce: (s.scrollRequest?.nonce ?? 0) + 1 },
    })),

  appendChunk: (askId, delta) =>
    set((s) => {
      const ask = s.asks[askId];
      if (!ask || ask.status !== "streaming") return s;
      return {
        asks: { ...s.asks, [askId]: { ...ask, response: ask.response + delta } },
      };
    }),

  finishAsk: (askId, outcome, message) =>
    set((s) => {
      const ask = s.asks[askId];
      if (!ask || ask.status !== "streaming") return s;
      const status: AskStatus = outcome === "done" ? "done" : "error";
      return {
        asks: {
          ...s.asks,
          [askId]: {
            ...ask,
            status,
            ...(message !== undefined ? { error: message } : {}),
          },
        },
      };
    }),

  pushToast: (message) =>
    set((s) => ({ toasts: [...s.toasts, { id: newId(), message }] })),
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  openComposer: ({ file, fromLine, toLine, chunk }) =>
    set((s) => ({
      openAnchors: {
        ...s.openAnchors,
        [`${file}:${String(fromLine)}`]: { fromLine, toLine, chunk },
      },
    })),
  closeComposer: (file, fromLine) =>
    set((s) => {
      const key = `${file}:${String(fromLine)}`;
      if (!(key in s.openAnchors)) return s;
      const next = { ...s.openAnchors };
      delete next[key];
      return { openAnchors: next };
    }),

  startAsk: (input) => {
    const id = newId();
    const ask: Ask = {
      id,
      file: input.file,
      fromLine: input.fromLine,
      toLine: input.toLine,
      chunk: input.chunk,
      question: input.question,
      status: "streaming",
      response: "",
    };
    set((s) => ({
      asks: { ...s.asks, [id]: ask },
      askOrder: [...s.askOrder, id],
    }));
    get()._send(toAskMessage(ask));
    return id;
  },

  cancel: (askId) => {
    const ask = get().asks[askId];
    if (!ask || ask.status !== "streaming") return;
    get()._send({ type: "cancel", id: askId });
    set((s) => ({
      asks: { ...s.asks, [askId]: { ...ask, status: "cancelled" } },
    }));
  },

  setSession: (sid) => {
    get()._send({ type: "set_session", session_id: sid });
  },
}));
