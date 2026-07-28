// Scores and reorders pending submission_queue items for an organization
// so the highest-value submissions execute first if the worker is interrupted.
//
// Composite score (0–100):
//   timing              15% — seasonal conversion window for this funder type
//   funder match        20% — prior form template analysis (proven portal mapping)
//   historical          20% — win rate from past submissions to this funder
//   amount align        10% — giving history present (calibrated ask amount)
//   portal health       10% — last-known portal status
//   deadline proximity  15% — days remaining on the funder's nearest open opportunity
//   probability score    7% — opportunity_probability_scores.overall_score (Feature #102), if scored
//   org tier              3% — organizations.subscription_tier (paid tiers get a small priority edge)

import type { SupabaseClient } from '@supabase/supabase-js';
import { getTimingScore } from '../src/lib/autoapply/timing-optimizer.js';

interface QueueRow {
  id: string;
  organization_id: string;
  funder_id: string | null;
}

interface FunderRow {
  id: string;
  category: string | null;
  type: string | null;
  portal_status: string | null;
}

interface SubmissionRow {
  funder_id: string | null;
  status: string | null;
}

interface GivingHistoryRow {
  funder_id: string | null;
}

interface TemplateRow {
  funder_id: string | null;
}

interface OpportunityRow {
  id: string;
  funder_id: string | null;
  deadline: string | null;
}

interface ProbabilityScoreRow {
  opportunity_id: string;
  overall_score: number | null;
}

