// GET /api/donor-discovery/stats — org-scoped counts for the Donor Discovery
// Overview page's remaining ad-hoc stat cards (High-Intent Signals + Live
// Intent Signals feed, Contacted This Month, Active Campaigns, AutoApply
// Submissions).
//
// These were previously issued as raw Supabase queries directly from the
// browser (src/app/(dashboard)/donor-discovery/page.tsx) with no explicit
// organization_id/org_id filter, relying solely on RLS to scope results to
// the caller's org. RLS on all four tables involved is confirmed enabled
// with a real org-scoping policy (verified 2026-08-21 against prod), so this
// was not an active cross-org leak — but it left organization_id scoping
// entirely up to RLS instead of an explicit, server-derived filter, which is
// inconsistent with Behavioral Contracts §2 and with the sibling Pipeline
// Funnel route (/api/donor-discovery/pipeline), which already made this
// exact move for the same reason. Consolidated here to close that gap.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

const HIGH_INTENT_THRESHOLD = 75;
const INTENT_SIGNAL_LOOKBACK = 1000;

interface IntentSignalRow {
  company_name: string;
  intent_score: number | null;
  created_at: string;
}

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [intentSignalsRes, contactedCountRes, activeCampaignsRes, autoApplyRes] = await Promise.all([
    supabase
      .from("corporate_intent_signals")
      .select("company_name, intent_score, created_at")
      .eq("org_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(INTENT_SIGNAL_LOOKBACK),
    // "Contacted This Month" — donor_discovery_prospects has no per-stage
    // transition timestamp, so this counts prospects in an engaged stage
    // whose row was created this month (a proxy, not a literal
    // moved-to-Contacted date — see page.tsx file header).
    supabase
      .from("donor_discovery_prospects")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .in("pipeline_stage", ["contacted", "applied", "received"])
      .gte("created_at", startOfMonth.toISOString()),
    // Active Outreach Campaigns — email_campaign_sequences, NOT
    // sales_campaigns (see page.tsx file header for why).
    supabase
      .from("email_campaign_sequences")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "active"),
    // Submissions via AutoApply — completed rows in this org's
    // submission_queue (migration 045_autoapply_tables.sql).
    supabase
      .from("submission_queue")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "completed"),
  ]);

  const intentRows = (intentSignalsRes.data ?? []) as IntentSignalRow[];
  const latestScoreByCompany = new Map<string, number | null>();
  for (const row of intentRows) {
    const key = row.company_name.trim().toLowerCase();
    if (!latestScoreByCompany.has(key)) latestScoreByCompany.set(key, row.intent_score);
  }
  const highIntentCount = Array.from(latestScoreByCompany.values()).filter(
    (s) => s != null && s >= HIGH_INTENT_THRESHOLD,
  ).length;

  return NextResponse.json({
    contactedThisMonth: contactedCountRes.count ?? 0,
    activeCampaignsCount: activeCampaignsRes.count ?? 0,
    autoApplySubmissionsCount: autoApplyRes.count ?? 0,
    highIntentCount,
    recentSignals: intentRows.slice(0, 5) as IntentSignalRow[],
  });
}
