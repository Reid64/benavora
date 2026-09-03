import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/auth/role-gate";
import { OrgsListClient, type OrgListRow } from "./OrgsListClient";

// Platform admin organization list. Owner-only, same gate as /admin and
// /admin/orgs/[id] (BLUEPRINT §3.2). Cross-tenant: every query uses the
// service-role client with no organization_id filter, by design.
export const dynamic = "force-dynamic";

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

export default async function AdminOrgsPage() {
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
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [orgsRes, subsRes, agentRuns7dRes] = await Promise.all([
    admin
      .from("organizations")
      .select("id, name, subscription_tier, onboarding_completed, created_at")
      .order("created_at", { ascending: false }),
    admin.from("subscriptions").select("organization_id, status"),
    admin.from("agent_runs").select("organization_id").gte("created_at", since7d),
  ]);

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

  const organizations: OrgListRow[] = orgs.map((org) => ({
    id: org.id,
    name: org.name,
    plan: org.subscription_tier ?? "free",
    status:
      org.subscription_tier === "suspended"
        ? "suspended"
        : statusByOrg.get(org.id) ?? "no_subscription",
    onboardingCompleted: org.onboarding_completed,
    createdAt: org.created_at,
    agentRunsLast7d: runCountByOrg.get(org.id) ?? 0,
  }));

  return (
    <div style={{ minHeight: "100vh", padding: "32px" }}>
      {/* Admin/Platform section treatment — PAGE_TREATMENT_PROTOCOL_V2.md.
          Frame: Deep Navy fill. Secondary accent: Rich Gold border, kept as a
          border rather than the fill so the white header text keeps its
          contrast against the dark panel. */}
      <div
        style={{
          backgroundColor: "#2C4E3B",
          borderRadius: "20px",
          padding: "28px 40px",
          marginBottom: "24px",
          boxShadow: "0 8px 32px rgba(44,78,59,0.3)",
          borderBottom: "4px solid #C49A4F",
        }}
      >
        <h1
          style={{
            fontSize: "22px",
            fontWeight: 800,
            color: "#FFFFFF",
            letterSpacing: "-0.02em",
            margin: 0,
          }}
        >
          Organizations
        </h1>
        <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.65)", margin: "4px 0 0 0" }}>
          {organizations.length.toLocaleString()} organizations on Benavora. Search, filter, and
          jump into any tenant for support.
        </p>
      </div>

      <OrgsListClient organizations={organizations} />
    </div>
  );
}
