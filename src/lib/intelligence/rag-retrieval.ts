import { generateEmbedding } from './embeddings'
import { createClient } from '@/lib/supabase/server'

export interface IntelligenceResult {
  id: string
  proposal_id: string
  section_type: string
  section_text: string
  quality_score: number | null
  similarity: number
  funder_name: string | null
  grant_program: string | null
  award_year: number | null
  award_amount: number | null
}

export interface ScoringRubric {
  id: string
  source: string
  source_url: string | null
  funder_name: string | null
  grant_program: string | null
  category: string[] | null
  dimensions: Record<string, unknown>
  full_text: string | null
}

export interface LogicModel {
  id: string
  category: string
  subcategory: string | null
  inputs: unknown[]
  activities: unknown[]
  outputs: unknown[]
  outcomes: unknown[]
  impact: unknown[]
  source: string | null
}

export interface NeedDataPoint {
  id: string
  source: string
  source_url: string | null
  data_type: string
  geographic_level: string
  state: string | null
  county: string | null
  city: string | null
  metric_name: string
  metric_value: string
  metric_year: number | null
  context: string | null
  citation: string
}

const NEED_DATA_COLS =
  'id, source, source_url, data_type, geographic_level, state, county, city, metric_name, metric_value, metric_year, context, citation'

const RUBRIC_COLS =
  'id, source, source_url, funder_name, grant_program, category, dimensions, full_text'

export async function retrieveIntelligence(params: {
  queryText: string
  sectionTypes?: string[]
  categories?: string[]
  limit?: number
  threshold?: number
}): Promise<IntelligenceResult[]> {
  const {
    queryText,
    sectionTypes,
    limit = 5,
    threshold = 0.7,
  } = params

  const embedding = await generateEmbedding(queryText)
  const supabase = createClient()

  const { data, error } = await supabase.rpc('match_proposal_sections', {
    query_embedding: embedding,
    match_threshold: threshold,
    filter_section_types: sectionTypes ?? null,
    match_count: limit,
  })

  if (error) throw new Error(error.message)

  return (data ?? []) as IntelligenceResult[]
}

export async function retrieveRubric(params: {
  funderName?: string
  category?: string
}): Promise<ScoringRubric | null> {
  const { funderName, category } = params
  const supabase = createClient()

  if (funderName) {
    const { data } = await supabase
      .from('intelligence_scoring_rubrics')
      .select(RUBRIC_COLS)
      .ilike('funder_name', `%${funderName}%`)
      .limit(1)
      .maybeSingle()

    if (data) return data as unknown as ScoringRubric
  }

  if (category) {
    const { data } = await supabase
      .from('intelligence_scoring_rubrics')
      .select(RUBRIC_COLS)
      .contains('category', [category])
      .limit(1)
      .maybeSingle()

    if (data) return data as unknown as ScoringRubric
  }

  return null
}

export async function retrieveLogicModel(category: string): Promise<LogicModel | null> {
  const supabase = createClient()

  const { data } = await supabase
    .from('intelligence_logic_models')
    .select('id, category, subcategory, inputs, activities, outputs, outcomes, impact, source')
    .eq('category', category)
    .limit(1)
    .maybeSingle()

  if (!data) return null
  return data as unknown as LogicModel
}

export async function retrieveNeedData(params: {
  state?: string
  county?: string
  category?: string
}): Promise<NeedDataPoint[]> {
  const { state, county, category } = params
  const supabase = createClient()
  const results: NeedDataPoint[] = []

  if (county && state) {
    let q = supabase
      .from('intelligence_need_data')
      .select(NEED_DATA_COLS)
      .eq('geographic_level', 'county')
      .eq('county', county)
      .eq('state', state)
    if (category) q = q.eq('data_type', category)
    const { data } = await q.limit(10)
    results.push(...((data ?? []) as NeedDataPoint[]))
  }

  if (state && results.length < 10) {
    const remaining = 10 - results.length
    let q = supabase
      .from('intelligence_need_data')
      .select(NEED_DATA_COLS)
      .eq('geographic_level', 'state')
      .eq('state', state)
    if (category) q = q.eq('data_type', category)
    const { data } = await q.limit(remaining)
    results.push(...((data ?? []) as NeedDataPoint[]))
  }

  if (results.length < 10) {
    const remaining = 10 - results.length
    let q = supabase
      .from('intelligence_need_data')
      .select(NEED_DATA_COLS)
      .eq('geographic_level', 'national')
    if (category) q = q.eq('data_type', category)
    const { data } = await q.limit(remaining)
    results.push(...((data ?? []) as NeedDataPoint[]))
  }

  return results
}
