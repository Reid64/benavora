import type { SupabaseClient } from '@supabase/supabase-js'

export type RelationshipMomentum = 'rising' | 'falling' | 'neutral'

export interface RelationshipScoreResult {
  score: number
  momentum: RelationshipMomentum
}

/**
 * Reads a funder's relationship score from funder_relationship_scores.
 * The score itself is computed and persisted by the Funder Relationship
 * Agent (src/lib/agents/funder-relationship.ts, Agent 23) whenever an
 * interaction event fires — this just surfaces the stored result for API
 * consumers. Defaults to a neutral zero score when no events have been
 * recorded yet for the funder.
 */
export async function computeRelationshipScore(
  funderId: string,
  orgId: string,
  supabase: SupabaseClient,
): Promise<RelationshipScoreResult> {
  const { data } = await supabase
    .from('funder_relationship_scores')
    .select('relationship_score, trend')
    .eq('funder_id', funderId)
    .eq('organization_id', orgId)
    .maybeSingle()

  return {
    score: (data?.relationship_score as number | null) ?? 0,
    momentum: (data?.trend as RelationshipMomentum | null) ?? 'neutral',
  }
}
