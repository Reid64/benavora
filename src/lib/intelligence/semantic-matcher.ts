// Keyword-overlap foundation matcher — scores foundation_directory records
// against an org's mission statement via Jaccard similarity of tokenized
// text (mission vs. foundation name + enrichment.funding_categories), not a
// real embeddings/semantic search. foundation_directory (migration 046) is
// shared public reference data with no organization_id column, so this
// function is intentionally org-unscoped; the API route still derives and
// logs organization_id from the session per Contracts §2, it's just not
// used to filter this particular query.

export interface MatchFundersFilters {
  minGrant?: number
  maxGrant?: number
  state?: string
}

export interface FoundationMatchResult {
  id: string
  name: string
  ein: string
  asset_amount: number
  state: string
  score: number
  matchReasons: string[]
}

const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'for', 'to', 'in', 'and', 'or'])

const STATE_MATCH_BONUS = 0.15

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 0 && !STOPWORDS.has(word)),
  )
}

function toStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((v): v is string => typeof v === 'string')
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): { score: number; shared: string[] } {
  const shared = [...a].filter((word) => b.has(word))
  const unionSize = a.size + b.size - shared.length
  return { score: unionSize === 0 ? 0 : shared.length / unionSize, shared }
}

function buildMatchReasons(sharedWords: string[], stateMatched: boolean, state: string | null): string[] {
  const reasons: string[] = []
  const keywordSlots = stateMatched ? 2 : 3

  for (const word of sharedWords.slice(0, keywordSlots)) {
    reasons.push(`Shares keyword "${word}" with your mission`)
  }
  if (stateMatched && state) {
    reasons.push(`Located in your target state (${state})`)
  }
  if (reasons.length === 0) {
    reasons.push('Limited keyword overlap with your mission statement')
  }

  return reasons.slice(0, 3)
}

export async function matchFunders(
  orgMission: string,
  filters: MatchFundersFilters,
  supabase: any,
): Promise<FoundationMatchResult[]> {
  let query = supabase
    .from('foundation_directory')
    .select('id, name, ein, asset_amount, state, enrichment')
    .not('asset_amount', 'is', null)
    .limit(1000)

  if (typeof filters.minGrant === 'number') {
    query = query.gte('asset_amount', filters.minGrant)
  }
  if (typeof filters.maxGrant === 'number') {
    query = query.lte('asset_amount', filters.maxGrant)
  }

  const { data } = await query

  const missionTokens = tokenize(orgMission)
  const targetState = filters.state ? filters.state.trim().toUpperCase() : null

  const scored: FoundationMatchResult[] = (data ?? []).map((f: Record<string, unknown>) => {
    const fundingCategories = toStringArray((f.enrichment as Record<string, unknown> | null)?.['funding_categories'])
    const foundationTokens = tokenize([f.name as string, ...fundingCategories].join(' '))
    const { score: keywordScore, shared } = jaccardSimilarity(missionTokens, foundationTokens)

    const stateMatched = targetState !== null && (f.state as string | null)?.toUpperCase() === targetState
    const score = Math.min(1, keywordScore + (stateMatched ? STATE_MATCH_BONUS : 0))

    return {
      id: f.id as string,
      name: f.name as string,
      ein: f.ein as string,
      asset_amount: f.asset_amount as number,
      state: f.state as string,
      score,
      matchReasons: buildMatchReasons(shared, stateMatched, targetState),
    }
  })

  return scored.sort((a, b) => b.score - a.score).slice(0, 50)
}
