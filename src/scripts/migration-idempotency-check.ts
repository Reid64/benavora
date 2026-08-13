// Compatibility shim. The real migration idempotency harness lives at
// scripts/check-migration-idempotency.ts (see MIGRATION_IDEMPOTENCY_AUDIT.md,
// STATE_OF_THE_BUILD.md, and the `check:migrations` / `check:migrations:dry-run`
// scripts in package.json) — this file is not a second implementation, it
// just re-runs that one so tooling expecting this path still works. Spawned
// as a subprocess (rather than statically imported) so this file — which,
// unlike `scripts/`, is part of the tsc project — never pulls the real
// script's implementation into this project's type-check graph.
import { spawnSync } from "node:child_process";
import path from "node:path";

const target = path.resolve(__dirname, "..", "..", "scripts", "check-migration-idempotency.ts");

const result = spawnSync("npx", ["tsx", target, ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
