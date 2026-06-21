/* eslint-disable @typescript-eslint/no-explicit-any */

// Request types that carry no dollar amount — return null for these.
const NON_MONETARY_TYPES = new Set([
  'land',
  'in_kind',
  'volunteer',
  'service',
  'facility',
  'partnership',
]);

// Default ask amounts by funder category when no giving history is available.
const CATEGORY_DEFAULTS: Record<string, number> = {
  private_foundation: 25_000,
  corporate_foundation: 25_000,
  community_foundation: 15_000,
  corporate_donation: 10_000,
  corporate_sponsorship: 10_000,
  local_community_grant: 15_000,
  government_grant: 25_000,
  faith_compatible_grant: 10_000,
};

const DEFAULT_FALLBACK = 10_000;

export type AskAmountConfidence = 'high' | 'medium' | 'low';
export type AskAmountSource = 'giving_history' | 'category_average' | 'default';

export interface AskAmountResult {
  recommended: number;
  min: number;
  max: number;
  confidence: AskAmountConfidence;
  source: AskAmountSource;
}

export interface RequestProfileRange {
  request_type?: string | null;
  min_value?: number | null;
  max_value?: number | null;
}

export interface GetOptimalAskAmountParams {
  funderId: string;
  requestProfile?: RequestProfileRange | null;
  funderCategory?: string | null;
  supabase: any;
}

interface GivingHistoryRow {
  amount: number | null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  return sorted.length % 2 !== 0
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function applyProfileClamp(
  value: number,
  rawMin: number,
  rawMax: number,
  profile?: RequestProfileRange | null,
): { recommended: number; min: number; max: number } {
  const profileMin = profile?.min_value ?? null;
  const profileMax = profile?.max_value ?? null;

  const effectiveMin = profileMin !== null ? Math.max(rawMin, profileMin) : rawMin;
  const effectiveMax = profileMax !== null ? Math.min(rawMax, profileMax) : rawMax;
  // Ensure min <= max after clamping
  const finalMax = Math.max(effectiveMax, effectiveMin);
  const clamped = Math.max(effectiveMin, Math.min(finalMax, value));

  return { recommended: clamped, min: effectiveMin, max: finalMax };
}

/**
 * Returns the optimal ask amount for a monetary submission to a funder.
 * Returns null for non-monetary request types (land, in_kind, volunteer, service, facility).
 *
 * Priority order:
 *  1. Funder's own giving history (3+ records = high confidence, 1-2 = medium)
 *  2. Category average (low confidence)
 *  3. Platform default $10K (low confidence)
 *
 * Results are clamped to the request profile's min/max range when provided.
 */
export async function getOptimalAskAmount(
  params: GetOptimalAskAmountParams,
): Promise<AskAmountResult | null> {
  const { funderId, requestProfile, funderCategory, supabase } = params;

  // Non-monetary types have no dollar ask.
  const requestType = requestProfile?.request_type ?? null;
  if (requestType !== null && NON_MONETARY_TYPES.has(requestType)) {
    return null;
  }

  // Query the last 3 fiscal years of giving history for this funder.
  const cutoffYear = new Date().getFullYear() - 3;
  const { data } = (await supabase
    .from('funder_giving_history')
    .select('amount')
    .eq('funder_id', funderId)
    .not('amount', 'is', null)
    .gte('fiscal_year', cutoffYear)) as { data: GivingHistoryRow[] | null };

  const amounts = (data ?? [])
    .map((r) => r.amount)
    .filter((a): a is number => a !== null && a > 0);

  if (amounts.length > 0) {
    const med = median(amounts);
    const histMin = Math.min(...amounts);
    const histMax = Math.max(...amounts);
    const rawRecommended = Math.round(med * 1.1);
    const clamped = applyProfileClamp(rawRecommended, histMin, histMax, requestProfile);

    return {
      recommended: clamped.recommended,
      min: clamped.min,
      max: clamped.max,
      confidence: amounts.length >= 3 ? 'high' : 'medium',
      source: 'giving_history',
    };
  }

  // Fall back to category defaults.
  const categoryDefault =
    (funderCategory ? (CATEGORY_DEFAULTS[funderCategory] ?? null) : null) ??
    DEFAULT_FALLBACK;
  const source: AskAmountSource =
    funderCategory && CATEGORY_DEFAULTS[funderCategory] ? 'category_average' : 'default';

  const rawMin = Math.round(categoryDefault * 0.5);
  const rawMax = Math.round(categoryDefault * 2);
  const clamped = applyProfileClamp(categoryDefault, rawMin, rawMax, requestProfile);

  return {
    recommended: clamped.recommended,
    min: clamped.min,
    max: clamped.max,
    confidence: 'low',
    source,
  };
}