/** 0–1 score from days remaining until deadline. No open opportunity/deadline → neutral. */
function computeDeadlineProximityScore(deadline: string | null): number {
  if (deadline === null) return 0.4;
  const daysRemaining = (new Date(deadline).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
  if (daysRemaining <= 7) return 1.0;
  if (daysRemaining <= 14) return 0.85;
  if (daysRemaining <= 30) return 0.65;
  if (daysRemaining <= 60) return 0.45;
  if (daysRemaining <= 90) return 0.3;
  return 0.15;
}

/** 0–1 score from organizations.subscription_tier. */
function computeTierScore(tier: string | null): number {
  switch (tier) {
    case 'enterprise':
      return 1.0;
    case 'professional':
      return 0.7;
    case 'starter':
      return 0.4;
    default:
      return 0.2; // 'free' or unset
  }
}

export async function scoreAndReorderQueue(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<{ reordered: number }> {
  // Fetch all pending items for this org.
  const { data: items, error: queueError } = await supabase
    .from('submission_queue')
    .select('id, organization_id, funder_id')
    .eq('organization_id', organizationId)
    .eq('status', 'pending');

  if (queueError || !items || (items as QueueRow[]).length < 5) {
    return { reordered: 0 };
  }

  const queueRows = items as QueueRow[];
  const funderIds = [
    ...new Set(queueRows.map((r) => r.funder_id).filter((id): id is string => id !== null)),
  ];

  if (funderIds.length === 0) return { reordered: 0 };

  // Fetch funder metadata in one query.
  const { data: fundersData } = await supabase
    .from('funders')
    .select('id, category, type, portal_status')
    .in('id', funderIds);

  const funderMap = new Map<string, FunderRow>(
    ((fundersData ?? []) as FunderRow[]).map((f) => [f.id, f]),
  );

  // Fetch submission history to compute per-funder win rates.
  const { data: submissionsData } = await supabase
    .from('autoapply_submissions')
    .select('funder_id, status')
    .eq('organization_id', organizationId)
    .in('funder_id', funderIds);

  const winRateMap = new Map<string, { success: number; total: number }>();
  for (const row of (submissionsData ?? []) as SubmissionRow[]) {
    if (!row.funder_id) continue;
    const entry = winRateMap.get(row.funder_id) ?? { success: 0, total: 0 };
    entry.total++;
    if (row.status === 'submitted' || row.status === 'completed') entry.success++;
    winRateMap.set(row.funder_id, entry);
  }

  // Fetch form_templates to identify funders with a proven portal mapping.
  const { data: templatesData } = await supabase
    .from('form_templates')
    .select('funder_id')
    .in('funder_id', funderIds);

  const templateFunderIds = new Set<string>(
    ((templatesData ?? []) as TemplateRow[])
      .map((t) => t.funder_id)
      .filter((id): id is string => id !== null),
  );

  // Fetch giving history presence per funder (indicates a calibrated ask amount).
  const { data: givingData } = await supabase
    .from('funder_giving_history')
    .select('funder_id')
    .eq('organization_id', organizationId)
    .in('funder_id', funderIds);

  const givingFunderIds = new Set<string>(
    ((givingData ?? []) as GivingHistoryRow[])
      .map((r) => r.funder_id)
      .filter((id): id is string => id !== null),
  );

  // Fetch each funder's nearest open opportunity (deadline proximity) for this org.
  // Real deadlines sort first (ascending, nulls last) so the first row seen per
  // funder below is the soonest-closing open opportunity, if any.
  const { data: opportunitiesData } = await supabase
    .from('opportunities')
    .select('id, funder_id, deadline')
    .eq('organization_id', organizationId)
    .eq('status', 'open')
    .in('funder_id', funderIds)
    .order('deadline', { ascending: true, nullsFirst: false });

  const nearestOpportunityByFunder = new Map<string, OpportunityRow>();
  for (const opp of (opportunitiesData ?? []) as OpportunityRow[]) {
    if (opp.funder_id !== null && !nearestOpportunityByFunder.has(opp.funder_id)) {
      nearestOpportunityByFunder.set(opp.funder_id, opp);
    }
  }

  // Fetch probability scores (Feature #102) for those nearest opportunities, if scored.
  const nearestOpportunityIds = [...nearestOpportunityByFunder.values()].map((o) => o.id);
  const probabilityByOpportunity = new Map<string, number>();
  if (nearestOpportunityIds.length > 0) {
    const { data: probabilityData } = await supabase
      .from('opportunity_probability_scores')
      .select('opportunity_id, overall_score')
      .eq('organization_id', organizationId)
      .in('opportunity_id', nearestOpportunityIds);

    for (const row of (probabilityData ?? []) as ProbabilityScoreRow[]) {
      if (row.overall_score !== null) probabilityByOpportunity.set(row.opportunity_id, row.overall_score);
    }
  }

  // Fetch org tier once — applies uniformly to every item in this org's batch.
  const { data: orgData } = await supabase
    .from('organizations')
    .select('subscription_tier')
    .eq('id', organizationId)
    .maybeSingle();
  const tierScore = computeTierScore((orgData as { subscription_tier: string | null } | null)?.subscription_tier ?? null);

  // Score and update each queue item.
  let reordered = 0;

  for (const item of queueRows) {
    const funderId = item.funder_id ?? '';
    const funder = funderMap.get(funderId);

    // 1. Timing (15%)
    const timingResult = getTimingScore({
      funderType: funder?.type ?? funder?.category ?? 'corporate',
      funderCategory: funder?.category ?? null,
    });
    const timingScore = timingResult.score * 15;

    // 2. Funder match (20%) — existing form template = proven mapping
    const funderMatchScore = templateFunderIds.has(funderId) ? 20 : 10;

    // 3. Historical success (20%) — actual win rate or neutral midpoint
    const stats = winRateMap.get(funderId);
    let historicalScore = 10;
    if (stats && stats.total > 0) {
      historicalScore = (stats.success / stats.total) * 20;
    }

    // 4. Amount alignment (10%) — giving history present → well-calibrated ask
    const amountAlignScore = givingFunderIds.has(funderId) ? 10 : (funder?.category ? 6.5 : 4.5);

    // 5. Portal health (10%)
    const portalStatus = funder?.portal_status ?? 'unknown';
    let portalScore: number;
    switch (portalStatus) {
      case 'active':
        portalScore = 10;
        break;
      case 'redirect':
        portalScore = 6;
        break;
      case 'unknown':
        portalScore = 5;
        break;
      default:
        portalScore = 0; // dead, requires_login, etc.
    }

    // 6. Deadline proximity (15%) — nearest open opportunity for this funder, if any
    const nearestOpportunity = nearestOpportunityByFunder.get(funderId) ?? null;
    const deadlineScore = computeDeadlineProximityScore(nearestOpportunity?.deadline ?? null) * 15;

    // 7. Probability score (7%) — Feature #102's opportunity_probability_scores, if scored
    const rawProbability = nearestOpportunity !== null
      ? probabilityByOpportunity.get(nearestOpportunity.id) ?? null
      : null;
    const probabilityScore = (rawProbability !== null ? rawProbability / 100 : 0.5) * 7;

    // 8. Organization tier (3%) — same value for every item in this batch
    const orgTierScore = tierScore * 3;

    const composite =
      timingScore + funderMatchScore + historicalScore + amountAlignScore + portalScore +
      deadlineScore + probabilityScore + orgTierScore;
    // Lower priority integer = processed first (matches queue ORDER BY priority ASC).
    const newPriority = Math.floor(100 - composite);

    const { error: updateError } = await supabase
      .from('submission_queue')
      .update({ priority: newPriority })
      .eq('id', item.id);

    if (!updateError) reordered++;
  }

  return { reordered };
}
