#!/usr/bin/env node
// `next build` writes to the default `.next/` distDir, the same directory a
// concurrently-running `next dev` in this checkout holds an exclusive lock on
// (`.next/trace` in particular, held for the dev server's entire lifetime, not
// just at startup — confirmed via a direct file-delete attempt while a live
// `next dev` was running: `EPERM`/`Permission denied`, not a transient race).
// This is the same `.next`-contention class as WGR-001/WGR-013
// (test-evidence/_register/WIRING_GAP_REGISTER.md) and next.config.mjs's
// PT_AUDIT_DIST_DIR escape hatch, just previously only reachable by manually
// setting that env var. This wrapper checks that lock signature up front so a
// dev server already running when the build starts (the common case, and the
// one observed live: a `next dev` holding the lock since before the build was
// invoked) goes straight to an isolated distDir instead of burning a whole
// doomed first `next build` pass first — under the multi-worktree memory
// contention cpus:1 above already documents, one full build can already be
// slow enough that a wasted, guaranteed-to-EPERM extra pass is what pushes
// the combined tsc+build gate past its 300s ceiling (observed directly: a
// `next dev` in this checkout predating the build by ~12 minutes, and the
// build gate timing out on the resulting two-full-build sequence). The
// post-hoc EPERM-in-output check remains as a fallback for the race where the
// lock appears mid-build (a dev server started after this script's own
// upfront check ran) — it never changes the distDir on a first, successful
// attempt, so `next start`/Vercel/Railway (which never run this alongside a
// `next dev`) are unaffected either way.
//
// The upfront check alone isn't sufficient: if `.next/trace` doesn't exist
// yet when this script starts (fresh/cleared .next dir) but a `next dev` in
// this checkout starts writing it while the build is mid-flight, the build
// has been observed to hang on Windows rather than exit with a clean EPERM —
// so waiting for the child process to exit before inspecting its output (the
// original spawnSync-only approach) never gets a chance to react. The first
// attempt below runs async and is polled for that same lock signature while
// it's still running, so a mid-build lock is caught and killed quickly
// instead of waited out past the gate's 300s ceiling. The post-hoc
// EPERM-in-output check remains as a fallback for the case where the build
// does exit cleanly with the error instead of hanging.
import { spawn, spawnSync } from "node:child_process";
import { openSync, closeSync } from "node:fs";

const LOCK_POLL_INTERVAL_MS = 3000;

function isTraceLocked() {
  try {
    closeSync(openSync(".next/trace", "r+"));
    return false;
  } catch (err) {
    return err.code === "EPERM";
  }
}

function killTree(pid) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"]);
  } else {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already exited
    }
  }
}

function runBuild(env) {
  return spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "build"], {
    stdio: ["inherit", "pipe", "pipe"],
    env,
    encoding: "utf8",
  });
}

function runWithIsolatedDistDir(reason) {
  const isolatedDistDir = `.next-build-${process.pid}`;
  process.stderr.write(`\n[build-with-lock-fallback] ${reason} Using isolated distDir=${isolatedDistDir}.\n\n`);
  const result = runBuild({ ...process.env, PT_AUDIT_DIST_DIR: isolatedDistDir });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  process.exit(result.status ?? 1);
}

if (isTraceLocked()) {
  runWithIsolatedDistDir(
    "Detected .next/trace already locked by a concurrent 'next dev' in this checkout before the build started (WGR-001/WGR-013 contention).",
  );
}

const first = spawn(process.execPath, ["node_modules/next/dist/bin/next", "build"], {
  stdio: ["inherit", "pipe", "pipe"],
  env: process.env,
});

let stdout = "";
let stderr = "";
first.stdout.on("data", (chunk) => {
  stdout += chunk;
  process.stdout.write(chunk);
});
first.stderr.on("data", (chunk) => {
  stderr += chunk;
  process.stderr.write(chunk);
});

let settled = false;

const poller = setInterval(() => {
  if (settled || !isTraceLocked()) {
    return;
  }
  settled = true;
  clearInterval(poller);
  killTree(first.pid);
  runWithIsolatedDistDir(
    "Detected a locked .next/trace (a concurrent 'next dev' in this checkout — WGR-001/WGR-013 contention) that appeared mid-build. Retrying once.",
  );
}, LOCK_POLL_INTERVAL_MS);

first.on("exit", (code) => {
  if (settled) {
    return;
  }
  settled = true;
  clearInterval(poller);

  const firstOutput = `${stdout}${stderr}`;
  const isLockContention =
    code !== 0 && /EPERM/.test(firstOutput) && /\.next[\\/]trace/.test(firstOutput);

  if (!isLockContention) {
    process.exit(code ?? 1);
  }

  runWithIsolatedDistDir(
    "Detected a locked .next/trace (a concurrent 'next dev' in this checkout — WGR-001/WGR-013 contention) that appeared during the build. Retrying once.",
  );
});
