// ============================================================================
// AR-9.2 recovery — live proof that an Anthropic call produces an
// ai_usage_log row.
//
// The AR-9.2 gate failed with "0 rows in 6h while agent_runs logged 417". The
// diagnosis was NOT a broken writer: 356 of those 417 runs were
// ag-29-knowledge-indexer, which makes no Anthropic calls at all (0
// tokens_used, no SDK import), and every run that DID consume tokens happened
// before the fix was committed. So the ledger had nothing to record and no way
// to prove itself either.
//
// This script closes that: it makes ONE real, minimal Anthropic call through
// the real production code path (callClaude, wrapped in the same
// runWithUsageContext boundary BaseAgent.run uses) against the real database,
// then reads back the row it should have written. It is the live-row evidence
// the gate asks for, and it is repeatable whenever the writer is touched.
//
// Costs a fraction of a cent (max_tokens is 16). Run: pnpm verify:ai-usage
// ============================================================================
import { config } from "dotenv";
config({ path: ".env.local" });

import { createAdminClient } from "@/lib/supabase/admin";
import { callClaude } from "@/lib/ai/claude";
import { runWithUsageContext } from "@/lib/ai/usage-context";
import { createTrackedAnthropic } from "@/lib/ai/tracked-anthropic";

const AGENT_TYPE = "ai_usage_log_verification";

// Both recording paths are probed: the callClaude wrapper (AR-9.2) and the
// instrumented raw client (this recovery), which is what the ~34 modules that
// never used callClaude now build their clients with.
const TRACKED_SOURCE = "verification-tracked-client";

async function main(): Promise<void> {
  const admin = createAdminClient();

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .select("id, name")
    .order("created_at", { ascending: true })
    .limit(1)
    .single();
  if (orgErr || !org) throw new Error(`Could not load an organization: ${orgErr?.message}`);

  const before = new Date().toISOString();
  console.log(`Attributing the probe call to org ${org.id} (${org.name}).`);

  const response = await runWithUsageContext(
    { organizationId: org.id, agentType: AGENT_TYPE, agentRunId: null },
    () =>
      callClaude({
        prompt: "Reply with the single word: ok",
        maxTokens: 16,
      }),
  );

  console.log(
    `Anthropic replied (${response.usage.totalTokens} tokens: ` +
      `${response.usage.inputTokens} in / ${response.usage.outputTokens} out).`,
  );

  // Second probe: the instrumented raw client, exercising the path taken by
  // autoapply / intelligence / donor-discovery / scraper-v2 / enrichment.
  const tracked = createTrackedAnthropic(
    { apiKey: process.env.ANTHROPIC_API_KEY },
    TRACKED_SOURCE,
  );
  const trackedReply = await runWithUsageContext(
    { organizationId: org.id, agentType: AGENT_TYPE, agentRunId: null },
    () =>
      tracked.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 16,
        messages: [{ role: "user", content: "Reply with the single word: ok" }],
      }),
  );
  console.log(
    `Tracked raw client replied (${trackedReply.usage.input_tokens} in / ` +
      `${trackedReply.usage.output_tokens} out).`,
  );

  const { data: rows, error: rowErr } = await admin
    .from("ai_usage_log")
    .select("id, organization_id, model, endpoint, input_tokens, output_tokens, cost_usd, billing_path, created_at")
    .eq("agent_type", AGENT_TYPE)
    .gte("created_at", before)
    .order("created_at", { ascending: false });
  if (rowErr) throw new Error(`Could not read ai_usage_log back: ${rowErr.message}`);

  const wrapperRow = (rows ?? []).find((r) => r.endpoint === "callClaude");
  const trackedRow = (rows ?? []).find((r) => r.endpoint === TRACKED_SOURCE);

  if (!wrapperRow) {
    throw new Error(
      "FAIL: the callClaude call succeeded but wrote no ai_usage_log row. " +
        "Check system_errors for source='ai_usage_log'.",
    );
  }
  if (!trackedRow) {
    throw new Error(
      "FAIL: the instrumented raw client (createTrackedAnthropic) succeeded but " +
        "wrote no ai_usage_log row -- the ~34 modules using it are recording nothing.",
    );
  }

  console.log("PASS: both recording paths wrote a live ai_usage_log row:");
  console.log(JSON.stringify([wrapperRow, trackedRow], null, 2));

  for (const row of [wrapperRow, trackedRow]) {
    if (row.cost_usd === null) {
      console.warn(
        `WARNING: cost_usd is null for endpoint "${row.endpoint}" -- model ` +
          `"${row.model}" has no row in model_cost_reference, so this call is ` +
          "recorded as UNPRICED, not free. Seed the rate to price it.",
      );
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
