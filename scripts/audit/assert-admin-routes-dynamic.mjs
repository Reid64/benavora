#!/usr/bin/env node
// Fails the build early if any src/app file imports createAdminClient without
// also declaring `export const dynamic = "force-dynamic"`. Without it, `next
// build` prerenders the route at build time, calling createAdminClient()
// before SUPABASE_SERVICE_ROLE_KEY is guaranteed to exist (CI's placeholder
// value only satisfies the constructor, never a real query) and throwing.
// See AR-8.1 / STATE_OF_THE_BUILD.md for the incident this prevents.
//
// Runs before `pnpm build` in .github/workflows/deploy-check.yml so this
// class of failure surfaces in seconds, not after a multi-minute build.

import { readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const APP_ROOT = join(process.cwd(), "src", "app");
const IMPORT_PATTERN = /createAdminClient/;
const DYNAMIC_PATTERN = /^export const dynamic\s*=/m;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(APP_ROOT);
const violations = [];
let callerCount = 0;

for (const file of files) {
  const content = readFileSync(file, "utf8");
  if (!IMPORT_PATTERN.test(content)) continue;
  callerCount++;
  if (!DYNAMIC_PATTERN.test(content)) {
    violations.push(file);
  }
}

if (violations.length > 0) {
  console.error(
    `ADMIN ROUTE DYNAMIC EXPORT CHECK FAILED: ${violations.length} file(s) call createAdminClient() without \`export const dynamic = "force-dynamic"\`:\n`,
  );
  for (const file of violations) {
    console.error(`  - ${file.replace(process.cwd(), "").replace(/^[\\/]/, "")}`);
  }
  console.error(
    "\nAdd `export const dynamic = \"force-dynamic\";` to each file above. A route " +
      "using the service-role client is per-request and tenant-scoped - there is no " +
      "valid reason to prerender one, and prerendering it will throw in CI where " +
      "SUPABASE_SERVICE_ROLE_KEY is a placeholder.",
  );
  process.exit(1);
}

console.log(
  `Admin route dynamic export check passed (${callerCount} createAdminClient callers, all dynamic).`,
);
