// Scores and reorders pending submission_queue items for an organization
// so the highest-value submissions execute first if the worker is interrupted.
//
// Composite score (0–100):
//   timing         20% — seasonal conversion window for this funder type
//   funder match   30% — prior form template analysis (proven portal mapping)
//   historical     25% — win rate from past submissions to this funder
//   amount align   15% — giving history present (calibrated ask amount)
//   portal health  10% — last-known portal status

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

  // Score and update each queue item.
  let reordered = 0;

  for (const item of queueRows) {
    const funderId = item.funder_id ?? '';
    const funder = funderMap.get(funderId);

    // 1. Timing (20%)
    const timingResult = getTimingScore({
      funderType: funder?.type ?? funder?.category ?? 'corporate',
      funderCategory: funder?.category ?? null,
    });
    const timingScore = timingResult.score * 20;

    // 2. Funder match (30%) — existing form template = proven mapping
    const funderMatchScore = templateFunderIds.has(funderId) ? 30 : 15;

    // 3. Historical success (25%) — actual win rate or neutral midpoint
    const stats = winRateMap.get(funderId);
    let historicalScore = 12.5;
    if (stats && stats.total > 0) {
      historicalScore = (stats.success / stats.total) * 25;
    }

    // 4. Amount alignment (15%) — giving history present → well-calibrated ask
    const amountAlignScore = givingFunderIds.has(funderId) ? 15 : (funder?.category ? 10 : 7);

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

    const composite = timingScore + funderMatchScore + historicalScore + amountAlignScore + portalScore;
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
