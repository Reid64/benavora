// Opportunity-scoped success probability calculator.
//
// Lighter-weight than the application-scoped agent at
// src/lib/agents/success-probability.ts (which persists to
// success_probability_scores keyed by application_id). This variant answers
// "how promising is this opportunity" before an application even exists, so
// it reads only from opportunities/outcomes/knowledge_base and returns the
// result directly rather than writing to a table.
//
// Factor weights (sum to 100%):
//   1. Opportunity eligibility_score        30%
//   2. Org's win rate in the same category  25%
//   3. Deadline is 30+ days out             20%
//   4. Count of proven KB narratives         25%
// Missing data for a factor falls back to a neutral midpoint (50) rather
// than zeroing the score out.

import { differenceInCalendarDays } from 'date-fns'
import type { SupabaseClient } from '@supabase/supabase-js'

const NEUTRAL = 50

export interface SuccessProbabilityFactor {
  name: string
  weight: number
  score: number
  detail: string
}

export interface SuccessProbabilityResult {
  score: number
  confidence: 'high' | 'medium' | 'low'
  factors: SuccessProbabilityFactor[]
}

export async function computeSuccessProbability(
  orgId: string,
  opportunityId: string,
  supabase: SupabaseClient,
): Promise<SuccessProbabilityResult> {
  const { data: opportunity, error: opportunityError } = await supabase
    .from('opportunities')
    .select('id, category, deadline, eligibility_score')
    .eq('id', opportunityId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (opportunityError || !opportunity) {
    throw new Error('Opportunity not found.')
  }

  const category = opportunity.category as string | null

  const [outcomesRes, narrativesRes] = await Promise.all([
    category
      ? supabase
          .from('outcomes')
          .select('result')
          .eq('organization_id', orgId)
          .eq('opportunity_category', category)
      : Promise.resolve({ data: null as { result: string }[] | null }),
    category
      ? supabase
          .from('knowledge_base')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .eq('is_proven', true)
          .contains('funder_categories', [category])
      : supabase
          .from('knowledge_base')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .eq('is_proven', true),
  ])

  const eligibilityFactor = scoreEligibility(opportunity.eligibility_score as number | null)
  const categoryFactor = scoreCategorySuccessRate(outcomesRes.data as { result: string }[] | null)
  const deadlineFactor = scoreDeadline(opportunity.deadline as string | null)
  const narrativeFactor = scoreNarratives(
    (narrativesRes as { count: number | null }).count,
  )

  const factors: SuccessProbabilityFactor[] = [
    eligibilityFactor,
    categoryFactor,
    deadlineFactor,
    narrativeFactor,
  ]

  const score = Math.round(
    factors.reduce((sum, factor) => sum + factor.score * factor.weight, 0),
  )

  const dataPointsPresent = [
    opportunity.eligibility_score != null,
    (outcomesRes.data?.length ?? 0) > 0,
    opportunity.deadline != null,
    ((narrativesRes as { count: number | null }).count ?? 0) > 0,
  ].filter(Boolean).length

  const confidence: SuccessProbabilityResult['confidence'] =
    dataPointsPresent >= 3 ? 'high' : dataPointsPresent >= 1 ? 'medium' : 'low'

  return {
    score: Math.max(0, Math.min(100, score)),
    confidence,
    factors,
  }
}

function scoreEligibility(raw: number | null): SuccessProbabilityFactor {
  if (raw == null) {
    return {
      name: 'eligibility_score',
      weight: 0.3,
      score: NEUTRAL,
      detail: 'No eligibility score yet; using midpoint.',
    }
  }
  return {
    name: 'eligibility_score',
    weight: 0.3,
    score: raw,
    detail: `Eligibility score ${raw}/100.`,
  }
}

function scoreCategorySuccessRate(
  outcomes: { result: string }[] | null,
): SuccessProbabilityFactor {
  if (!outcomes || outcomes.length === 0) {
    return {
      name: 'category_success_rate',
      weight: 0.25,
      score: NEUTRAL,
      detail: 'No recorded outcomes for this category; using midpoint.',
    }
  }
  const awarded = outcomes.filter((o) => o.result === 'awarded').length
  const rate = (awarded / outcomes.length) * 100
  return {
    name: 'category_success_rate',
    weight: 0.25,
    score: Math.round(rate),
    detail: `${awarded}/${outcomes.length} awarded in this category (${Math.round(rate)}%).`,
  }
}

function scoreDeadline(deadline: string | null): SuccessProbabilityFactor {
  if (!deadline) {
    return {
      name: 'deadline_proximity',
      weight: 0.2,
      score: NEUTRAL,
      detail: 'No deadline set; using midpoint.',
    }
  }
  const days = differenceInCalendarDays(new Date(deadline), new Date())
  if (days >= 30) {
    return {
      name: 'deadline_proximity',
      weight: 0.2,
      score: 100,
      detail: `${days} days until deadline (30+ days out).`,
    }
  }
  const score = Math.max(0, Math.round((days / 30) * 100))
  return {
    name: 'deadline_proximity',
    weight: 0.2,
    score,
    detail: `${days} day${days === 1 ? '' : 's'} until deadline (under 30 days).`,
  }
}

function scoreNarratives(count: number | null): SuccessProbabilityFactor {
  const narrativeCount = count ?? 0
  if (narrativeCount === 0) {
    return {
      name: 'proven_narratives',
      weight: 0.25,
      score: NEUTRAL,
      detail: 'No proven narratives on file; using midpoint.',
    }
  }
  const score = Math.min(narrativeCount * 20, 100)
  return {
    name: 'proven_narratives',
    weight: 0.25,
    score,
    detail: `${narrativeCount} proven narrative${narrativeCount === 1 ? '' : 's'} on file.`,
  }
}
