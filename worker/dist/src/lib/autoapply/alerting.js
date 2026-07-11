"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkAlerts = checkAlerts;
const SUCCESS_RATE_THRESHOLD = 50;
const DAILY_COST_THRESHOLD = 50;
const WORKER_STALE_MINUTES = 5;
const TENANT_ANOMALY_MULTIPLIER = 3;
const MIN_SUBMISSIONS_FOR_RATE_CHECK = 5;
/**
 * Check all AutoApply alert thresholds and return triggered alerts.
 *
 * Pass a service-role Supabase client for cross-tenant visibility, or a
 * regular session client to scope checks to a single organization.
 */
async function checkAlerts(supabase) {
    const alerts = [];
    const now = new Date();
    // — Worker offline > 5 minutes —
    const { data: workers } = await supabase
        .from("worker_status")
        .select("last_heartbeat_at")
        .order("last_heartbeat_at", { ascending: false })
        .limit(1);
    const worker = workers?.[0];
    if (!worker) {
        alerts.push({
            type: "worker_offline",
            severity: "critical",
            message: "No AutoApply worker has ever registered. Worker may not be deployed.",
        });
    }
    else {
        const diffMinutes = (now.getTime() - new Date(worker.last_heartbeat_at).getTime()) / 60000;
        if (diffMinutes > WORKER_STALE_MINUTES) {
            alerts.push({
                type: "worker_offline",
                severity: "critical",
                message: `Worker last heartbeat was ${Math.round(diffMinutes)} minutes ago — exceeds ${WORKER_STALE_MINUTES}-minute threshold.`,
            });
        }
    }
    // — Success rate < 50% in the last 1 hour —
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const { data: recentSubs } = await supabase
        .from("autoapply_submissions")
        .select("status")
        .gte("created_at", oneHourAgo);
    const recentRows = (recentSubs ?? []);
    if (recentRows.length >= MIN_SUBMISSIONS_FOR_RATE_CHECK) {
        const succeeded = recentRows.filter((r) => r.status === "submitted").length;
        const rate = (succeeded / recentRows.length) * 100;
        if (rate < SUCCESS_RATE_THRESHOLD) {
            alerts.push({
                type: "low_success_rate",
                severity: "critical",
                message: `Success rate is ${rate.toFixed(1)}% over the last hour (${recentRows.length} submissions). Threshold: ${SUCCESS_RATE_THRESHOLD}%.`,
            });
        }
    }
    // — Daily cost > $50 —
    const todayStart = new Date(now);
    todayStart.setUTCHours(0, 0, 0, 0);
    const { data: usageRows } = await supabase
        .from("submission_usage")
        .select("api_cost_claude, api_cost_openai, proxy_cost, captcha_cost")
        .gte("period_start", todayStart.toISOString());
    const totalCost = (usageRows ?? []).reduce((sum, r) => sum +
        (r.api_cost_claude ?? 0) +
        (r.api_cost_openai ?? 0) +
        (r.proxy_cost ?? 0) +
        (r.captcha_cost ?? 0), 0);
    if (totalCost > DAILY_COST_THRESHOLD) {
        alerts.push({
            type: "cost_exceeded",
            severity: "critical",
            message: `Daily spend is $${totalCost.toFixed(2)}, exceeding the $${DAILY_COST_THRESHOLD} threshold.`,
        });
    }
    // — Tenant exceeds 3× 30-day daily average —
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const todayIso = todayStart.toISOString();
    const { data: orgRows } = await supabase
        .from("autoapply_submissions")
        .select("organization_id, created_at")
        .gte("created_at", thirtyDaysAgo);
    const orgToday = new Map();
    const orgTotal30 = new Map();
    for (const row of (orgRows ?? [])) {
        orgTotal30.set(row.organization_id, (orgTotal30.get(row.organization_id) ?? 0) + 1);
        if (row.created_at >= todayIso) {
            orgToday.set(row.organization_id, (orgToday.get(row.organization_id) ?? 0) + 1);
        }
    }
    for (const [orgId, todayCount] of orgToday) {
        const avg30d = (orgTotal30.get(orgId) ?? 0) / 30;
        if (avg30d > 0 && todayCount > avg30d * TENANT_ANOMALY_MULTIPLIER) {
            alerts.push({
                type: "tenant_anomaly",
                severity: "warning",
                message: `Organization ${orgId} submitted ${todayCount} times today vs ${avg30d.toFixed(1)}/day average (${(todayCount / avg30d).toFixed(1)}× normal).`,
            });
        }
    }
    return alerts;
}
