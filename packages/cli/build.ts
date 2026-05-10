import { build } from "esbuild";
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "dist");
const uiDistDir = join(__dirname, "..", "ui-browser", "dist");
const skillSrc = resolve(
  __dirname,
  "..",
  "..",
  ".claude",
  "skills",
  "askdiff",
  "SKILL.md",
);
const pkgPath = join(__dirname, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };

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

if (!existsSync(skillSrc)) {
  console.error(`error: SKILL.md not found at ${skillSrc}`);
  process.exit(1);
}
// Substitute every `ASKDIFF_VERSION="latest"` (Step 4c + Step 5) with this
// build's exact version so the published skill pins to a known release. The
// in-repo source stays "latest" so /askdiff in this repo always pulls newest.
const skillBody = readFileSync(skillSrc, "utf8").replace(
  /ASKDIFF_VERSION="latest"/g,
  `ASKDIFF_VERSION="${pkg.version}"`,
);
writeFileSync(join(distDir, "skill.md"), skillBody);

console.log("CLI bundle written to", distDir);
