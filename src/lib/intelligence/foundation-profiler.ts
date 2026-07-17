import type { SupabaseClient } from '@supabase/supabase-js'

export interface FoundationProfile {
  foundation_id: string
  avg_grant_size: number | null
  geographic_focus: string[]
  funding_categories: string[]
  total_grants_made: number | null
  top_recipients: unknown | null
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

/**
 * Computes a foundation's profile from foundation_directory's giving_total
 * and its 990-derived `enrichment` jsonb (grant_count, typical_grant_range,
 * program_priorities, geographic_focus, top_recipients — see
 * scripts/enrich-foundations-990.ts). Falls back to the enrichment's
 * typical_grant_range midpoint when grant_count/giving_total aren't both
 * available, and to the directory's own geographic_focus column when the
 * enrichment doesn't carry one.
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

  return {
    foundation_id: foundationId,
    avg_grant_size: avgGrantSize,
    geographic_focus: geographicFocus,
    funding_categories: fundingCategories,
    total_grants_made: totalGrantsMade,
    top_recipients: topRecipients,
  }
}
