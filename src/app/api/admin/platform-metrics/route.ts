// GET /api/admin/platform-metrics — cross-tenant platform health snapshot for
// the Platform Admin dashboard. Owner-only (BLUEPRINT §3.2), same gating
// precedent as /api/admin/monitor and the (dashboard)/admin page: requireRole
// authenticates the session and confirms rank, then every query below runs on
// the service-role client (src/lib/supabase/admin.ts) with no organization_id
// filter - by design, this endpoint spans every tenant.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// Hardcoded per task spec - not the BLUEPRINT §10 SaaS tier prices, which are
// listed there for the licensable-SaaS pricing page, not this metric.
const PLAN_PRICES: Record<string, number> = {
  starter: 49,
  professional: 149,
  enterprise: 499,
};

export async function GET() {
  const gate = await requireRole("owner");
  if ("error" in gate) return gate.error;

  const admin = createAdminClient();

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { count: totalOrgs },
    { count: totalUsers },
    { count: totalOpportunities },
    { count: totalApplications },
    { count: totalSubmitted },
    { count: signupsLast30Days },
    { data: awardedRows },
    { data: planRows },
    { data: recentOpportunityOrgs },
    { data: activeSubscriptions },
  ] = await Promise.all([
    admin.from("organizations").select("id", { count: "exact", head: true }),
    admin.from("profiles").select("id", { count: "exact", head: true }),
    admin.from("opportunities").select("id", { count: "exact", head: true }),
    admin.from("applications").select("id", { count: "exact", head: true }),
    admin
      .from("applications")
      .select("id", { count: "exact", head: true })
      .not("submitted_at", "is", null),
    admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .gte("created_at", thirtyDaysAgo),
    admin.from("applications").select("awarded_amount").not("awarded_amount", "is", null),
    admin.from("organizations").select("subscription_tier"),
    admin
      .from("opportunities")
      .select("organization_id")
      .gte("created_at", sevenDaysAgo),
    admin.from("subscriptions").select("tier").eq("status", "active"),
  ]);

  const totalAwardedAmount = ((awardedRows ?? []) as { awarded_amount: number | null }[]).reduce(
    (sum, row) => sum + (row.awarded_amount ?? 0),
    0,
  );

  const ordersByPlan = new Map<string, number>();
  for (const row of (planRows ?? []) as { subscription_tier: string | null }[]) {
    const plan = row.subscription_tier ?? "free";
    ordersByPlan.set(plan, (ordersByPlan.get(plan) ?? 0) + 1);
  }
  const orgsByPlan = Array.from(ordersByPlan.entries()).map(([plan, count]) => ({
    plan,
    count,
  }));

  const activeThisWeek = new Set(
    ((recentOpportunityOrgs ?? []) as { organization_id: string }[]).map(
      (row) => row.organization_id,
    ),
  ).size;

  const revenueThisMonth = ((activeSubscriptions ?? []) as { tier: string | null }[]).reduce(
    (sum, row) => sum + (PLAN_PRICES[row.tier ?? ""] ?? 0),
    0,
  );

  return NextResponse.json({
    total_orgs: totalOrgs ?? 0,
    total_users: totalUsers ?? 0,
    total_opportunities: totalOpportunities ?? 0,
    total_applications: totalApplications ?? 0,
    total_submitted: totalSubmitted ?? 0,
    total_awarded_amount: totalAwardedAmount,
    orgs_by_plan: orgsByPlan,
    signups_last_30_days: signupsLast30Days ?? 0,
    active_this_week: activeThisWeek,
    revenue_this_month: revenueThisMonth,
  });
}
