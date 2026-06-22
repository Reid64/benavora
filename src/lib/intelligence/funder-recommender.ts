import Anthropic from '@anthropic-ai/sdk'

import { createClient } from '@/lib/supabase/server'

export interface FunderRecommendation {
  foundation_id: string
  name: string
  ein: string | null
  match_score: number
  match_reasons: string[]
  avg_award_amount: number | null
  total_annual_giving: number | null
  geographic_focus: string[]
  program_priorities: string[]
}

let anthropicClient: Anthropic | null = null

function getClient(): Anthropic {
  if (anthropicClient === null) {
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return anthropicClient
}

function toStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((v): v is string => typeof v === 'string')
}

function parseAwardRange(raw: unknown): { min: number; max: number } | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (typeof r['min'] === 'number' && typeof r['max'] === 'number') {
    return { min: r['min'], max: r['max'] }
  }
  return null
}

export class FunderRecommender {
  async recommend(params: {
    orgId: string
    programCategory: string
    grantAmount: number
    geography: string
  }): Promise<FunderRecommendation[]> {
    const client = await createClient()

    const { data: profiles } = await client
      .from('intelligence_grantmaker_profiles')
      .select(
        'foundation_id, name, ein, geographic_focus, program_priorities, avg_award_amount, total_annual_giving, typical_award_range',
      )
      .limit(100)

    if (!profiles) return []

    const category = params.programCategory.toLowerCase()
    const geo = params.geography.toLowerCase()
    const amount = params.grantAmount

    const scored: FunderRecommendation[] = profiles.map((p) => {
      const reasons: string[] = []
      let score = 0

      // Geographic match (30%)
      const geoFocus = toStringArray(p.geographic_focus)
      if (geoFocus.length === 0) {
        score += 15
        reasons.push('No geographic restriction — open to all regions')
      } else if (geoFocus.some((g) => g.toLowerCase().includes(geo) || geo.includes(g.toLowerCase()))) {
        score += 30
        reasons.push(`Geographic focus includes ${params.geography}`)
      }

      // Program match (30%)
      const priorities = toStringArray(p.program_priorities)
      const programHits = priorities.filter((pr) =>
        category.includes(pr.toLowerCase()) || pr.toLowerCase().includes(category),
      ).length
      if (programHits > 0) {
        score += Math.min(30, programHits * 15)
        reasons.push(`Program priorities match: ${priorities.slice(0, 3).join(', ')}`)
      }

      // Amount fit (20%)
      const awardRange = parseAwardRange(p.typical_award_range)
      if (awardRange !== null) {
        if (amount >= awardRange.min && amount <= awardRange.max) {
          score += 20
          reasons.push(`Request amount fits typical award range ($${awardRange.min.toLocaleString()}–$${awardRange.max.toLocaleString()})`)
        } else if (amount < awardRange.min * 2 && amount > awardRange.max * 0.5) {
          score += 10
          reasons.push('Request amount is near typical award range')
        }
      } else if (p.avg_award_amount !== null) {
        const ratio = amount / p.avg_award_amount
        if (ratio >= 0.5 && ratio <= 2) {
          score += 15
          reasons.push(`Request near average award ($${p.avg_award_amount.toLocaleString()})`)
        }
      }

      // Historical success (20%) — proxy via profile completeness / total giving
      if (p.total_annual_giving !== null && p.total_annual_giving > 0) {
        score += 10
        reasons.push(`Active grantmaker with $${(p.total_annual_giving / 1_000_000).toFixed(1)}M annual giving`)
      }
      if (priorities.length >= 3) {
        score += 10
        reasons.push('Well-documented program priorities')
      }

      return {
        foundation_id: p.foundation_id ?? '',
        name: p.name,
        ein: p.ein,
        match_score: Math.min(100, score),
        match_reasons: reasons,
        avg_award_amount: p.avg_award_amount,
        total_annual_giving: p.total_annual_giving,
        geographic_focus: geoFocus,
        program_priorities: priorities,
      }
    })

    return scored
      .filter((r) => r.match_score > 0 && r.foundation_id !== '')
      .sort((a, b) => b.match_score - a.match_score)
      .slice(0, 20)
  }

  async explainMatch(funderId: string, orgId: string): Promise<string> {
    const client = await createClient()

    const [profileRes, orgRes] = await Promise.all([
      client
        .from('intelligence_grantmaker_profiles')
        .select('name, geographic_focus, program_priorities, avg_award_amount, total_annual_giving, typical_award_range')
        .eq('foundation_id', funderId)
        .maybeSingle(),
      client
        .from('organizations')
        .select('name, mission_statement, service_area, state, annual_budget, target_population')
        .eq('id', orgId)
        .single(),
    ])

    const funder = profileRes.data
    const org = orgRes.data

    if (!funder || !org) {
      return 'Insufficient data to generate a match explanation.'
    }

    const prompt = `You are a grant strategy expert. Explain in 2-3 concise paragraphs why ${funder.name ?? 'this funder'} is a strong match for ${org.name}.

Organization profile:
- Mission: ${org.mission_statement ?? 'Not provided'}
- Service area: ${org.service_area ?? org.state ?? 'Not specified'}
- Annual budget: ${org.annual_budget ? `$${org.annual_budget.toLocaleString()}` : 'Unknown'}
- Target population: ${org.target_population ?? 'Not specified'}

Funder profile:
- Geographic focus: ${toStringArray(funder.geographic_focus).join(', ') || 'Unrestricted'}
- Program priorities: ${toStringArray(funder.program_priorities).join(', ') || 'Not listed'}
- Average award: ${funder.avg_award_amount ? `$${funder.avg_award_amount.toLocaleString()}` : 'Unknown'}
- Annual giving: ${funder.total_annual_giving ? `$${funder.total_annual_giving.toLocaleString()}` : 'Unknown'}

Be specific, practical, and highlight the strongest alignment points.`

    const response = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    })

    const block = response.content[0]
    return block?.type === 'text' ? block.text : 'Could not generate explanation.'
  }
}
