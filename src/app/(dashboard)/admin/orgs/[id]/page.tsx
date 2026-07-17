import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/auth/role-gate";
import { formatDate, humanizeEnum } from "@/lib/utils/formatters";
import { TIER_PLANS, type SubscriptionTier } from "@/lib/utils/constants";
import { OrgDetailTabs, type OrgUserRow, type OrgOpportunityRow, type OrgApplicationRow } from "./OrgDetailTabs";

// Platform admin org detail. Owner-only, same gate as the parent /admin
// dashboard (BLUEPRINT §3.2). Unlike org-scoped app pages, every query here
// uses the service-role client filtered explicitly by this org's id - it's a
// cross-tenant admin tool looking INTO one tenant, not that tenant's own
// RLS-scoped session.
export const dynamic = "force-dynamic";

type OrgRow = {
  id: string;
  name: string;
  subscription_tier: string | null;
  stripe_customer_id: string | null;
  created_at: string;
};

type SubscriptionRow = {
  status: string;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
};

function planDisplay(tier: string | null): { name: string; monthlyPrice: number | null } {
  if (!tier) return { name: "Free", monthlyPrice: TIER_PLANS.free.monthlyPrice };
  if (tier === "suspended") return { name: "Suspended", monthlyPrice: null };
  const known = TIER_PLANS[tier as SubscriptionTier];
  return known
    ? { name: known.name, monthlyPrice: known.monthlyPrice }
    : { name: humanizeEnum(tier), monthlyPrice: null };
}

export default async function OrgDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const orgId = params.id;
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { allowed } = await checkPermission(user.id, "owner", supabase);
  if (!allowed) {
    redirect("/dashboard?notice=owner_required");
  }

  const admin = createAdminClient();

  const orgRes = await admin
    .from("organizations")
    .select("id, name, subscription_tier, stripe_customer_id, created_at")
    .eq("id", orgId)
    .single();

  if (orgRes.error || !orgRes.data) {
    redirect("/admin?notice=org_not_found");
  }

  const org = orgRes.data as OrgRow;

  const [subRes, profilesRes, opportunitiesRes, applicationsRes] = await Promise.all([
    admin
      .from("subscriptions")
      .select("status, stripe_subscription_id, current_period_end")
      .eq("organization_id", orgId)
      .maybeSingle(),
    admin
      .from("profiles")
      .select("id, full_name, email, role, created_at, last_login_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false }),
    admin
      .from("opportunities")
      .select("id, name, category, deadline, status")
      .eq("organization_id", orgId)
      .order("deadline", { ascending: true, nullsFirst: false }),
    admin
      .from("applications")
      .select("id, opportunity_id, stage, requested_amount, submitted_at, created_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false }),
  ]);

  const subscription = (subRes.data ?? null) as SubscriptionRow | null;
  const users = (profilesRes.data ?? []) as OrgUserRow[];
  const opportunities = (opportunitiesRes.data ?? []) as OrgOpportunityRow[];
  const applicationRows = (applicationsRes.data ?? []) as Array<{
    id: string;
    opportunity_id: string;
    stage: string;
    requested_amount: number | null;
    submitted_at: string | null;
    created_at: string;
  }>;

  const opportunityNameById = new Map(opportunities.map((o) => [o.id, o.name]));
  const applications: OrgApplicationRow[] = applicationRows.map((a) => ({
    id: a.id,
    opportunityName: opportunityNameById.get(a.opportunity_id) ?? "-",
    stage: a.stage,
    requestedAmount: a.requested_amount,
    submittedAt: a.submitted_at,
    createdAt: a.created_at,
  }));

  const plan = planDisplay(org.subscription_tier);

  return (
    <div style={{ backgroundColor: "#C8D4DC", minHeight: "100vh", padding: "32px" }}>
      {/* Hero */}
      <div
        style={{
          backgroundColor: "#1A2B3C",
          borderRadius: "20px",
          padding: "28px 40px",
          marginBottom: "24px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.20)",
        }}
      >
        <div
          style={{
            fontSize: "11px",
            fontWeight: 700,
            color: "rgba(255,255,255,0.55)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            marginBottom: "6px",
          }}
        >
          Platform Admin / Organization
        </div>
        <h1
          style={{
            fontSize: "24px",
            fontWeight: 800,
            color: "#FFFFFF",
            letterSpacing: "-0.02em",
            margin: 0,
          }}
        >
          {org.name}
        </h1>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "20px",
            marginTop: "16px",
          }}
        >
          <HeroStat label="Plan" value={plan.name} />
          <HeroStat label="Created" value={formatDate(org.created_at)} />
          <HeroStat label="Stripe Status" value={subscription ? humanizeEnum(subscription.status) : "No Subscription"} />
          <HeroStat label="Org ID" value={org.id} mono />
        </div>
      </div>

      <OrgDetailTabs
        orgId={org.id}
        users={users}
        opportunities={opportunities}
        applications={applications}
        billing={{
          stripeCustomerId: org.stripe_customer_id,
          stripeSubscriptionStatus: subscription?.status ?? null,
          planName: plan.name,
          monthlyPrice: plan.monthlyPrice,
        }}
      />
    </div>
  );
}

function HeroStat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div
        style={{
          fontSize: "10px",
          fontWeight: 700,
          color: "rgba(255,255,255,0.5)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: "14px",
          fontWeight: 600,
          color: "#FFFFFF",
          marginTop: "2px",
          fontFamily: mono ? "monospace" : undefined,
        }}
      >
        {value}
      </div>
    </div>
  );
}
