/**
 * `process_followups` worker job stub. Will advance `followup_enrollments`
 * rows through their `followup_sequences` steps and dispatch the due
 * follow-up action for each. Not yet wired into a worker loop.
 */
export async function processFollowups(): Promise<void> {
  console.log("processing followups");
}
