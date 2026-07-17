export interface KnowledgePattern {
  id: string
  pattern_type: string
  category: string | null
  funder_name: string | null
  pattern_description: string
  success_rate: number | null
  sample_count: number | null
  confidence: string
}

export interface KnowledgeProposal {
  id: string
  source: string
  funder_name: string | null
  grant_program: string | null
  award_amount: number | null
  award_year: number | null
}

export interface KnowledgeEngineResult {
  patterns: KnowledgePattern[]
  proposals: KnowledgeProposal[]
  insights: string[]
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'about', 'into',
  'grant', 'grants', 'funding', 'fund', 'application', 'proposal',
  'a', 'an', 'to', 'of', 'in', 'on', 'is', 'are', 'we', 'our', 'us',
])

function extractKeywords(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length > 2 && !STOPWORDS.has(word)),
    ),
  ).slice(0, 8)
}

// Keyword-based retrieval over knowledge_patterns and intelligence_funded_proposals.
// Full vector search will replace this once intelligence_funded_proposals.embedding
// (migration 096) is populated by the ingestion pipeline.
export async function queryKnowledgeEngine(
  query: string,
  orgId: string,
  supabase: any,
): Promise<KnowledgeEngineResult> {
  const keywords = extractKeywords(query)
  const trimmedQuery = query.trim().replace(/[,()%]/g, '').slice(0, 200)

  let patternsQuery = supabase
    .from('knowledge_patterns')
    .select('id, pattern_type, category, funder_name, pattern_description, success_rate, sample_count, confidence')
    .order('success_rate', { ascending: false, nullsFirst: false })
    .limit(10)

  if (keywords.length > 0) {
    const orFilter = keywords
      .map((kw) => `category.ilike.%${kw}%,pattern_description.ilike.%${kw}%,funder_name.ilike.%${kw}%`)
      .join(',')
    patternsQuery = patternsQuery.or(orFilter)
  }

  let proposalsQuery = supabase
    .from('intelligence_funded_proposals')
    .select('id, source, funder_name, grant_program, award_amount, award_year')
    .order('created_at', { ascending: false })
    .limit(10)

  if (trimmedQuery.length > 0) {
    proposalsQuery = proposalsQuery.or(
      `grant_program.ilike.%${trimmedQuery}%,funder_name.ilike.%${trimmedQuery}%`,
    )
  }

  const [patternsRes, proposalsRes] = await Promise.all([patternsQuery, proposalsQuery])

  const patterns = (patternsRes.data ?? []) as KnowledgePattern[]
  const proposals = (proposalsRes.data ?? []) as KnowledgeProposal[]

  const insights: string[] = []

  if (patterns.length > 0) {
    const top = patterns[0]!
    insights.push(
      `Top matching pattern: "${top.pattern_description}"${
        top.success_rate !== null ? ` (${top.success_rate}% success rate)` : ''
      }.`,
    )
  }

  if (proposals.length > 0) {
    const funders = Array.from(new Set(proposals.map((p) => p.funder_name).filter(Boolean)))
    if (funders.length > 0) {
      insights.push(`Found funded proposals from: ${funders.slice(0, 5).join(', ')}.`)
    }
  }

  if (patterns.length === 0 && proposals.length === 0) {
    insights.push('No matching patterns or funded proposals found for this query yet.')
  }

  try {
    await supabase.from('knowledge_queries').insert({
      organization_id: orgId,
      query_text: trimmedQuery,
      results: { patterns_count: patterns.length, proposals_count: proposals.length },
    })
  } catch {
    // logging the query is best-effort — never block the caller on it
  }

  return { patterns, proposals, insights }
}
