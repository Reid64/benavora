import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function getPeriodStart(period: string): string | null {
  const now = new Date();
  switch (period) {
    case "7d":
      now.setDate(now.getDate() - 7);
      return now.toISOString();
    case "30d":
      now.setDate(now.getDate() - 30);
      return now.toISOString();
    case "90d":
      now.setDate(now.getDate() - 90);
      return now.toISOString();
    default:
      return null;
  }
}

function pct(num: number, den: number): number {
  return den > 0 ? Math.round((num / den) * 10000) / 100 : 0;
}

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }

  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period") ?? "30d";
  const campaignId = searchParams.get("campaign_id");

  const supabase = createAdminClient();
  const periodStart = getPeriodStart(period);

  // Fetch sends with period and optional campaign filter
  let sendsQuery = supabase
    .from("sales_sends")
    .select(
      "id, campaign_id, prospect_id, to_address, subject, sent_at, opened_at, replied_at, bounced_at, unsubscribed_at",
    );

  if (periodStart) sendsQuery = sendsQuery.gte("sent_at", periodStart);
  if (campaignId) sendsQuery = sendsQuery.eq("campaign_id", campaignId);

  const { data: sendsData, error: sendsError } = await sendsQuery;
  if (sendsError) {
    return NextResponse.json({ error: sendsError.message }, { status: 500 });
  }
  const sends = sendsData ?? [];

  // Fetch campaigns for name lookup
  const { data: campaignsData } = await supabase
    .from("sales_campaigns")
    .select("id, name");
  const campaignMap = new Map((campaignsData ?? []).map((c) => [c.id, c.name]));

  // Fetch prospect details for sends that have a prospect_id
  const prospectIds = [
    ...new Set(
      sends.flatMap((s) => (s.prospect_id ? [s.prospect_id] : [])),
    ),
  ];

  type ProspectInfo = { state: string | null; has_converted: boolean | null };
  const prospectMap = new Map<string, ProspectInfo>();

  if (prospectIds.length > 0) {
    const { data: prospectsData } = await supabase
      .from("prospects")
      .select("id, state, has_converted")
      .in("id", prospectIds);
    for (const p of prospectsData ?? []) {
      prospectMap.set(p.id, { state: p.state ?? null, has_converted: p.has_converted ?? null });
    }
  }

  // Overview counts
  const totalSent = sends.filter((s) => s.sent_at).length;
  const totalBounced = sends.filter((s) => s.bounced_at).length;
  const totalDelivered = totalSent - totalBounced;
  const totalOpened = sends.filter((s) => s.opened_at).length;
  const totalReplied = sends.filter((s) => s.replied_at).length;
  const totalUnsubscribed = sends.filter((s) => s.unsubscribed_at).length;

  // Converted = distinct prospects that have has_converted=true among sent emails
  const convertedProspects = new Set(
    sends
      .filter((s) => s.sent_at && s.prospect_id && prospectMap.get(s.prospect_id ?? "")?.has_converted === true)
      .flatMap((s) => (s.prospect_id ? [s.prospect_id] : [])),
  );
  const totalConverted = convertedProspects.size;

  const overview = {
    total_sent: totalSent,
    total_delivered: totalDelivered,
    total_opened: totalOpened,
    total_replied: totalReplied,
    total_bounced: totalBounced,
    total_unsubscribed: totalUnsubscribed,
    total_converted: totalConverted,
  };

  const rates = {
    delivery_rate: pct(totalDelivered, totalSent),
    open_rate: pct(totalOpened, totalDelivered),
    reply_rate: pct(totalReplied, totalDelivered),
    bounce_rate: pct(totalBounced, totalSent),
    unsubscribe_rate: pct(totalUnsubscribed, totalDelivered),
    conversion_rate: pct(totalConverted, totalDelivered),
  };

  // By campaign
  const campaignStats = new Map<string, { sent: number; replied: number; bounced: number }>();
  for (const s of sends) {
    if (!s.campaign_id || !s.sent_at) continue;
    const stat = campaignStats.get(s.campaign_id) ?? { sent: 0, replied: 0, bounced: 0 };
    stat.sent++;
    if (s.replied_at) stat.replied++;
    if (s.bounced_at) stat.bounced++;
    campaignStats.set(s.campaign_id, stat);
  }
  const byCampaign = [...campaignStats.entries()].map(([id, stat]) => ({
    id,
    name: campaignMap.get(id) ?? "Unknown",
    sent: stat.sent,
    replied: stat.replied,
    reply_rate: pct(stat.replied, stat.sent),
    bounce_rate: pct(stat.bounced, stat.sent),
  }));

  // By domain (recipient domain from to_address)
  const domainStats = new Map<string, { sent: number; bounced: number }>();
  for (const s of sends) {
    if (!s.sent_at) continue;
    const atIdx = s.to_address.indexOf("@");
    const domain = atIdx >= 0 ? s.to_address.slice(atIdx + 1) : "unknown";
    const stat = domainStats.get(domain) ?? { sent: 0, bounced: 0 };
    stat.sent++;
    if (s.bounced_at) stat.bounced++;
    domainStats.set(domain, stat);
  }
  const byDomain = [...domainStats.entries()]
    .map(([domain, stat]) => {
      const bounceRate = pct(stat.bounced, stat.sent);
      const healthStatus = bounceRate > 10 ? "unhealthy" : bounceRate > 5 ? "at_risk" : "healthy";
      return { domain, sent: stat.sent, bounced: stat.bounced, bounce_rate: bounceRate, health_status: healthStatus };
    })
    .sort((a, b) => b.sent - a.sent)
    .slice(0, 50);

  // By day
  const dayStats = new Map<string, { sent: number; replied: number; bounced: number }>();
  for (const s of sends) {
    if (!s.sent_at) continue;
    const day = s.sent_at.slice(0, 10);
    const stat = dayStats.get(day) ?? { sent: 0, replied: 0, bounced: 0 };
    stat.sent++;
    if (s.replied_at) stat.replied++;
    if (s.bounced_at) stat.bounced++;
    dayStats.set(day, stat);
  }
  const byDay = [...dayStats.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, stat]) => ({ date, sent: stat.sent, replied: stat.replied, bounced: stat.bounced }));

  // By state — contacted/replied counts are distinct prospect sets
  const stateContacted = new Map<string, Set<string>>();
  const stateReplied = new Map<string, Set<string>>();
  for (const s of sends) {
    if (!s.sent_at || !s.prospect_id) continue;
    const info = prospectMap.get(s.prospect_id);
    const state = info?.state ?? "Unknown";
    if (!stateContacted.has(state)) stateContacted.set(state, new Set());
    stateContacted.get(state)?.add(s.prospect_id);
    if (s.replied_at) {
      if (!stateReplied.has(state)) stateReplied.set(state, new Set());
      stateReplied.get(state)?.add(s.prospect_id);
    }
  }

  const { data: allProspectsData } = await supabase.from("prospects").select("state");
  const totalByState = new Map<string, number>();
  for (const p of allProspectsData ?? []) {
    const state = p.state ?? "Unknown";
    totalByState.set(state, (totalByState.get(state) ?? 0) + 1);
  }

  const allStates = new Set([...stateContacted.keys(), ...totalByState.keys()]);
  const byState = [...allStates]
    .map((state) => ({
      state,
      prospects: totalByState.get(state) ?? 0,
      contacted: stateContacted.get(state)?.size ?? 0,
      replied: stateReplied.get(state)?.size ?? 0,
    }))
    .filter((s) => s.prospects > 0 || s.contacted > 0)
    .sort((a, b) => b.prospects - a.prospects)
    .slice(0, 50);

  // Top subject lines
  const subjectStats = new Map<string, { sends: number; replies: number }>();
  for (const s of sends) {
    if (!s.sent_at || !s.subject) continue;
    const stat = subjectStats.get(s.subject) ?? { sends: 0, replies: 0 };
    stat.sends++;
    if (s.replied_at) stat.replies++;
    subjectStats.set(s.subject, stat);
  }
  const topSubjectLines = [...subjectStats.entries()]
    .map(([subject, stat]) => ({
      subject,
      sends: stat.sends,
      replies: stat.replies,
      reply_rate: pct(stat.replies, stat.sends),
    }))
    .sort((a, b) => b.sends - a.sends)
    .slice(0, 20);

  // Send time performance by UTC hour
  const hourStats = new Map<number, { sends: number; replies: number }>();
  for (const s of sends) {
    if (!s.sent_at) continue;
    const hour = new Date(s.sent_at).getUTCHours();
    const stat = hourStats.get(hour) ?? { sends: 0, replies: 0 };
    stat.sends++;
    if (s.replied_at) stat.replies++;
    hourStats.set(hour, stat);
  }
  const sendTimePerformance = Array.from({ length: 24 }, (_, hour) => {
    const stat = hourStats.get(hour) ?? { sends: 0, replies: 0 };
    return { hour, sends: stat.sends, replies: stat.replies, reply_rate: pct(stat.replies, stat.sends) };
  });

  return NextResponse.json({
    overview,
    rates,
    by_campaign: byCampaign,
    by_domain: byDomain,
    by_day: byDay,
    by_state: byState,
    top_subject_lines: topSubjectLines,
    send_time_performance: sendTimePerformance,
  });
}
