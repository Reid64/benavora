import type { SupabaseClient } from '@supabase/supabase-js'

export interface GrantHistoryLineItem {
  recipient: string
  amount: number | null
  year: number | null
  purpose: string | null
}

export interface FoundationProfile {
  foundation_id: string
  avg_grant_size: number | null
  geographic_focus: string[]
  funding_categories: string[]
  total_grants_made: number | null
  top_recipients: unknown | null
  /** Per-recipient 990 Schedule I line items (row #66), when the
   * foundation's enrichment includes them (scripts/enrich-foundations-990.ts,
   * IRS990Source Schedule I parsing). Null when no such filing was found or
   * this foundation has never made a scheduled grant — not every filer has
   * one, and absence isn't an extraction failure. */
  grant_history: GrantHistoryLineItem[] | null
}

function toStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((v): v is string => typeof v === 'string')
}

function parseGrantRangeMidpoint(raw: unknown): number | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (typeof r['min'] === 'number' && typeof r['max'] === 'number') {
    return (r['min'] + r['max']) / 2
  }
  return null
}

function parseGrantHistory(raw: unknown): GrantHistoryLineItem[] | null {
  if (!Array.isArray(raw)) return null
  const items = raw
    .filter((v): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v))
    .map((v) => ({
      recipient: typeof v['recipient'] === 'string' ? v['recipient'] : '',
      amount: typeof v['amount'] === 'number' ? v['amount'] : null,
      year: typeof v['year'] === 'number' ? v['year'] : null,
      purpose: typeof v['purpose'] === 'string' ? v['purpose'] : null,
    }))
    .filter((item) => item.recipient.length > 0)
  return items.length > 0 ? items : null
}

/**
 * Computes a foundation's profile from foundation_directory's giving_total
 * and its 990-derived `enrichment` jsonb (grant_count, typical_grant_range,
 * program_priorities, geographic_focus, top_recipients, grant_history — see
 * scripts/enrich-foundations-990.ts). Falls back to the enrichment's
 * typical_grant_range midpoint when grant_count/giving_total aren't both
 * available, and to the directory's own geographic_focus column when the
 * enrichment doesn't carry one. grant_history (row #66) is a pure passthrough
 * of whatever per-recipient Schedule I line items the 990 extractor found —
 * this function does not parse XML itself, it only reads what's already
 * been written to enrichment.
 */
export async function computeFoundationProfile(
  foundationId: string,
  supabase: SupabaseClient,
): Promise<FoundationProfile> {
  const { data: foundation } = await supabase
    .from('foundation_directory')
    .select('geographic_focus, giving_total, enrichment')
    .eq('id', foundationId)
    .maybeSingle()

  const enrichment = (foundation?.enrichment ?? {}) as Record<string, unknown>

  const grantCount = typeof enrichment['grant_count'] === 'number' ? enrichment['grant_count'] : null
  const givingTotal = typeof foundation?.giving_total === 'number' ? foundation.giving_total : null

  const avgGrantSize =
    givingTotal !== null && grantCount !== null && grantCount > 0
      ? givingTotal / grantCount
      : parseGrantRangeMidpoint(enrichment['typical_grant_range'])

  const fundingCategories = Array.from(
    new Set([
      ...toStringArray(enrichment['program_priorities']),
      ...toStringArray(enrichment['funding_categories']),
    ]),
  )

  const enrichmentGeoFocus = toStringArray(enrichment['geographic_focus'])
  const geographicFocus =
    enrichmentGeoFocus.length > 0
      ? enrichmentGeoFocus
      : foundation?.geographic_focus
        ? [foundation.geographic_focus as string]
        : []

  const totalGrantsMade = givingTotal

  const topRecipients = Array.isArray(enrichment['top_recipients'])
    ? enrichment['top_recipients']
    : null

  const grantHistory = parseGrantHistory(enrichment['grant_history'])

  return {
    foundation_id: foundationId,
    avg_grant_size: avgGrantSize,
    geographic_focus: geographicFocus,
    funding_categories: fundingCategories,
    total_grants_made: totalGrantsMade,
    top_recipients: topRecipients,
    grant_history: grantHistory,
  }
}
