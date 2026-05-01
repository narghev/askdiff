import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const UI_DIR = resolve(__dirname, "ui");
const INDEX_HTML = join(UI_DIR, "index.html");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * HTTP server that serves the bundled UI (`dist/ui/`) from disk and
 * leaves WS upgrades to the caller (`startServer({ httpServer })`
 * attaches its own `upgrade` listener). Falls back to `index.html` for
 * paths that don't map to a file, so client-side routing keeps working.
 */
export function createUiHttpServer(): HttpServer {
  return createServer((req, res) => {
    void handle(req, res);
  });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end();
    return;
  }

  const urlPath = (req.url ?? "/").split("?")[0] ?? "/";
  const safe = safeJoin(UI_DIR, urlPath);
  if (safe === null) {
    res.writeHead(403);
    res.end();
    return;
  }

  const filePath = await resolveFile(safe);
  if (filePath === null) {
    res.writeHead(404);
    res.end();
    return;
  }

  const ext = extname(filePath).toLowerCase();
  const type = MIME[ext] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(filePath).pipe(res);
}

function safeJoin(base: string, urlPath: string): string | null {
  // Strip any leading slashes, then normalize to prevent `..` escapes.
  const decoded = (() => {
    try {
      return decodeURIComponent(urlPath);
    } catch {
      return null;
    }
  })();
  if (decoded === null) return null;
  const cleaned = decoded.replace(/^\/+/, "");
  const joined = normalize(join(base, cleaned));
  if (joined !== base && !joined.startsWith(base + sep)) return null;
  return joined;
}

async function resolveFile(candidate: string): Promise<string | null> {
  try {
    const s = await stat(candidate);
    if (s.isFile()) return candidate;
    if (s.isDirectory()) {
      const indexed = join(candidate, "index.html");
      const sIdx = await stat(indexed).catch(() => null);
      if (sIdx?.isFile()) return indexed;
    }
  } catch {
    // not found — fall through to SPA fallback
  }
  // SPA fallback
  try {
    const s = await stat(INDEX_HTML);
    if (s.isFile()) return INDEX_HTML;
  } catch {
    // no UI bundle present
  }
  return null;
}
