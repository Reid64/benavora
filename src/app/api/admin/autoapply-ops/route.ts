import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

export async function GET() {
  const gate = await requireRole("admin");
  if ("error" in gate) return gate.error;

  const admin = createAdminClient();
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();

  // Parallel: system health queries
  const [workerRes, queueRes, controlRes] = await Promise.all([
    admin
      .from("worker_status")
      .select("status, last_heartbeat_at, items_processed, started_at")
      .order("last_heartbeat_at", { ascending: false })
      .limit(1),
    admin
      .from("submission_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    admin
      .from("queue_controls")
      .select("paused")
      .eq("control_type", "platform")
      .limit(1),
  ]);

  const workerRow = (workerRes.data as Record<string, unknown>[] | null)?.[0] ?? null;
  const queueDepth = queueRes.count ?? 0;
  const platformPaused =
    ((controlRes.data as { paused: boolean }[] | null)?.[0]?.paused) ?? false;

  // Submission metrics: last 30 days (covers all three windows)
  const { data: subRows30 } = await admin
    .from("autoapply_submissions")
    .select("status, created_at, organization_id")
    .gte("created_at", thirtyDaysAgo);

  type SubRow = { status: string; created_at: string; organization_id: string };
  const rows30 = (subRows30 ?? []) as SubRow[];
  const rows7 = rows30.filter((r) => r.created_at >= sevenDaysAgo);
  const rows24 = rows30.filter((r) => r.created_at >= oneDayAgo);

  function successRate(rows: SubRow[]): number {
    if (rows.length === 0) return 0;
    return (rows.filter((r) => r.status === "submitted").length / rows.length) * 100;
  }

  // Per-hour (last 24h, UTC labels)
  const hourOrder: string[] = [];
  const hourMap: Record<string, number> = {};
  for (let i = 23; i >= 0; i--) {
    const h = new Date(now.getTime() - i * 60 * 60 * 1000);
    const label = `${String(h.getUTCHours()).padStart(2, "0")}:00`;
    hourOrder.push(label);
    hourMap[label] = 0;
  }
  for (const row of rows24) {
    const label = `${String(new Date(row.created_at).getUTCHours()).padStart(2, "0")}:00`;
    if (label in hourMap) hourMap[label]++;
  }
  const perHour = hourOrder.map((hour) => ({ hour, count: hourMap[hour] ?? 0 }));

  // Failure breakdown (last 24h)
  const failMap = new Map<string, number>();
  for (const row of rows24) {
    if (row.status !== "submitted") {
      failMap.set(row.status, (failMap.get(row.status) ?? 0) + 1);
    }
  }
  const failureBreakdown = Array.from(failMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([errorClass, count]) => ({ errorClass, count }));

  // Cost tracking (today)
  const { data: usageRows } = await admin
    .from("submission_usage")
    .select("api_cost_claude, api_cost_openai, proxy_cost, captcha_cost, automated_count, email_count, manual_count")
    .gte("period_start", todayIso);

  type UsageRow = {
    api_cost_claude: number;
    api_cost_openai: number;
    proxy_cost: number;
    captcha_cost: number;
    automated_count: number;
    email_count: number;
    manual_count: number;
  };
  const costTotals = ((usageRows ?? []) as UsageRow[]).reduce(
    (acc, r) => ({
      claude: acc.claude + (r.api_cost_claude ?? 0),
      openai: acc.openai + (r.api_cost_openai ?? 0),
      proxy: acc.proxy + (r.proxy_cost ?? 0),
      captcha: acc.captcha + (r.captcha_cost ?? 0),
      submissions:
        acc.submissions +
        (r.automated_count ?? 0) +
        (r.email_count ?? 0) +
        (r.manual_count ?? 0),
    }),
    { claude: 0, openai: 0, proxy: 0, captcha: 0, submissions: 0 },
  );
  const totalCostToday =
    costTotals.claude + costTotals.openai + costTotals.proxy + costTotals.captcha;
  const costPerSubmission =
    costTotals.submissions > 0 ? totalCostToday / costTotals.submissions : 0;

  // Portal health: block rates (last 7d)
  const { data: portalRows } = await admin
    .from("autoapply_submissions")
    .select("status, funder_id, funders(name, website)")
    .gte("created_at", sevenDaysAgo)
    .not("funder_id", "is", null);

  type PortalRow = {
    status: string;
    funder_id: string;
    funders: { name: string; website: string | null } | null;
  };
  const domainAcc: Record<string, { name: string; total: number; blocks: number }> = {};
  for (const row of (portalRows ?? []) as PortalRow[]) {
    const funderName = row.funders?.name ?? row.funder_id;
    let domain = funderName;
    if (row.funders?.website) {
      try {
        domain = new URL(row.funders.website).hostname;
      } catch {
        domain = row.funders.website;
      }
    }
    if (!domainAcc[domain]) domainAcc[domain] = { name: funderName, total: 0, blocks: 0 };
    domainAcc[domain].total++;
    if (["captcha_blocked", "site_error", "failed"].includes(row.status)) {
      domainAcc[domain].blocks++;
    }
  }
  const blockRates = Object.entries(domainAcc)
    .map(([domain, d]) => ({
      domain,
      submissions: d.total,
      blocks: d.blocks,
      blockRate: d.total > 0 ? (d.blocks / d.total) * 100 : 0,
    }))
    .filter((d) => d.submissions >= 2)
    .sort((a, b) => b.blockRate - a.blockRate)
    .slice(0, 10);

  // Anti-automation portals
  const { data: antiAutoRows } = await admin
    .from("funders")
    .select("name, giving_portal_url, automation_notes")
    .eq("automation_level", "manual_only")
    .not("giving_portal_url", "is", null)
    .limit(20);

  type AntiAutoRow = {
    name: string;
    giving_portal_url: string | null;
    automation_notes: string | null;
  };
  const antiAutomation = ((antiAutoRows ?? []) as AntiAutoRow[]).map((r) => ({
    name: r.name,
    url: r.giving_portal_url ?? "",
    notes: r.automation_notes,
  }));

  // Tenant activity
  const orgToday = new Map<string, number>();
  for (const r of rows30.filter((r) => r.created_at >= todayIso)) {
    orgToday.set(r.organization_id, (orgToday.get(r.organization_id) ?? 0) + 1);
  }
  const orgTotal30 = new Map<string, number>();
  for (const r of rows30) {
    orgTotal30.set(r.organization_id, (orgTotal30.get(r.organization_id) ?? 0) + 1);
  }

  const topEntries = Array.from(orgToday.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const flaggedEntries = Array.from(orgToday.entries()).filter(([orgId, todayCount]) => {
    const avg = (orgTotal30.get(orgId) ?? 0) / 30;
    return avg > 0 && todayCount > avg * 3;
  });

  // Fetch org names for top + flagged
  const relevantIds = [
    ...new Set([...topEntries.map((e) => e[0]), ...flaggedEntries.map((e) => e[0])]),
  ];
  const nameMap = new Map<string, string>();
  if (relevantIds.length > 0) {
    const { data: orgRows } = await admin
      .from("organizations")
      .select("id, name")
      .in("id", relevantIds);
    for (const o of (orgRows ?? []) as { id: string; name: string }[]) {
      nameMap.set(o.id, o.name);
    }
  }

  const topTenants = topEntries.map(([orgId, count]) => ({
    orgId,
    orgName: nameMap.get(orgId) ?? orgId,
    count,
  }));

  const flaggedTenants = flaggedEntries.map(([orgId, todayCount]) => {
    const avg = (orgTotal30.get(orgId) ?? 0) / 30;
    return {
      orgId,
      orgName: nameMap.get(orgId) ?? orgId,
      todayCount,
      avgCount: avg,
      ratio: todayCount / avg,
    };
  });

  return NextResponse.json({
    workerStatus: workerRow
      ? {
          status: String(workerRow["status"] ?? ""),
          lastHeartbeat: String(workerRow["last_heartbeat_at"] ?? ""),
          itemsProcessedToday: Number(workerRow["items_processed"] ?? 0),
          startedAt: String(workerRow["started_at"] ?? ""),
        }
      : null,
    queueDepth,
    platformPaused,
    submissionMetrics: {
      successRate24h: successRate(rows24),
      successRate7d: successRate(rows7),
      successRate30d: successRate(rows30),
      perHour,
      failureBreakdown,
    },
    costs: {
      totalToday: totalCostToday,
      costPerSubmission,
      breakdown: [
        { category: "Claude AI", amount: costTotals.claude },
        { category: "OpenAI", amount: costTotals.openai },
        { category: "Proxy", amount: costTotals.proxy },
        { category: "CAPTCHA", amount: costTotals.captcha },
      ],
    },
    portalHealth: { blockRates, antiAutomation },
    tenantActivity: { topTenants, flaggedTenants },
  });
}
