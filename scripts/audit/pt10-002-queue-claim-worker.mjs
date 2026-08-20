// ============================================================================
// PT-10-002 scenario 2 support process -- a standalone child process that
// performs a REAL two-step claim against a REAL submission_queue row (same
// predicates as worker/queue-processor.ts's own dequeue(), lines ~420-459 of
// that file as read for this audit: SELECT one 'pending' row, then
// UPDATE ... SET status='processing' WHERE id=<id> AND status='pending'
// RETURNING id -- the exact optimistic-claim guard the real worker uses),
// then sleeps for WORK_MS to stand in for the real in-flight work a claimed
// submission_queue item does (browser automation / form fill, which is what
// actually runs between claim and the terminal status update in the real
// worker's loop()).
//
// This process is meant to be SIGKILLed by the orchestrator partway through
// the WORK_MS sleep, before it ever reaches the terminal
// `.update({status:'completed', completed_at: ...})` call that
// worker/queue-processor.ts's loop() performs on success (line ~317-320) --
// simulating a real worker process death (OOM kill, host eviction, deploy
// restart) mid-job. If it is NOT killed (used once, for a baseline/control
// run confirming the claim+complete path itself works when nothing goes
// wrong), it proceeds to perform that same terminal update and exits 0.
//
// Faithful reimplementation of the real SQL shape, not an import of
// queue-processor.ts itself -- that file pulls in Playwright/browser
// automation/proxy-manager/etc, none of which this test needs or wants to
// boot just to exercise the claim/terminal-update predicates.
//
// ASCII only. Node 20 compatible.
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import ws from "ws";

const SUPABASE_URL = process.env.PT10_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.PT10_SUPABASE_SERVICE_KEY;
const QUEUE_ITEM_ID = process.env.PT10_QUEUE_ITEM_ID;
const WORK_MS = Number(process.env.PT10_WORK_MS || 20000);
const COMPLETE_NORMALLY = process.env.PT10_COMPLETE_NORMALLY === "1";

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !QUEUE_ITEM_ID) {
  console.error("pt10-002-queue-claim-worker: missing required PT10_* env vars");
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: ws },
});

async function main() {
  // Step 1: SELECT the candidate (mirrors dequeue()'s first read).
  const { data: candidate, error: selectErr } = await supabase
    .from("submission_queue")
    .select("*")
    .eq("id", QUEUE_ITEM_ID)
    .eq("status", "pending")
    .maybeSingle();

  if (selectErr) {
    console.error("CLAIM_WORKER_SELECT_ERROR", selectErr.message);
    process.exit(3);
  }
  if (!candidate) {
    console.log("CLAIM_WORKER_NOT_PENDING");
    process.exit(4);
  }

  // Step 2: optimistic claim -- UPDATE only succeeds if still 'pending'.
  const { data: claimed, error: claimErr } = await supabase
    .from("submission_queue")
    .update({ status: "processing", started_at: new Date().toISOString() })
    .eq("id", QUEUE_ITEM_ID)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (claimErr) {
    console.error("CLAIM_WORKER_CLAIM_ERROR", claimErr.message);
    process.exit(5);
  }
  if (!claimed) {
    console.log("CLAIM_WORKER_LOST_RACE");
    process.exit(6);
  }

  console.log(`CLAIM_WORKER_CLAIMED ${QUEUE_ITEM_ID}`);

  // Simulate the real in-flight work window (form-fill / browser automation)
  // between claim and the terminal write. This is the window the orchestrator
  // SIGKILLs the process during, for the mid-job-kill scenario.
  await new Promise((resolve) => setTimeout(resolve, WORK_MS));

  if (COMPLETE_NORMALLY) {
    const { error: completeErr } = await supabase
      .from("submission_queue")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", QUEUE_ITEM_ID);
    if (completeErr) {
      console.error("CLAIM_WORKER_COMPLETE_ERROR", completeErr.message);
      process.exit(7);
    }
    console.log("CLAIM_WORKER_COMPLETED_NORMALLY");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("CLAIM_WORKER_FATAL", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
