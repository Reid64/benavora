import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createClient } from "@/lib/supabase/server";
import { AgentError } from "@/lib/agents/base-agent";

export const maxDuration = 300;
import { EmailCampaignAgent } from "@/lib/agents/email-campaign";

// Email Campaign engine endpoint (AGENTS.md Agent 18, BLUEPRINT §4.11).
//
// POST runs the org's active campaigns now (a user-initiated run, so it bypasses
// the business-hours guard); GET returns a campaign status summary for the
// outreach UI. Both authenticate via the session and derive organization_id from
// the profile - never from the request body (BEHAVIORAL_CONTRACTS §2, §16). The
// engine is gated by the per-org feature.cold_outreach_email flag (§21).

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

// Best-effort per-organization rate limit (mirrors the other agent routes).
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function isRateLimited(orgId: string): boolean {
  const now = Date.now();
  const recent = (hits.get(orgId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    hits.set(orgId, recent);
    return true;
  }
  recent.push(now);
  hits.set(orgId, recent);
  return false;
}

/** Resolve the authenticated user's organization_id (server-derived only). */
async function resolveOrg(
  supabase: ReturnType<typeof createClient>,
): Promise<{ organizationId: string; profileId: string } | { error: NextResponse }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: jsonError("Authentication required.", "unauthenticated", 401) };
  }
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, organization_id")
    .eq("id", user.id)
    .single();
  if (error || !profile) {
    return { error: jsonError("Could not resolve your profile.", "no_profile", 403) };
  }
  return {
    organizationId: profile.organization_id as string,
    profileId: profile.id as string,
  };
}

/** True if the cold-outreach email feature flag is enabled for the org. */
async function emailEnabled(
  supabase: ReturnType<typeof createClient>,
): Promise<boolean> {
  const { data } = await supabase
    .from("platform_config")
    .select("value")
    .eq("key", "feature.cold_outreach_email")
    .maybeSingle();
  return (data?.value as string | null) === "true";
}

export async function POST(request: Request) {
  // Running campaigns is a write action - viewers are read-only (Contracts §16).
  const roleCheck = await requireRole("writer");
  if ("error" in roleCheck) return roleCheck.error;

  const supabase = createClient();
  const resolved = await resolveOrg(supabase);
  if ("error" in resolved) return resolved.error;
  const { organizationId, profileId } = resolved;

  if (!(await emailEnabled(supabase))) {
    return jsonError(
      "Cold-outreach email is not enabled for your organization.",
      "feature_disabled",
      403,
    );
  }
  if (isRateLimited(organizationId)) {
    return jsonError(
      "Too many campaign runs. Please wait a moment and try again.",
      "rate_limited",
      429,
    );
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const { campaignIds } = (body ?? {}) as { campaignIds?: unknown };
  const ids = Array.isArray(campaignIds)
    ? campaignIds.filter((v): v is string => typeof v === "string")
    : null;

  const agent = new EmailCampaignAgent({
    client: supabase,
    organizationId,
    triggeredBy: profileId,
  });

  try {
    // User-initiated: force=true bypasses the business-hours guard.
    const outcome = await agent.run({ campaignIds: ids, force: true });
    return NextResponse.json(outcome.data);
  } catch (err) {
    if (err instanceof AgentError) {
      return jsonError(err.message, err.code, err.status);
    }
    return jsonError("Campaign run failed.", "campaign_failed", 500);
  }
}

export async function GET() {
  const supabase = createClient();
  const resolved = await resolveOrg(supabase);
  if ("error" in resolved) return resolved.error;

  const { data: campaigns, error } = await supabase
    .from("email_campaigns")
    .select("id, name, status, total_steps, total_contacts, created_at")
    .order("created_at", { ascending: false });
  if (error) {
    return jsonError("Could not load campaigns.", "load_failed", 500);
  }

  const rows = campaigns ?? [];
  const summary = {
    total: rows.length,
    active: rows.filter((c) => c.status === "active").length,
    draft: rows.filter((c) => c.status === "draft").length,
    paused: rows.filter((c) => c.status === "paused").length,
    completed: rows.filter((c) => c.status === "completed").length,
  };

  return NextResponse.json({ summary, campaigns: rows });
}
