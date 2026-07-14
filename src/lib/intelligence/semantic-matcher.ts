import type { SupabaseClient } from '@supabase/supabase-js'

export interface FoundationMatch {
  id: string
  name: string
  ein: string
  asset_amount: number | null
  state: string | null
  score: number
}

export interface MatchFundersFilters {
  minGrant?: number | null
  maxGrant?: number | null
  state?: string | null
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'in', 'on', 'at', 'with',
  'by', 'is', 'are', 'we', 'our', 'that', 'this', 'inc', 'foundation', 'fund',
])

function tokenize(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
  return new Set(words)
}

function jaccardScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const word of a) {
    if (b.has(word)) intersection++
  }
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

/**
 * Scores foundation_directory records against an org's mission statement by
 * keyword overlap (Jaccard similarity of the tokenized mission vs. each
 * foundation's name) — a keyword-overlap approximation, not an embeddings
 * search, per the build task's explicit scoring spec. `orgId` is accepted
 * for parity with the caller's session context but unused here:
 * foundation_directory (migration 046) is a shared, unscoped reference
 * table with no organization_id column.
 */
export async function matchFunders(
  orgMission: string,
  orgId: string,
  supabase: SupabaseClient,
  filters?: MatchFundersFilters,
): Promise<FoundationMatch[]> {
  void orgId

  let query = supabase
    .from('foundation_directory')
    .select('id, name, ein, asset_amount, state, giving_total')
    .limit(500)

  if (filters?.state) {
    query = query.eq('state', filters.state)
  }
  if (filters?.minGrant !== undefined && filters.minGrant !== null) {
    query = query.gte('giving_total', filters.minGrant)
  }
  if (filters?.maxGrant !== undefined && filters.maxGrant !== null) {
    query = query.lte('giving_total', filters.maxGrant)
  }

  const { data } = await query

  const missionWords = tokenize(orgMission)

  const scored: FoundationMatch[] = (data ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    ein: f.ein,
    asset_amount: f.asset_amount,
    state: f.state,
    score: jaccardScore(missionWords, tokenize(f.name)),
  }))

  return scored.sort((a, b) => b.score - a.score).slice(0, 50)
}
