import { describe, expect, it } from "@jest/globals";
import {
  AskMessageSchema,
  CancelMessageSchema,
  ChunkMessageSchema,
  ClientMessageSchema,
  DiffFileSchema,
  DiffHunkSchema,
  DiffMessageSchema,
  DiffRequestMessageSchema,
  DoneMessageSchema,
  ErrorMessageSchema,
  HelloMessageSchema,
  PingMessageSchema,
  PongMessageSchema,
  PROTOCOL_VERSION,
  ServerMessageSchema,
  SessionMessageSchema,
  SetSessionMessageSchema,
  parseClientMessage,
} from "./schemas";

describe("PROTOCOL_VERSION", () => {
  it("is the v1 wire identifier", () => {
    expect(PROTOCOL_VERSION).toBe("askdiff/1");
  });
});

describe("AskMessageSchema", () => {
  const valid = {
    type: "ask",
    id: "q1",
    file: "src/foo.ts",
    from_line: 10,
    to_line: 20,
    chunk: "const x = 1;",
    question: "why?",
  };

  it("accepts a minimal ask", () => {
    const result = AskMessageSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("accepts an optional model override", () => {
    const result = AskMessageSchema.safeParse({ ...valid, model: "claude-opus-4-7" });
    expect(result.success).toBe(true);
  });

  it("rejects empty id", () => {
    const result = AskMessageSchema.safeParse({ ...valid, id: "" });
    expect(result.success).toBe(false);
  });

  it("rejects empty question", () => {
    const result = AskMessageSchema.safeParse({ ...valid, question: "" });
    expect(result.success).toBe(false);
  });

  it("rejects negative line numbers", () => {
    const result = AskMessageSchema.safeParse({ ...valid, from_line: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer line numbers", () => {
    const result = AskMessageSchema.safeParse({ ...valid, from_line: 1.5 });
    expect(result.success).toBe(false);
  });

  it("rejects empty model when provided", () => {
    const result = AskMessageSchema.safeParse({ ...valid, model: "" });
    expect(result.success).toBe(false);
  });
});

describe("CancelMessageSchema", () => {
  it("requires id", () => {
    expect(CancelMessageSchema.safeParse({ type: "cancel" }).success).toBe(false);
    expect(CancelMessageSchema.safeParse({ type: "cancel", id: "" }).success).toBe(false);
    expect(CancelMessageSchema.safeParse({ type: "cancel", id: "q1" }).success).toBe(true);
  });
});

describe("DiffRequestMessageSchema", () => {
  it("accepts the bare type literal", () => {
    expect(DiffRequestMessageSchema.safeParse({ type: "diff_request" }).success).toBe(true);
  });
});

describe("PingMessageSchema", () => {
  it("accepts the bare type literal", () => {
    expect(PingMessageSchema.safeParse({ type: "ping" }).success).toBe(true);
  });
});

describe("SetSessionMessageSchema", () => {
  it("requires a non-empty session_id", () => {
    expect(SetSessionMessageSchema.safeParse({ type: "set_session" }).success).toBe(false);
    expect(SetSessionMessageSchema.safeParse({ type: "set_session", session_id: "" }).success).toBe(false);
    expect(SetSessionMessageSchema.safeParse({ type: "set_session", session_id: "uuid" }).success).toBe(true);
  });
});

describe("ClientMessageSchema (discriminated union)", () => {
  it.each([
    ["ask", { type: "ask", id: "q1", file: "f", from_line: 0, to_line: 0, chunk: "", question: "?" }],
    ["cancel", { type: "cancel", id: "q1" }],
    ["diff_request", { type: "diff_request" }],
    ["ping", { type: "ping" }],
    ["set_session", { type: "set_session", session_id: "x" }],
  ])("accepts %s", (_label, msg) => {
    expect(ClientMessageSchema.safeParse(msg).success).toBe(true);
  });

  it("rejects an unknown type", () => {
    expect(ClientMessageSchema.safeParse({ type: "unknown" }).success).toBe(false);
  });

  it("rejects a missing type", () => {
    expect(ClientMessageSchema.safeParse({ id: "q1" }).success).toBe(false);
  });
});

describe("parseClientMessage", () => {
  it("parses a JSON string", () => {
    const raw = JSON.stringify({ type: "ping" });
    const result = parseClientMessage(raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("ping");
  });

  it("accepts already-parsed objects", () => {
    const result = parseClientMessage({ type: "ping" });
    expect(result.ok).toBe(true);
  });

  it("returns error on malformed JSON", () => {
    const result = parseClientMessage("{not json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/invalid JSON/);
  });

  it("returns error on schema violation with field path", () => {
    const result = parseClientMessage({ type: "ask", id: "q1" });
    expect(result.ok).toBe(false);
    // Error string should mention field paths so clients can debug.
    if (!result.ok) expect(result.error).toMatch(/file|from_line|to_line|chunk|question/);
  });

  it("returns error on unknown message type", () => {
    const result = parseClientMessage({ type: "ascii_art" });
    expect(result.ok).toBe(false);
  });
});

describe("DiffHunkSchema", () => {
  it("accepts a complete hunk", () => {
    expect(
      DiffHunkSchema.safeParse({ from_line: 10, to_line: 15, content: "..." }).success,
    ).toBe(true);
  });

  it("accepts zero line numbers (deletion-only hunk)", () => {
    expect(DiffHunkSchema.safeParse({ from_line: 0, to_line: 0, content: "" }).success).toBe(true);
  });

  it("rejects negative line numbers", () => {
    expect(DiffHunkSchema.safeParse({ from_line: -1, to_line: 0, content: "" }).success).toBe(false);
  });
});

describe("DiffFileSchema", () => {
  it("accepts a file with multiple hunks", () => {
    const result = DiffFileSchema.safeParse({
      path: "src/foo.ts",
      hunks: [
        { from_line: 1, to_line: 5, content: "..." },
        { from_line: 20, to_line: 22, content: "..." },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a file with empty hunks (pure rename)", () => {
    expect(DiffFileSchema.safeParse({ path: "src/foo.ts", hunks: [] }).success).toBe(true);
  });
});

describe("HelloMessageSchema", () => {
  it("requires the canonical protocol literal", () => {
    expect(
      HelloMessageSchema.safeParse({ type: "hello", protocol: PROTOCOL_VERSION, project: "/p" })
        .success,
    ).toBe(true);
    expect(
      HelloMessageSchema.safeParse({ type: "hello", protocol: "askdiff/2", project: "/p" }).success,
    ).toBe(false);
  });

  it("rejects missing project", () => {
    expect(
      HelloMessageSchema.safeParse({ type: "hello", protocol: PROTOCOL_VERSION }).success,
    ).toBe(false);
  });
});

describe("DiffMessageSchema", () => {
  it("accepts an empty diff payload", () => {
    expect(DiffMessageSchema.safeParse({ type: "diff", raw: "", files: [] }).success).toBe(true);
  });

  it("accepts a populated diff payload", () => {
    const result = DiffMessageSchema.safeParse({
      type: "diff",
      raw: "diff --git a/x b/x\n",
      files: [{ path: "x", hunks: [] }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts an optional label", () => {
    const result = DiffMessageSchema.safeParse({
      type: "diff",
      raw: "",
      files: [],
      label: "HEAD~1..HEAD",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-string label", () => {
    const result = DiffMessageSchema.safeParse({
      type: "diff",
      raw: "",
      files: [],
      label: 42,
    });
    expect(result.success).toBe(false);
  });
});

describe("ChunkMessageSchema", () => {
  it("requires id and delta", () => {
    expect(ChunkMessageSchema.safeParse({ type: "chunk", id: "q1", delta: "hi" }).success).toBe(true);
    expect(ChunkMessageSchema.safeParse({ type: "chunk", id: "", delta: "hi" }).success).toBe(false);
    expect(ChunkMessageSchema.safeParse({ type: "chunk", id: "q1" }).success).toBe(false);
  });

  it("accepts an empty delta string", () => {
    expect(ChunkMessageSchema.safeParse({ type: "chunk", id: "q1", delta: "" }).success).toBe(true);
  });
});

describe("DoneMessageSchema", () => {
  it("requires id", () => {
    expect(DoneMessageSchema.safeParse({ type: "done", id: "q1" }).success).toBe(true);
    expect(DoneMessageSchema.safeParse({ type: "done" }).success).toBe(false);
  });
});

describe("ErrorMessageSchema", () => {
  it("accepts an error with id (per-ask)", () => {
    expect(ErrorMessageSchema.safeParse({ type: "error", id: "q1", message: "boom" }).success).toBe(true);
  });

  it("accepts an error without id (general)", () => {
    expect(ErrorMessageSchema.safeParse({ type: "error", message: "boom" }).success).toBe(true);
  });

  it("rejects empty id when present", () => {
    expect(ErrorMessageSchema.safeParse({ type: "error", id: "", message: "boom" }).success).toBe(false);
  });

  it("rejects missing message", () => {
    expect(ErrorMessageSchema.safeParse({ type: "error" }).success).toBe(false);
  });
});

describe("PongMessageSchema", () => {
  it("accepts the bare type literal", () => {
    expect(PongMessageSchema.safeParse({ type: "pong" }).success).toBe(true);
  });
});

describe("SessionMessageSchema", () => {
  it("accepts a UUID session_id", () => {
    expect(
      SessionMessageSchema.safeParse({ type: "session", session_id: "abc" }).success,
    ).toBe(true);
  });

  it("accepts an explicit null (no session configured)", () => {
    expect(SessionMessageSchema.safeParse({ type: "session", session_id: null }).success).toBe(true);
  });

  it("rejects missing session_id field", () => {
    expect(SessionMessageSchema.safeParse({ type: "session" }).success).toBe(false);
  });
});

describe("ServerMessageSchema (discriminated union)", () => {
  it.each([
    ["hello", { type: "hello", protocol: PROTOCOL_VERSION, project: "/p" }],
    ["diff", { type: "diff", raw: "", files: [] }],
    ["chunk", { type: "chunk", id: "q1", delta: "hi" }],
    ["done", { type: "done", id: "q1" }],
    ["error", { type: "error", message: "x" }],
    ["pong", { type: "pong" }],
    ["session", { type: "session", session_id: null }],
  ])("accepts %s", (_label, msg) => {
    expect(ServerMessageSchema.safeParse(msg).success).toBe(true);
  });

  it("rejects an unknown type", () => {
    expect(ServerMessageSchema.safeParse({ type: "unknown" }).success).toBe(false);
  });
});
