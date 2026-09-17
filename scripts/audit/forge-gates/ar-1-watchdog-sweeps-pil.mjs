// FORGE shell-gate assertion for AR-1.1.
// A gate as a real file, not an inline `node -e` string: the queue YAML ->
// PowerShell temp script -> node argv path mangles nested quotes, which
// silently turned this class of gate into a guaranteed SyntaxError FAIL on
// 2026-09-17. Exit 0 = pass, non-zero = fail.
import { readFileSync } from "fs";
const src = readFileSync("worker/stuck-run-watchdog.ts", "utf8");
if (!src.includes("pil_agent_runs")) {
  console.error("FAIL: stuck-run-watchdog.ts does not sweep pil_agent_runs");
  process.exit(1);
}
console.log("OK: watchdog sweeps pil_agent_runs");
