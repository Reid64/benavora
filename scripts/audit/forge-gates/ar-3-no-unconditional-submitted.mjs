// FORGE shell-gate assertion for AR-3.1, the P0.
// queue-processor.ts must never assign submissionStatus = 'submitted'
// unconditionally: the status has to be derived from the fill outcome, so a
// submission that was never verified can never be persisted as submitted.
import { readFileSync } from "fs";
const src = readFileSync("worker/queue-processor.ts", "utf8");
const unconditional = /submissionStatus\s*=\s*['"]submitted['"]\s*;/.test(src);
if (unconditional) {
  console.error("FAIL: queue-processor.ts still assigns submissionStatus='submitted' unconditionally");
  process.exit(1);
}
if (!/submit_unverified/.test(src)) {
  console.error("FAIL: queue-processor.ts has no 'submit_unverified' status - the ambiguous case is not represented");
  process.exit(1);
}
console.log("OK: submission status is derived from fill outcome; submit_unverified exists");
