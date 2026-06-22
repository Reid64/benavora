import { createClient } from '@/lib/supabase/server'

export interface GrantmakerProfile {
  name: string
  ein: string | null
  city: string | null
  state: string | null
  avg_award: number | null
  total_giving: number | null
  geographic_focus: string[]
  program_priorities: string[]
  typical_award_range: { min: number; max: number } | null
  application_preferences: string | null
  language_patterns: string[]
  contact_info: { website: string | null; email: string | null; phone: string | null }
}

export interface FunderMatch {
  foundation_id: string
  name: string
  ein: string | null
  match_score: number
  match_reasons: string[]
}

function toStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((v): v is string => typeof v === 'string')
}

function extractStringField(raw: unknown, key: string): string | null {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) return null
  const val = (raw as Record<string, unknown>)[key]
  return typeof val === 'string' ? val : null
}

function parseAwardRange(raw: unknown): { min: number; max: number } | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (typeof r['min'] === 'number' && typeof r['max'] === 'number') {
    return { min: r['min'], max: r['max'] }
  }
  return null
}

export class GrantmakerProfileBuilder {
  async buildProfile(foundationId: string): Promise<GrantmakerProfile> {
    const client = await createClient()

    const { data: foundation } = await client
      .from('foundation_directory')
      .select('*')
      .eq('id', foundationId)
      .single()

    const { data: enrichments } = await client
      .from('enrichment_results')
      .select('*')
      .eq('entity_id', foundationId)
      .order('created_at', { ascending: false })
      .limit(10)

    const { data: stored } = await client
      .from('intelligence_grantmaker_profiles')
      .select('*')
      .eq('foundation_id', foundationId)
      .maybeSingle()

    const priorities: string[] = [
      ...toStringArray(stored?.program_priorities),
    ]
    for (const e of enrichments ?? []) {
      for (const p of toStringArray(e.found_programs)) {
        if (!priorities.includes(p)) priorities.push(p)
      }
    }

    const languagePatterns = toStringArray(stored?.language_patterns)
    const geoFocus = toStringArray(stored?.geographic_focus)
    if (foundation?.geographic_focus && !geoFocus.includes(foundation.geographic_focus)) {
      geoFocus.push(foundation.geographic_focus)
    }

    return {
      name: foundation?.name ?? stored?.name ?? '',
      ein: foundation?.ein ?? stored?.ein ?? null,
      city: foundation?.city ?? null,
      state: foundation?.state ?? null,
      avg_award: stored?.avg_award_amount ?? null,
      total_giving: foundation?.giving_total ?? stored?.total_annual_giving ?? null,
      geographic_focus: geoFocus,
      program_priorities: priorities,
      typical_award_range: parseAwardRange(stored?.typical_award_range),
      application_preferences: extractStringField(stored?.profile_data, 'application_preferences'),
      language_patterns: languagePatterns,
      contact_info: {
        website: foundation?.website ?? null,
        email: foundation?.email ?? null,
        phone: foundation?.phone ?? null,
      },
    }
  }

  async matchOrgToFunders(orgProfile: Record<string, unknown>, limit: number): Promise<FunderMatch[]> {
    const client = await createClient()

    const { data: profiles } = await client
      .from('intelligence_grantmaker_profiles')
      .select('foundation_id, name, ein, geographic_focus, program_priorities, avg_award_amount, total_annual_giving, typical_award_range')
      .limit(limit * 3)

    if (!profiles) return []

    const orgState = typeof orgProfile['state'] === 'string' ? orgProfile['state'] : null
    const orgBudget = typeof orgProfile['annual_budget'] === 'number' ? orgProfile['annual_budget'] : null
    const orgMission = typeof orgProfile['mission_statement'] === 'string' ? orgProfile['mission_statement'].toLowerCase() : ''

    const scored: FunderMatch[] = profiles.map((p) => {
      const reasons: string[] = []
      let score = 0

      const geoFocus = toStringArray(p.geographic_focus)
      if (orgState && geoFocus.some((g) => g.toLowerCase().includes(orgState.toLowerCase()))) {
        score += 30
        reasons.push('Geographic overlap with org state')
      } else if (geoFocus.length === 0) {
        score += 15
        reasons.push('No geographic restriction listed')
      }

      const priorities = toStringArray(p.program_priorities)
      let programHits = 0
      for (const priority of priorities) {
        if (orgMission.includes(priority.toLowerCase())) programHits++
      }
      if (programHits > 0) {
        const programScore = Math.min(40, programHits * 15)
        score += programScore
        reasons.push(`Program alignment: ${programHits} matching priorit${programHits === 1 ? 'y' : 'ies'}`)
      }

      const awardRange = parseAwardRange(p.typical_award_range)
      if (orgBudget !== null && awardRange !== null) {
        const typicalAsk = orgBudget * 0.1
        if (typicalAsk >= awardRange.min && typicalAsk <= awardRange.max) {
          score += 30
          reasons.push('Typical ask size fits award range')
        } else if (typicalAsk < awardRange.min * 2 && typicalAsk > awardRange.max * 0.5) {
          score += 15
          reasons.push('Typical ask size near award range')
        }
      } else if (p.avg_award_amount !== null && orgBudget !== null) {
        const typicalAsk = orgBudget * 0.1
        const ratio = typicalAsk / p.avg_award_amount
        if (ratio >= 0.5 && ratio <= 2) {
          score += 20
          reasons.push('Typical ask near average award size')
        }
      }

      return {
        foundation_id: p.foundation_id ?? '',
        name: p.name,
        ein: p.ein,
        match_score: Math.min(100, score),
        match_reasons: reasons,
      }
    })

    return scored
      .filter((m) => m.match_score > 0)
      .sort((a, b) => b.match_score - a.match_score)
      .slice(0, limit)
  }

  async getFunderLanguagePatterns(foundationId: string): Promise<string[]> {
    const client = await createClient()

    const { data: stored } = await client
      .from('intelligence_grantmaker_profiles')
      .select('language_patterns')
      .eq('foundation_id', foundationId)
      .maybeSingle()

    if (stored?.language_patterns && stored.language_patterns.length > 0) {
      return toStringArray(stored.language_patterns)
    }

    const { data: enrichments } = await client
      .from('enrichment_results')
      .select('raw_data')
      .eq('entity_id', foundationId)
      .limit(5)

    const patterns: string[] = []
    for (const e of enrichments ?? []) {
      const raw = e.raw_data as Record<string, unknown> | null
      const rawPatterns = raw?.['language_patterns']
      for (const p of toStringArray(rawPatterns)) {
        if (!patterns.includes(p)) patterns.push(p)
      }
    }

    return patterns
  }
}
