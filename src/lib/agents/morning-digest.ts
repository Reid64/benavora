// Morning Digest — PLATFORM_VISION_ARCHITECTURE.md Pillar 2 (AI Opportunity
// Discovery Engine), AGENTS_v2.md AG-17 nightly pipeline's final step
// ("7:00 AM — Morning digest notification sent to users").
//
// Rolls up overnight discovery and relationship/reputation signals into one
// alerts row so a user gets a single daily brief instead of checking four
// separate pages. A plain function like runOpportunityDiscovery — no
// `agent_type` enum value, no Claude call, nothing to log to agent_runs.
// Writes nothing when there is nothing to report.

export interface MorningDigestCounts {
  newOpportunities: number;
  funderAlerts: number;
  upcomingDeadlines: number;
}

/**
 * Aggregates the last 24 hours of discovery matches plus current reputation
 * alerts, relationship recommendations, and near-term deadlines for `orgId`,
 * and inserts a single summary alert when there's anything to report.
 * `supabase` may be a session client (RLS on, route-triggered) or the admin
 * client (scheduled run) — every query is explicitly scoped by `orgId` so
 * both are safe.
 */
export async function sendMorningDigest(
  orgId: string,
  supabase: any,
): Promise<void> {
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const horizon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [discoveryRes, reputationRes, recommendationsRes, deadlinesRes] =
    await Promise.all([
      supabase
        .from("discovery_matches")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("status", "pending")
        .gt("created_at", since.toISOString()),
      supabase
        .from("reputation_alerts")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("status", "unread"),
      supabase
        .from("relationship_recommendations")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("status", "pending"),
      supabase
        .from("opportunities")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .gte("deadline", now.toISOString())
        .lte("deadline", horizon.toISOString()),
    ]);

  const counts: MorningDigestCounts = {
    newOpportunities: discoveryRes.count ?? 0,
    funderAlerts: (reputationRes.count ?? 0) + (recommendationsRes.count ?? 0),
    upcomingDeadlines: deadlinesRes.count ?? 0,
  };

  const totalItems =
    counts.newOpportunities + counts.funderAlerts + counts.upcomingDeadlines;
  if (totalItems === 0) return;

  const message =
    `Your Morning Funding Brief: ${counts.newOpportunities} new ` +
    `opportunities discovered, ${counts.funderAlerts} funder alerts, ` +
    `${counts.upcomingDeadlines} upcoming deadlines.`;

  await supabase.from("alerts").insert({
    organization_id: orgId,
    type: "system",
    severity: "info",
    message,
    dedup_key: `morning-digest:${now.toISOString().slice(0, 10)}`,
  });
}
