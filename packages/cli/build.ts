import { build } from "esbuild";
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "dist");
const uiDistDir = join(__dirname, "..", "ui-browser", "dist");

rmSync(distDir, { recursive: true, force: true });

await build({
  entryPoints: [join(__dirname, "src/index.ts")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: join(distDir, "index.js"),
  banner: { js: "#!/usr/bin/env node" },
  external: ["commander", "open", "ws", "zod"],
  treeShaking: true,
  minifySyntax: true,
});

if (!existsSync(uiDistDir)) {
  console.error(
    `error: UI bundle not found at ${uiDistDir}. Run \`pnpm --filter @askdiff/ui-browser build\` first.`,
  );
  process.exit(1);
}
cpSync(uiDistDir, join(distDir, "ui"), { recursive: true });

console.log("CLI bundle written to", distDir);
