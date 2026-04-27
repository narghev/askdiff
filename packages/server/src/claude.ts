import { spawn } from "node:child_process";
import type { AskMessage } from "@askdiff/protocol";

export class ClaudeCliError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = "ClaudeCliError";
  }
}

export interface StreamAnswerParams {
  cwd: string;
  sessionId: string;
  ask: AskMessage;
  signal: AbortSignal;
}

export async function* streamAnswer(
  params: StreamAnswerParams,
): AsyncGenerator<string, void, void> {
  const prompt = buildPrompt(params.ask);
  const model = params.ask.model ?? process.env["ASKDIFF_MODEL"];
  const args = buildArgs(params.sessionId, model);

  const child = spawn("claude", args, {
    cwd: params.cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const onAbort = () => {
    if (!child.killed) child.kill("SIGTERM");
  };
  params.signal.addEventListener("abort", onAbort);

  const stderrChunks: string[] = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderrChunks.push(chunk);
  });

  const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve) => {
      child.on("close", (code, sig) => resolve({ code, signal: sig }));
    },
  );

  child.stdin.end(prompt);

  try {
    child.stdout.setEncoding("utf8");
    let buffer = "";
    for await (const chunk of child.stdout) {
      buffer += chunk as string;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const delta = extractTextDelta(line);
        if (delta !== null) yield delta;
        newline = buffer.indexOf("\n");
      }
    }
    if (buffer.length > 0) {
      const delta = extractTextDelta(buffer);
      if (delta !== null) yield delta;
    }

    const { code } = await exitPromise;
    if (params.signal.aborted) return;
    if (code !== 0) {
      const stderr = stderrChunks.join("").trim().slice(-500);
      throw new ClaudeCliError(
        `claude exited with code ${code}${stderr ? `: ${stderr}` : ""}`,
      );
    }
  } finally {
    params.signal.removeEventListener("abort", onAbort);
    if (!child.killed) child.kill("SIGTERM");
  }
}

const buildArgs = (sessionId: string, model: string | undefined): string[] => {
  const args = [
    "-p",                          // print mode: non-interactive, exits after one response
    "--resume", sessionId,         // re-hydrate the session that wrote the code; new turns append to it
    "--output-format", "stream-json", // emit one JSON event per line for streaming parse
    "--include-partial-messages",  // emit content_block_delta events with token-by-token text
    "--verbose",                   // required by --output-format=stream-json under -p
  ];
  if (model) args.push("--model", model); // optional override; otherwise inherits the session's model
  return args;
}

const buildPrompt = (ask: AskMessage): string => {
  return `I'm reviewing your changes in a diff viewer. Your prior edits in this session are already in your context — only verify with Read or git if you suspect external modifications.

Question about \`${ask.file}\` lines ${ask.from_line}-${ask.to_line}:

\`\`\`
${ask.chunk}
\`\`\`

${ask.question}`;
}

const extractTextDelta = (line: string): string | null => {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isRecord(obj)) return null;
  if (obj["type"] !== "stream_event") return null;
  const event = obj["event"];
  if (!isRecord(event)) return null;
  if (event["type"] !== "content_block_delta") return null;
  const delta = event["delta"];
  if (!isRecord(delta)) return null;
  if (delta["type"] !== "text_delta") return null;
  const text = delta["text"];
  return typeof text === "string" ? text : null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
