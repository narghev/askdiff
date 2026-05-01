import { execSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

execSync("pnpm --filter @askdiff/ui-browser build", { stdio: "inherit", cwd: root });
execSync("pnpm --filter askdiff run build", { stdio: "inherit", cwd: root });

const readme = resolve(root, "README.md");
if (existsSync(readme)) {
  copyFileSync(readme, resolve(root, "packages/cli/README.md"));
}

console.log("\nbuild complete. tarball ready in packages/cli/.");
