"use strict";
/* eslint-disable @typescript-eslint/no-explicit-any */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getResponseTimeStats = getResponseTimeStats;
exports.getChannelComparison = getChannelComparison;
exports.getConversionFunnel = getConversionFunnel;
exports.getROICalculation = getROICalculation;
// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
function medianOf(values) {
    if (values.length === 0)
        return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
        ? (sorted[mid] ?? 0)
        : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}
function daysBetween(from, to) {
    return (new Date(to).getTime() - new Date(from).getTime()) / (1000 * 60 * 60 * 24);
}
function average(values) {
    if (values.length === 0)
        return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
}
// ---------------------------------------------------------------------------
// getResponseTimeStats
// ---------------------------------------------------------------------------
async function getResponseTimeStats(orgId, supabase) {
    const { data: allRows } = (await supabase
        .from('autoapply_submissions')
        .select('id, funder_id, submitted_at, response_received_at, submission_channel, funders(name, category)')
        .eq('organization_id', orgId)
        .not('submitted_at', 'is', null));
    const rows = allRows ?? [];
    // Separate responded from pending
    const responded = rows.filter((r) => r.response_received_at !== null && r.submitted_at !== null);
    const pending = rows.filter((r) => r.response_received_at === null && r.submitted_at !== null);
    // All response-time values in days
    const allDays = responded.map((r) => daysBetween(r.submitted_at, r.response_received_at));
    const overall = {
        averageDays: average(allDays),
        medianDays: medianOf(allDays),
        fastestDays: allDays.length > 0 ? Math.min(...allDays) : 0,
        slowestDays: allDays.length > 0 ? Math.max(...allDays) : 0,
        totalWithResponse: responded.length,
    };
    // Per-funder stats from responded set
    const funderMap = new Map();
    for (const r of rows) {
        const fid = r.funder_id ?? 'unknown';
        if (!funderMap.has(fid)) {
            funderMap.set(fid, {
                name: r.funders?.name ?? fid,
                days: [],
                totalSubmissions: 0,
            });
        }
        const entry = funderMap.get(fid);
        entry.totalSubmissions += 1;
        if (r.response_received_at !== null && r.submitted_at !== null) {
            entry.days.push(daysBetween(r.submitted_at, r.response_received_at));
        }
    }
    const byFunder = Array.from(funderMap.entries()).map(([funderId, info]) => ({
        funderId,
        funderName: info.name,
        averageDays: average(info.days),
        totalSubmissions: info.totalSubmissions,
        totalResponses: info.days.length,
    }));
    // Per-category stats
    const categoryMap = new Map();
    for (const r of rows) {
        const cat = r.funders?.category ?? 'uncategorized';
        if (!categoryMap.has(cat)) {
            categoryMap.set(cat, { days: [], totalSubmissions: 0 });
        }
        const entry = categoryMap.get(cat);
        entry.totalSubmissions += 1;
        if (r.response_received_at !== null && r.submitted_at !== null) {
            entry.days.push(daysBetween(r.submitted_at, r.response_received_at));
        }
    }
    const byCategory = Array.from(categoryMap.entries()).map(([category, info]) => ({
        category,
        averageDays: average(info.days),
        totalSubmissions: info.totalSubmissions,
        totalResponses: info.days.length,
    }));
    // Overdue: pending submissions where elapsed > funder avg * 1.5
    const funderAvgMap = new Map();
    for (const f of byFunder) {
        if (f.totalResponses > 0)
            funderAvgMap.set(f.funderId, f.averageDays);
    }
    const overdue = [];
    const now = Date.now();
    for (const r of pending) {
        const fid = r.funder_id ?? 'unknown';
        const avgForFunder = funderAvgMap.get(fid) ?? (overall.averageDays > 0 ? overall.averageDays : 30);
        const threshold = avgForFunder * 1.5;
        const daysElapsed = (now - new Date(r.submitted_at).getTime()) / (1000 * 60 * 60 * 24);
        if (daysElapsed > threshold) {
            overdue.push({
                submissionId: r.id,
                funderId: fid,
                funderName: r.funders?.name ?? fid,
                submittedAt: r.submitted_at,
                daysElapsed: Math.round(daysElapsed * 10) / 10,
                expectedResponseDays: Math.round(avgForFunder * 10) / 10,
            });
        }
    }
    return { overall, byFunder, byCategory, overdue };
}
// ---------------------------------------------------------------------------
// getChannelComparison
// ---------------------------------------------------------------------------
async function getChannelComparison(orgId, supabase) {
    const { data: allRows } = (await supabase
        .from('autoapply_submissions')
        .select('submission_channel, submitted_at, response_received_at, confirmation_data, status')
        .eq('organization_id', orgId)
        .not('submitted_at', 'is', null));
    const rows = allRows ?? [];
    const channelMap = new Map();
    for (const r of rows) {
        const channel = r.submission_channel ?? 'unknown';
        if (!channelMap.has(channel)) {
            channelMap.set(channel, { total: 0, success: 0, responseDays: [] });
        }
        const entry = channelMap.get(channel);
        entry.total += 1;
        // "Success" = submitted and (confirmed OR responded)
        const confirmed = r.confirmation_data !== null;
        const responded = r.response_received_at !== null;
        if (confirmed || responded)
            entry.success += 1;
        if (r.response_received_at !== null && r.submitted_at !== null) {
            entry.responseDays.push(daysBetween(r.submitted_at, r.response_received_at));
        }
    }
    const channels = Array.from(channelMap.entries()).map(([channel, info]) => ({
        channel,
        totalCount: info.total,
        successCount: info.success,
        responseRate: info.total > 0 ? (info.success / info.total) * 100 : 0,
        averageResponseDays: info.responseDays.length > 0 ? average(info.responseDays) : null,
    }));
    return { channels };
}
// ---------------------------------------------------------------------------
// getConversionFunnel
// ---------------------------------------------------------------------------
async function getConversionFunnel(orgId, supabase) {
    const [queueRes, submissionsRes, agreementsRes] = await Promise.all([
        supabase
            .from('submission_queue')
            .select('count', { count: 'exact', head: true })
            .eq('organization_id', orgId),
        supabase
            .from('autoapply_submissions')
            .select('id, confirmation_data, response_received_at')
            .eq('organization_id', orgId),
        supabase
            .from('grant_agreements')
            .select('amount_awarded, submission_id')
            .eq('organization_id', orgId)
            .gt('amount_awarded', 0),
    ]);
    const queueCount = queueRes.count ?? 0;
    const submissions = submissionsRes.data ?? [];
    const submittedCount = submissions.length;
    const confirmedCount = submissions.filter((s) => s.confirmation_data !== null).length;
    const respondedCount = submissions.filter((s) => s.response_received_at !== null).length;
    const agreements = agreementsRes.data ?? [];
    // Only count agreements linked to an autoapply submission
    const submissionIds = new Set(submissions.map((s) => s.id));
    const fundedCount = agreements.filter((a) => a.submission_id !== null && submissionIds.has(a.submission_id)).length;
    const stageCounts = [queueCount, submittedCount, confirmedCount, respondedCount, fundedCount];
    const stageNames = ['Queued', 'Submitted', 'Confirmed', 'Responded', 'Funded'];
    const stages = stageNames.map((stage, i) => {
        const count = stageCounts[i] ?? 0;
        const prev = i > 0 ? (stageCounts[i - 1] ?? 0) : null;
        const dropOffRate = prev !== null && prev > 0 ? ((prev - count) / prev) * 100 : null;
        const retentionRate = prev !== null && prev > 0 ? (count / prev) * 100 : null;
        return { stage, count, dropOffRate, retentionRate };
    });
    const ultimateConversionRate = queueCount > 0 ? (fundedCount / queueCount) * 100 : 0;
    return { stages, totalQueued: queueCount, ultimateConversionRate };
}
// ---------------------------------------------------------------------------
// getROICalculation
// ---------------------------------------------------------------------------
async function getROICalculation(orgId, supabase) {
    const [agreementsRes, usageRes, submissionsCountRes] = await Promise.all([
        supabase
            .from('grant_agreements')
            .select('amount_awarded')
            .eq('organization_id', orgId)
            .gt('amount_awarded', 0),
        supabase
            .from('submission_usage')
            .select('api_cost_claude, api_cost_openai, proxy_cost, captcha_cost, overage_cost')
            .eq('organization_id', orgId),
        supabase
            .from('autoapply_submissions')
            .select('count', { count: 'exact', head: true })
            .eq('organization_id', orgId),
    ]);
    const agreements = agreementsRes.data ?? [];
    const totalFunded = agreements.reduce((sum, a) => sum + (a.amount_awarded ?? 0), 0);
    const usageRows = usageRes.data ?? [];
    const breakdown = usageRows.reduce((acc, r) => ({
        claudeCost: acc.claudeCost + (r.api_cost_claude ?? 0),
        openaiCost: acc.openaiCost + (r.api_cost_openai ?? 0),
        proxyCost: acc.proxyCost + (r.proxy_cost ?? 0),
        captchaCost: acc.captchaCost + (r.captcha_cost ?? 0),
        overageCost: acc.overageCost + (r.overage_cost ?? 0),
    }), { claudeCost: 0, openaiCost: 0, proxyCost: 0, captchaCost: 0, overageCost: 0 });
    const totalCost = breakdown.claudeCost +
        breakdown.openaiCost +
        breakdown.proxyCost +
        breakdown.captchaCost +
        breakdown.overageCost;
    const totalSubmissions = submissionsCountRes.count ?? 0;
    const roi = totalCost > 0 ? ((totalFunded - totalCost) / totalCost) * 100 : null;
    const costPerSubmission = totalSubmissions > 0 ? totalCost / totalSubmissions : null;
    const costPerFundedDollar = totalFunded > 0 ? totalCost / totalFunded : null;
    return {
        totalFunded,
        totalCost,
        roi,
        costPerSubmission,
        costPerFundedDollar,
        totalSubmissions,
        breakdown,
    };
}
