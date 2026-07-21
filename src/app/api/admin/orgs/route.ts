import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/admin/orgs — platform-wide organization list for the /admin/orgs
// page. Owner-only, same gate as /admin and /admin/orgs/[id] (BLUEPRINT
// §3.2). Every query uses the service-role client with no organization_id
// filter — cross-tenant by design, mirroring /admin/page.tsx.
export const runtime = "nodejs";

type OrgRow = {
  id: string;
  name: string;
  subscription_tier: string | null;
  onboarding_completed: boolean;
  created_at: string;
};

type SubscriptionRow = {
  organization_id: string;
  status: string;
};

type AgentRunRow = {
  organization_id: string;
};

export async function GET() {
  const gate = await requireRole("owner");
  if ("error" in gate) return gate.error;

  const admin = createAdminClient();
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [orgsRes, subsRes, agentRuns7dRes] = await Promise.all([
    admin
      .from("organizations")
      .select("id, name, subscription_tier, onboarding_completed, created_at")
      .order("created_at", { ascending: false }),
    admin.from("subscriptions").select("organization_id, status"),
    admin.from("agent_runs").select("organization_id").gte("created_at", since7d),
  ]);

  if (orgsRes.error) {
    return NextResponse.json(
      { error: "Could not load organizations.", code: "load_failed" },
      { status: 500 },
    );
  }

  const orgs = (orgsRes.data ?? []) as OrgRow[];
  const subscriptions = (subsRes.data ?? []) as SubscriptionRow[];
  const agentRuns7d = (agentRuns7dRes.data ?? []) as AgentRunRow[];

  const statusByOrg = new Map<string, string>();
  for (const sub of subscriptions) {
    if (!statusByOrg.has(sub.organization_id) || sub.status === "active") {
      statusByOrg.set(sub.organization_id, sub.status);
    }
  }

  const runCountByOrg = new Map<string, number>();
  for (const run of agentRuns7d) {
    runCountByOrg.set(
      run.organization_id,
      (runCountByOrg.get(run.organization_id) ?? 0) + 1,
    );
  }

  const organizations = orgs.map((org) => ({
    id: org.id,
    name: org.name,
    plan: org.subscription_tier ?? "free",
    // "suspended" is written as a subscription_tier value by
    // /api/admin/orgs/[id]/suspend, not a subscriptions.status value — surface
    // it as its own status ahead of the Stripe-derived one so the filter and
    // badge reflect reality rather than showing a stale Stripe status.
    status:
      org.subscription_tier === "suspended"
        ? "suspended"
        : statusByOrg.get(org.id) ?? "no_subscription",
    onboardingCompleted: org.onboarding_completed,
    createdAt: org.created_at,
    agentRunsLast7d: runCountByOrg.get(org.id) ?? 0,
  }));

  return NextResponse.json({ organizations });
}
