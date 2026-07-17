import type { SupabaseClient } from '@supabase/supabase-js'

export type RelationshipMomentum = 'rising' | 'stable' | 'declining'

export type FunderRelationshipEventType =
  | 'award'
  | 'application'
  | 'response'
  | 'outreach'
  | 'meeting'
  | 'rejection'

export interface RelationshipScoreResult {
  score: number
  momentum: RelationshipMomentum
}

export interface RelationshipEventRow {
  event_type: string
  event_date: string
}

// Event weights (migration 091's funder_relationship_events.event_type check
// constraint). Distinct from the older Funder Relationship Agent's decay-based
// event vocabulary (src/lib/agents/funder-relationship.ts, Agent 23) — this is
// a separate, additive event-sourced scoring model, not a replacement.
const EVENT_WEIGHTS: Record<FunderRelationshipEventType, number> = {
  award: 30,
  response: 20,
  application: 10,
  meeting: 15,
  outreach: 5,
  rejection: -10,
}

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000

function weightOf(eventType: string): number {
  return EVENT_WEIGHTS[eventType as FunderRelationshipEventType] ?? 0
}

function sumWeights(events: RelationshipEventRow[]): number {
  return events.reduce((total, event) => total + weightOf(event.event_type), 0)
}

/**
 * Pure computation over an already-fetched event list: sum of event weights
 * clamped 0-100, momentum from last-90-days vs. prior-90-days weighted sum.
 * Exported so bulk callers (e.g. the relationship-scores list route) can fetch
 * every org funder's events in one query and score them without N+1 round trips.
 */
export function scoreFromEvents(events: RelationshipEventRow[]): RelationshipScoreResult {
  const score = Math.max(0, Math.min(100, sumWeights(events)))

  const now = Date.now()
  const last90 = events.filter((event) => now - new Date(event.event_date).getTime() <= NINETY_DAYS_MS)
  const previous90 = events.filter((event) => {
    const age = now - new Date(event.event_date).getTime()
    return age > NINETY_DAYS_MS && age <= NINETY_DAYS_MS * 2
  })

  const last90Weight = sumWeights(last90)
  const previous90Weight = sumWeights(previous90)

  let momentum: RelationshipMomentum = 'stable'
  if (last90Weight > previous90Weight) momentum = 'rising'
  else if (last90Weight < previous90Weight) momentum = 'declining'

  return { score, momentum }
}

/**
 * Computes a funder relationship score from the full funder_relationship_events
 * history: sum of event weights, clamped 0-100. Momentum compares the weighted
 * sum of the last 90 days against the prior 90 days.
 */
export async function computeRelationshipScore(
  funderId: string,
  orgId: string,
  supabase: SupabaseClient,
): Promise<RelationshipScoreResult> {
  const { data, error } = await supabase
    .from('funder_relationship_events')
    .select('event_type, event_date')
    .eq('funder_id', funderId)
    .eq('organization_id', orgId)

  if (error) throw error

  return scoreFromEvents((data ?? []) as RelationshipEventRow[])
}
