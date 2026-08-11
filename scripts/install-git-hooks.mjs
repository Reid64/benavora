// Installs tracked git hooks from .githooks/ into .git/hooks/.
// Runs automatically via package.json's "prepare" script on every `pnpm install`.
// Safe to run multiple times; safe in CI (no .git/hooks dir there — skips silently).

import { copyFileSync, chmodSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const sourceDir = join(process.cwd(), ".githooks");
const targetDir = join(process.cwd(), ".git", "hooks");

if (!existsSync(sourceDir) || !existsSync(targetDir)) {
  process.exit(0);
}

for (const hookName of readdirSync(sourceDir)) {
  const source = join(sourceDir, hookName);
  const target = join(targetDir, hookName);
  copyFileSync(source, target);
  chmodSync(target, 0o755);
  console.log(`installed git hook: ${hookName}`);
}
