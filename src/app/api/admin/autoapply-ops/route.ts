import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createAdminClient } from "@/lib/supabase/admin";

// Admin-only AutoApply operational metrics endpoint.
// Uses the service-role client for cross-tenant visibility.
// Authentication gate ensures only owner/admin callers reach the data queries.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function calcSuccessRate(rows: { status: string }[]): number {
  if (!rows.length) return 0;
  const succeeded = rows.filter((r) => r.status === "submitted").length;
  return (succeeded / rows.length) * 100;
}

export async function GET() {
  const gate = await requireRole("admin");
  if ("error" in gate) return gate.error;

  const admin = createAdminClient();
  const now = new Date();

  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);

  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // ── Worker status ─────────────────────────────────────────────────────────
  const { data: workers } = await admin
    .from("worker_status")
    .select("status, last_heartbeat_at, started_at, items_processed, items_failed")
    .order("last_heartbeat_at", { ascending: false })
    .limit(1);

  type WorkerRow = {
    status: string;
    last_heartbeat_at: string;
    started_at: string;
    items_processed: number;
  };
  const worker = ((workers ?? []) as WorkerRow[])[0] ?? null;

  // Count today's submitted items across all tenants
  const { count: processedTodayCount } = await admin
    .from("autoapply_submissions")
    .select("*", { count: "exact", head: true })
    .eq("status", "submitted")
    .gte("created_at", todayStart.toISOString());

  // ── Queue depth (all tenants, pending items) ──────────────────────────────
  const { count: queueDepth } = await admin
    .from("submission_queue")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");

  // ── Platform paused? ──────────────────────────────────────────────────────
  const { data: controls } = await admin
    .from("queue_controls")
    .select("paused")
    .eq("control_type", "platform")
    .eq("paused", true)
    .limit(1);
  const platformPaused = ((controls ?? []) as unknown[]).length > 0;

  // ── Submission metrics ────────────────────────────────────────────────────
  // Fetch 24h submissions with status + created_at (shared for rate, hourly, breakdown)
  const { data: raw24h } = await admin
    .from("autoapply_submissions")
    .select("status, created_at")
    .gte("created_at", oneDayAgo.toISOString());

  const { data: raw7d } = await admin
    .from("autoapply_submissions")
    .select("status")
    .gte("created_at", sevenDaysAgo.toISOString());

  const { data: raw30d } = await admin
    .from("autoapply_submissions")
    .select("status")
    .gte("created_at", thirtyDaysAgo.toISOString());

  type SubRow = { status: string; created_at: string };
  const subs24h = (raw24h ?? []) as SubRow[];

  // Per-hour buckets for the last 24 hours
  const perHour: { hour: string; count: number }[] = [];
  for (let i = 23; i >= 0; i--) {
    const h = new Date(now.getTime() - i * 60 * 60 * 1000);
    perHour.push({
      hour: `${String(h.getUTCHours()).padStart(2, "0")}:00`,
      count: 0,
    });
  }
  for (const row of subs24h) {
    const label = `${String(new Date(row.created_at).getUTCHours()).padStart(2, "0")}:00`;
    const bucket = perHour.find((b) => b.hour === label);
    if (bucket) bucket.count++;
  }

  // Failure breakdown — exclude terminal "success" and transient states
  const TERMINAL_FAILURES = new Set([
    "failed",
    "captcha_blocked",
    "account_required",
    "site_error",
    "timeout",
    "form_changed",
    "already_submitted",
    "portal_dead",
  ]);
  const failureCounts = new Map<string, number>();
  for (const row of subs24h) {
    if (TERMINAL_FAILURES.has(row.status)) {
      failureCounts.set(row.status, (failureCounts.get(row.status) ?? 0) + 1);
    }
  }
  const failureBreakdown = Array.from(failureCounts.entries())
    .map(([errorClass, count]) => ({ errorClass, count }))
    .sort((a, b) => b.count - a.count);

  // ── Cost tracking (today) ─────────────────────────────────────────────────
  const { data: usageRows } = await admin
    .from("submission_usage")
    .select(
      "api_cost_claude, api_cost_openai, proxy_cost, captcha_cost, automated_count, email_count, manual_count",
    )
    .gte("period_start", todayStart.toISOString());

  type UsageRow = {
    api_cost_claude: number;
    api_cost_openai: number;
    proxy_cost: number;
    captcha_cost: number;
    automated_count: number;
    email_count: number;
    manual_count: number;
  };
  let costClaude = 0;
  let costOpenai = 0;
  let costProxy = 0;
  let costCaptcha = 0;
  let totalSubsForCost = 0;
  for (const r of (usageRows ?? []) as UsageRow[]) {
    costClaude += r.api_cost_claude ?? 0;
    costOpenai += r.api_cost_openai ?? 0;
    costProxy += r.proxy_cost ?? 0;
    costCaptcha += r.captcha_cost ?? 0;
    totalSubsForCost +=
      (r.automated_count ?? 0) + (r.email_count ?? 0) + (r.manual_count ?? 0);
  }
  const totalToday = costClaude + costOpenai + costProxy + costCaptcha;
  const costPerSubmission = totalSubsForCost > 0 ? totalToday / totalSubsForCost : 0;

  // ── Portal health ─────────────────────────────────────────────────────────
  // Step 1: fetch 7-day submissions with funder_id + status
  const { data: recentSubs } = await admin
    .from("autoapply_submissions")
    .select("funder_id, status")
    .gte("created_at", sevenDaysAgo.toISOString())
    .not("funder_id", "is", null);

  type RecentSubRow = { funder_id: string; status: string };
  const recentSubRows = (recentSubs ?? []) as RecentSubRow[];

  // Step 2: fetch portal URLs for unique funder ids
  const uniqueFunderIds = Array.from(
    new Set(recentSubRows.map((r) => r.funder_id).filter(Boolean)),
  );

  const funderUrlMap = new Map<string, string>();
  if (uniqueFunderIds.length > 0) {
    const { data: funders } = await admin
      .from("funders")
      .select("id, giving_portal_url")
      .in("id", uniqueFunderIds)
      .not("giving_portal_url", "is", null);

    type FunderRow = { id: string; giving_portal_url: string | null };
    for (const f of (funders ?? []) as FunderRow[]) {
      if (f.giving_portal_url) funderUrlMap.set(f.id, f.giving_portal_url);
    }
  }

  // Step 3: aggregate domain stats
  const BLOCK_STATUSES = new Set(["captcha_blocked", "site_error", "portal_dead", "failed"]);
  const domainStats = new Map<string, { submissions: number; blocks: number }>();
  for (const row of recentSubRows) {
    const url = funderUrlMap.get(row.funder_id);
    if (!url) continue;
    const domain = extractDomain(url);
    if (!domain) continue;
    const existing = domainStats.get(domain) ?? { submissions: 0, blocks: 0 };
    existing.submissions++;
    if (BLOCK_STATUSES.has(row.status)) existing.blocks++;
    domainStats.set(domain, existing);
  }

  const blockRates = Array.from(domainStats.entries())
    .filter(([, s]) => s.submissions >= 2)
    .map(([domain, s]) => ({
      domain,
      submissions: s.submissions,
      blocks: s.blocks,
      blockRate: (s.blocks / s.submissions) * 100,
    }))
    .sort((a, b) => b.blockRate - a.blockRate)
    .slice(0, 10);

  // Anti-automation portals (across all tenants, deduplicated by URL)
  const { data: antiAutoFunders } = await admin
    .from("funders")
    .select("name, giving_portal_url, automation_notes")
    .eq("automation_level", "manual_only")
    .order("name");

  type AntiAutoRow = {
    name: string;
    giving_portal_url: string | null;
    automation_notes: string | null;
  };
  const seenAntiUrls = new Set<string>();
  const antiAutomation: { name: string; url: string; notes: string | null }[] = [];
  for (const f of (antiAutoFunders ?? []) as AntiAutoRow[]) {
    const url = f.giving_portal_url ?? "";
    if (!seenAntiUrls.has(url)) {
      seenAntiUrls.add(url);
      antiAutomation.push({ name: f.name, url, notes: f.automation_notes ?? null });
    }
  }

  // ── Tenant activity ───────────────────────────────────────────────────────
  const { data: todaySubs } = await admin
    .from("autoapply_submissions")
    .select("organization_id")
    .gte("created_at", todayStart.toISOString());

  type OrgRow = { organization_id: string };
  const orgTodayCount = new Map<string, number>();
  for (const row of (todaySubs ?? []) as OrgRow[]) {
    orgTodayCount.set(
      row.organization_id,
      (orgTodayCount.get(row.organization_id) ?? 0) + 1,
    );
  }

  // 30-day history for anomaly detection
  const { data: history30 } = await admin
    .from("autoapply_submissions")
    .select("organization_id, created_at")
    .gte("created_at", thirtyDaysAgo.toISOString())
    .lt("created_at", todayStart.toISOString());

  type HistRow = { organization_id: string; created_at: string };
  const orgTotal30 = new Map<string, number>();
  for (const row of (history30 ?? []) as HistRow[]) {
    orgTotal30.set(row.organization_id, (orgTotal30.get(row.organization_id) ?? 0) + 1);
  }

  // Identify top 5 and flagged tenants
  const sortedOrgs = Array.from(orgTodayCount.entries()).sort((a, b) => b[1] - a[1]);
  const topOrgIds = sortedOrgs.slice(0, 5).map(([id]) => id);

  const flaggedOrgIds = Array.from(orgTodayCount.entries())
    .filter(([orgId, todayCount]) => {
      const avg30d = (orgTotal30.get(orgId) ?? 0) / 30;
      return avg30d > 0 && todayCount > avg30d * 3;
    })
    .map(([id]) => id);

  // Resolve org names
  const allOrgIds = Array.from(new Set([...topOrgIds, ...flaggedOrgIds]));
  const orgNameMap = new Map<string, string>();
  if (allOrgIds.length > 0) {
    const { data: orgs } = await admin
      .from("organizations")
      .select("id, name")
      .in("id", allOrgIds);
    type OrgNameRow = { id: string; name: string };
    for (const o of (orgs ?? []) as OrgNameRow[]) {
      orgNameMap.set(o.id, o.name);
    }
  }

  const topTenants = topOrgIds.map((orgId) => ({
    orgId,
    orgName: orgNameMap.get(orgId) ?? orgId,
    count: orgTodayCount.get(orgId) ?? 0,
  }));

  const flaggedTenants = flaggedOrgIds
    .map((orgId) => {
      const todayCount = orgTodayCount.get(orgId) ?? 0;
      const avgCount = (orgTotal30.get(orgId) ?? 0) / 30;
      return {
        orgId,
        orgName: orgNameMap.get(orgId) ?? orgId,
        todayCount,
        avgCount,
        ratio: avgCount > 0 ? todayCount / avgCount : 0,
      };
    })
    .sort((a, b) => b.ratio - a.ratio);

  return NextResponse.json({
    workerStatus: worker
      ? {
          status: worker.status,
          lastHeartbeat: worker.last_heartbeat_at,
          itemsProcessedToday: processedTodayCount ?? 0,
          startedAt: worker.started_at,
        }
      : null,
    queueDepth: queueDepth ?? 0,
    platformPaused,
    submissionMetrics: {
      successRate24h: calcSuccessRate(subs24h),
      successRate7d: calcSuccessRate((raw7d ?? []) as { status: string }[]),
      successRate30d: calcSuccessRate((raw30d ?? []) as { status: string }[]),
      perHour,
      failureBreakdown,
    },
    costs: {
      totalToday,
      costPerSubmission,
      breakdown: [
        { category: "Claude AI", amount: costClaude },
        { category: "OpenAI", amount: costOpenai },
        { category: "Proxy", amount: costProxy },
        { category: "CAPTCHA", amount: costCaptcha },
      ],
    },
    portalHealth: {
      blockRates,
      antiAutomation,
    },
    tenantActivity: {
      topTenants,
      flaggedTenants,
    },
  });
}
