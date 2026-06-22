import { NextResponse } from 'next/server'

import { requireRole } from '@/lib/auth/role-gate'
import { createClient } from '@/lib/supabase/server'
import { resolveTier } from '@/lib/billing/usage-tracker'
import { UnifiedIntelligenceSearch, type RelatedIntelligence } from '@/lib/intelligence/unified-search'

export const runtime = 'nodejs'
export const maxDuration = 300

// Sections each tier can access (items 1-7 from the briefing spec).
// free/starter: proposals + compliance only.
// professional: proposals through compliance (1-6).
// enterprise/consultant: all 7 including grantmaker profiles.
const TIER_SECTIONS: Record<string, Array<keyof RelatedIntelligence>> = {
  free:         ['funded_proposals', 'compliance_requirements'],
  starter:      ['funded_proposals', 'compliance_requirements'],
  professional: ['funded_proposals', 'rubrics', 'need_data', 'budget_patterns', 'evaluation_frameworks', 'compliance_requirements'],
  enterprise:   ['funded_proposals', 'rubrics', 'need_data', 'budget_patterns', 'evaluation_frameworks', 'compliance_requirements', 'grantmaker_profiles'],
  consultant:   ['funded_proposals', 'rubrics', 'need_data', 'budget_patterns', 'evaluation_frameworks', 'compliance_requirements', 'grantmaker_profiles'],
}

function applyTierGate(briefing: RelatedIntelligence, tier: string): RelatedIntelligence {
  const allowed = new Set<string>(TIER_SECTIONS[tier] ?? TIER_SECTIONS['free'] ?? [])
  return {
    funded_proposals:       allowed.has('funded_proposals')       ? briefing.funded_proposals       : [],
    rubrics:                allowed.has('rubrics')                ? briefing.rubrics                : [],
    logic_models:           briefing.logic_models,
    need_data:              allowed.has('need_data')              ? briefing.need_data              : [],
    budget_patterns:        allowed.has('budget_patterns')        ? briefing.budget_patterns        : [],
    evaluation_frameworks:  allowed.has('evaluation_frameworks')  ? briefing.evaluation_frameworks  : [],
    compliance_requirements: allowed.has('compliance_requirements') ? briefing.compliance_requirements : [],
    grantmaker_profiles:    allowed.has('grantmaker_profiles')    ? briefing.grantmaker_profiles    : [],
    outcome_benchmarks:     briefing.outcome_benchmarks,
  }
}

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function GET(request: Request) {
  const roleCheck = await requireRole('viewer')
  if ('error' in roleCheck) return roleCheck.error

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return jsonError('Authentication required.', 'unauthenticated', 401)

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  if (!profile?.organization_id) {
    return jsonError('No organization associated with this account.', 'no_org', 403)
  }

  const { searchParams } = new URL(request.url)
  const opportunityId = searchParams.get('opportunity_id')?.trim()
  if (!opportunityId) {
    return jsonError('Query parameter "opportunity_id" is required.', 'missing_opportunity_id', 400)
  }

  // Verify the opportunity belongs to this org (RLS handles it, but explicit check gives a clean 404)
  const orgId = profile.organization_id
  const [oppResult, tier] = await Promise.all([
    supabase
      .from('opportunities')
      .select('id, name')
      .eq('id', opportunityId)
      .eq('organization_id', orgId)
      .maybeSingle(),
    resolveTier(supabase, orgId),
  ])

  if (!oppResult.data) {
    return jsonError('Opportunity not found.', 'not_found', 404)
  }

  const opp = oppResult.data

  try {
    const searcher = new UnifiedIntelligenceSearch()
    const raw = await searcher.getRelatedIntelligence(opportunityId)
    const briefing = applyTierGate(raw, tier)

    const totalItems = Object.values(briefing).reduce(
      (sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0),
      0,
    )

    return NextResponse.json({
      opportunity_id: opportunityId,
      opportunity_name: opp.name,
      briefing,
      total_items: totalItems,
      tier,
      tier_sections: TIER_SECTIONS[tier] ?? TIER_SECTIONS['free'] ?? [],
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Briefing generation failed.'
    return jsonError(message, 'briefing_failed', 500)
  }
}
