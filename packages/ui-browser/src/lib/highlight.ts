import refractor from "refractor/core";
import type { RefractorSyntax } from "refractor/core";

/**
 * Languages we ship with. Vite picks up these bare-module imports and
 * pre-bundles them through its CJS interop, so each one becomes a lazy
 * chunk that registers cleanly into refractor at runtime. The
 * `import.meta.glob('/node_modules/...')` shortcut would *look* shorter
 * but Vite serves those raw via `@fs/` without the CJS-to-ESM transform,
 * so the dynamic imports fail silently in dev.
 *
 * Adding a new language: drop a line below and an alias in `ALIASES` if
 * the file extension doesn't already match the canonical id.
 */
const loaders: Record<string, () => Promise<{ default: RefractorSyntax }>> = {
  bash: () => import("refractor/lang/bash"),
  c: () => import("refractor/lang/c"),
  clojure: () => import("refractor/lang/clojure"),
  cpp: () => import("refractor/lang/cpp"),
  csharp: () => import("refractor/lang/csharp"),
  css: () => import("refractor/lang/css"),
  dart: () => import("refractor/lang/dart"),
  diff: () => import("refractor/lang/diff"),
  docker: () => import("refractor/lang/docker"),
  elixir: () => import("refractor/lang/elixir"),
  erlang: () => import("refractor/lang/erlang"),
  go: () => import("refractor/lang/go"),
  graphql: () => import("refractor/lang/graphql"),
  groovy: () => import("refractor/lang/groovy"),
  haskell: () => import("refractor/lang/haskell"),
  ini: () => import("refractor/lang/ini"),
  java: () => import("refractor/lang/java"),
  javascript: () => import("refractor/lang/javascript"),
  json: () => import("refractor/lang/json"),
  jsx: () => import("refractor/lang/jsx"),
  kotlin: () => import("refractor/lang/kotlin"),
  less: () => import("refractor/lang/less"),
  lua: () => import("refractor/lang/lua"),
  makefile: () => import("refractor/lang/makefile"),
  markdown: () => import("refractor/lang/markdown"),
  markup: () => import("refractor/lang/markup"),
  nginx: () => import("refractor/lang/nginx"),
  objectivec: () => import("refractor/lang/objectivec"),
  perl: () => import("refractor/lang/perl"),
  php: () => import("refractor/lang/php"),
  powershell: () => import("refractor/lang/powershell"),
  python: () => import("refractor/lang/python"),
  r: () => import("refractor/lang/r"),
  ruby: () => import("refractor/lang/ruby"),
  rust: () => import("refractor/lang/rust"),
  sass: () => import("refractor/lang/sass"),
  scala: () => import("refractor/lang/scala"),
  scss: () => import("refractor/lang/scss"),
  sql: () => import("refractor/lang/sql"),
  swift: () => import("refractor/lang/swift"),
  toml: () => import("refractor/lang/toml"),
  tsx: () => import("refractor/lang/tsx"),
  typescript: () => import("refractor/lang/typescript"),
  yaml: () => import("refractor/lang/yaml"),
};

/**
 * Aliases from a fence/extension to a canonical refractor language id.
 * Anything else is looked up by its lowercase form directly.
 */
const ALIASES: Record<string, string> = {
  ts: "typescript",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsonc: "json",
  md: "markdown",
  mdx: "markdown",
  htm: "markup",
  html: "markup",
  xml: "markup",
  svg: "markup",
  yml: "yaml",
  py: "python",
  rs: "rust",
  golang: "go",
  kt: "kotlin",
  kts: "kotlin",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  rb: "ruby",
  cs: "csharp",
  "c++": "cpp",
  cc: "cpp",
  hpp: "cpp",
  hxx: "cpp",
  h: "c",
  gql: "graphql",
  dockerfile: "docker",
  ps1: "powershell",
  m: "objectivec",
  mm: "objectivec",
};

const resolveId = (alias: string): string => {
  const lower = alias.toLowerCase();
  return ALIASES[lower] ?? lower;
};

const inflight = new Map<string, Promise<void>>();

const ensure = (id: string): Promise<void> | null => {
  const load = loaders[id];
  if (!load) return null;
  let p = inflight.get(id);
  if (!p) {
    p = load().then((m) => {
      refractor.register(m.default);
    });
    // Clear on failure so the next caller retries rather than getting a
    // permanently cached rejection.
    p.catch(() => inflight.delete(id));
    inflight.set(id, p);
  }
  return p;
};

const extOf = (path: string): string => {
  const lower = path.toLowerCase();
  if (lower === "dockerfile" || lower.endsWith("/dockerfile")) return "dockerfile";
  const dot = lower.lastIndexOf(".");
  return dot < 0 ? "" : lower.slice(dot + 1);
};

type Resolved = { refractor: typeof refractor; language: string };

const resolve = async (alias: string): Promise<Resolved | null> => {
  const id = resolveId(alias);
  const p = ensure(id);
  if (!p) return null;
  try {
    await p;
  } catch {
    return null;
  }
  return { refractor, language: id };
};

/** Resolve from a markdown fence alias (e.g. `"ts"`, `"rust"`). */
export const resolveLanguageByAlias = (alias: string) => resolve(alias);

/** Resolve from a file path; uses the file extension. */
export const resolveLanguageForPath = (path: string) => resolve(extOf(path));
