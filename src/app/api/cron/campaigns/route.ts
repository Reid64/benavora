import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { EmailCampaignAgent } from "@/lib/agents/email-campaign";

// Drip campaign sweep (BLUEPRINT §3.1 cron, AGENTS.md Agent 18, Contracts §21).
// Vercel Cron hits this with GET every 2 hours (see vercel.json).
//
// This is a SYSTEM job: it sweeps EVERY organization that has cold-outreach email
// enabled, via the service-role admin client, and is gated solely by the
// server-only CRON_SECRET. It is never user-reachable (Contracts §2: service role
// is for system jobs, never user-facing routes - the interactive trigger is
// POST /api/agents/campaigns).
//
// Each org's EmailCampaignAgent runs with force=false, so the agent itself
// enforces business hours, the 50/day cap, and the inter-step gap. A failure on
// one org never aborts the sweep. Every query inside the agent is
// organization_id-scoped - correct under the service-role client where RLS does
// not protect us (Contracts §2, §15).

export const runtime = "nodejs";
// A sweep may send across many orgs; give it headroom beyond the default.
export const maxDuration = 300;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

async function runSweep(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return jsonError("Unauthorized.", "unauthorized", 401);
  }

  const admin = createAdminClient();

  // Organizations with the cold-outreach email feature enabled (Contracts §21).
  const { data: flagRows, error: flagError } = await admin
    .from("platform_config")
    .select("organization_id")
    .eq("key", "feature.cold_outreach_email")
    .eq("value", "true");
  if (flagError) {
    return jsonError("Could not load organizations.", "load_failed", 500);
  }

  const orgIds = Array.from(
    new Set(
      (flagRows ?? []).map((r) => r.organization_id as string).filter(Boolean),
    ),
  );

  let emailsSent = 0;
  let replies = 0;
  let bounces = 0;
  const organizations: Array<{
    organizationId: string;
    emailsSent: number;
    replies: number;
    bounces: number;
    error?: string;
  }> = [];

  for (const organizationId of orgIds) {
    const agent = new EmailCampaignAgent({
      client: admin,
      organizationId,
      triggeredBy: null, // automated run
    });
    try {
      const outcome = await agent.run({ campaignIds: null, force: false });
      emailsSent += outcome.data.emailsSent;
      replies += outcome.data.replies;
      bounces += outcome.data.bounces;
      organizations.push({
        organizationId,
        emailsSent: outcome.data.emailsSent,
        replies: outcome.data.replies,
        bounces: outcome.data.bounces,
      });
    } catch (err) {
      organizations.push({
        organizationId,
        emailsSent: 0,
        replies: 0,
        bounces: 0,
        error: err instanceof Error ? err.message : "Campaign run failed.",
      });
    }
  }

  return NextResponse.json({
    mode: "cron",
    scope: "all_organizations",
    organizationsScanned: orgIds.length,
    emailsSent,
    replies,
    bounces,
    organizations,
  });
}

// Vercel Cron issues GET. POST is accepted too for manual/ops invocation behind
// the same secret.
export async function GET(request: Request) {
  return runSweep(request);
}

export async function POST(request: Request) {
  return runSweep(request);
}
