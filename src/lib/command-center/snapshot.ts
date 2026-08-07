// Shared cross-org data fetch for the Platform Command Center
// (src/app/(dashboard)/command-center/page.tsx). Extracted so the page's
// server-rendered initial paint and the live-refresh API route
// (src/app/api/admin/command-center/route.ts) run the exact same queries
// instead of two copies drifting apart.

import { createAdminClient } from "@/lib/supabase/admin";

export type OrgLite = {
  id: string;
  name: string;
};

export type AgentRunRow = {
  id: string;
  organization_id: string;
  agent_type: string;
  status: string;
  items_processed: number | null;
  duration_ms: number | null;
  created_at: string;
};

export interface CommandCenterSnapshot {
  totalOrgsOnboarded: number;
  activeSubscriptions: number;
  totalOpportunities: number;
  totalApplications: number;
  pendingDrafts: number;
  agentRunsLast24h: number;
  itemsProcessedLast24h: number;
  agentDecisionsLast24h: number;
  foundationTotal: number;
  foundation990Count: number;
  foundationWebCount: number;
  topOrgs: { orgId: string; name: string; count: number }[];
  recentAgentRuns: AgentRunRow[];
  orgNameById: Record<string, string>;
  generatedAt: string;
}

export async function getCommandCenterSnapshot(): Promise<CommandCenterSnapshot> {
  const admin = createAdminClient();

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    orgsOnboardedRes,
    activeSubsRes,
    totalOppsRes,
    totalAppsRes,
    pendingDraftsRes,
    agentRuns24hRes,
    agentDecisions24hRes,
    agentDecisions7dRes,
    recentAgentRunsRes,
    foundationTotalRes,
    foundation990Res,
    foundationWebRes,
    orgsRes,
  ] = await Promise.all([
    admin
      .from("organizations")
      .select("id", { count: "exact", head: true })
      .eq("onboarding_completed", true),
    admin
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),
    admin.from("opportunities").select("id", { count: "exact", head: true }),
    admin.from("applications").select("id", { count: "exact", head: true }),
    admin
      .from("applications")
      .select("id", { count: "exact", head: true })
      .eq("auto_generated", true)
      .eq("pending_review", true),
    admin.from("agent_runs").select("items_processed").gte("created_at", since24h),
    admin
      .from("agent_decisions")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since24h),
    admin.from("agent_decisions").select("org_id").gte("created_at", since7d),
    admin
      .from("agent_runs")
      .select("id, organization_id, agent_type, status, items_processed, duration_ms, created_at")
      .order("created_at", { ascending: false })
      .limit(10),
    admin.from("foundation_directory").select("id", { count: "exact", head: true }),
    admin
      .from("foundation_directory")
      .select("id", { count: "exact", head: true })
      .not("enriched_990_at", "is", null),
    admin
      .from("foundation_directory")
      .select("id", { count: "exact", head: true })
      .not("enriched_web_at", "is", null),
    admin.from("organizations").select("id, name"),
  ]);

  const agentRuns24hRows = (agentRuns24hRes.data ?? []) as { items_processed: number | null }[];
  const agentRunsLast24h = agentRuns24hRows.length;
  const itemsProcessedLast24h = agentRuns24hRows.reduce(
    (sum, r) => sum + (r.items_processed ?? 0),
    0,
  );

  const decisions7d = (agentDecisions7dRes.data ?? []) as { org_id: string }[];
  const recentAgentRuns = (recentAgentRunsRes.data ?? []) as AgentRunRow[];
  const orgs = (orgsRes.data ?? []) as OrgLite[];
  const orgNameById: Record<string, string> = {};
  for (const o of orgs) orgNameById[o.id] = o.name;

  const decisionCountByOrg = new Map<string, number>();
  for (const d of decisions7d) {
    decisionCountByOrg.set(d.org_id, (decisionCountByOrg.get(d.org_id) ?? 0) + 1);
  }
  const topOrgs = Array.from(decisionCountByOrg.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([orgId, count]) => ({
      orgId,
      name: orgNameById[orgId] ?? "Unknown org",
      count,
    }));

  return {
    totalOrgsOnboarded: orgsOnboardedRes.count ?? 0,
    activeSubscriptions: activeSubsRes.count ?? 0,
    totalOpportunities: totalOppsRes.count ?? 0,
    totalApplications: totalAppsRes.count ?? 0,
    pendingDrafts: pendingDraftsRes.count ?? 0,
    agentRunsLast24h,
    itemsProcessedLast24h,
    agentDecisionsLast24h: agentDecisions24hRes.count ?? 0,
    foundationTotal: foundationTotalRes.count ?? 0,
    foundation990Count: foundation990Res.count ?? 0,
    foundationWebCount: foundationWebRes.count ?? 0,
    topOrgs,
    recentAgentRuns,
    orgNameById,
    generatedAt: new Date().toISOString(),
  };
}
