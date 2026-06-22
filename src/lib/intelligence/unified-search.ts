import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { generateEmbedding } from './embeddings'
import { retrieveRubric, retrieveLogicModel, retrieveNeedData } from './rag-retrieval'
import { BudgetPatternLibrary } from './budget-patterns'
import { EvaluationLibrary } from './evaluation-library'
import { ComplianceLibrary } from './compliance-library'
import { GrantmakerProfileBuilder } from './grantmaker-profiles'
import { OutcomeBenchmarkEngine } from './outcome-benchmarks'

export type KBType =
  | 'funded_proposal'
  | 'rubric'
  | 'logic_model'
  | 'need_data'
  | 'budget_pattern'
  | 'evaluation'
  | 'compliance'
  | 'grantmaker'
  | 'outcome_benchmark'

export interface SearchResult {
  id: string
  kb_type: KBType
  title: string
  excerpt: string
  relevance_score: number
  metadata: Record<string, unknown>
}

export interface RelatedIntelligence {
  funded_proposals: SearchResult[]
  rubrics: SearchResult[]
  logic_models: SearchResult[]
  need_data: SearchResult[]
  budget_patterns: SearchResult[]
  evaluation_frameworks: SearchResult[]
  compliance_requirements: SearchResult[]
  grantmaker_profiles: SearchResult[]
  outcome_benchmarks: SearchResult[]
}

export class UnifiedIntelligenceSearch {
  async search(
    query: string,
    filters?: { kbTypes?: KBType[]; categories?: string[]; limit?: number },
  ): Promise<SearchResult[]> {
    const { kbTypes, categories, limit = 20 } = filters ?? {}
    const activeTypes: KBType[] = kbTypes ?? [
      'funded_proposal',
      'rubric',
      'logic_model',
      'need_data',
      'budget_pattern',
      'evaluation',
      'compliance',
      'grantmaker',
      'outcome_benchmark',
    ]

    const embedding = await generateEmbedding(query)
    const supabase = createClient()
    const results: SearchResult[] = []
    const perType = Math.max(1, Math.ceil(limit / activeTypes.length))

    await Promise.all(
      activeTypes.map(async (kbType) => {
        const items = await this._searchKB(supabase, kbType, embedding, query, perType, categories)
        results.push(...items)
      }),
    )

    return results.sort((a, b) => b.relevance_score - a.relevance_score).slice(0, limit)
  }

  async getRelatedIntelligence(opportunityId: string): Promise<RelatedIntelligence> {
    const supabase = createClient()

    const { data: opp } = await supabase
      .from('opportunities')
      .select('name, description, category, funder_id, deadline')
      .eq('id', opportunityId)
      .single()

    if (!opp) {
      return this._emptyRelated()
    }

    const queryText = [opp.name ?? '', opp.description ?? ''].filter(Boolean).join('. ')
    const category = typeof opp.category === 'string' ? opp.category : ''
    const funderId = typeof opp.funder_id === 'string' ? opp.funder_id : null

    const embedding = await generateEmbedding(queryText)

    const [
      funded_proposals,
      rubricData,
      logicModelData,
      needDataPoints,
      budgetData,
      evalData,
      complianceData,
      grantmakerData,
      benchmarkData,
    ] = await Promise.all([
      this._searchKB(supabase, 'funded_proposal', embedding, queryText, 5, category ? [category] : undefined),
      this._fetchRubric(category),
      this._fetchLogicModel(category),
      this._fetchNeedData(category),
      this._fetchBudgetPattern(category),
      this._fetchEvaluationFramework(category),
      this._fetchComplianceItems(category),
      this._fetchGrantmakerProfile(funderId),
      this._fetchOutcomeBenchmarks(category),
    ])

    return {
      funded_proposals,
      rubrics: rubricData,
      logic_models: logicModelData,
      need_data: needDataPoints,
      budget_patterns: budgetData,
      evaluation_frameworks: evalData,
      compliance_requirements: complianceData,
      grantmaker_profiles: grantmakerData,
      outcome_benchmarks: benchmarkData,
    }
  }

  // ---- per-KB helpers ----

  private async _searchKB(
    supabase: SupabaseClient,
    kbType: KBType,
    embedding: number[],
    queryText: string,
    limit: number,
    categories?: string[],
  ): Promise<SearchResult[]> {
    switch (kbType) {
      case 'funded_proposal':
        return this._searchFundedProposals(supabase, embedding, limit)
      case 'rubric':
        return this._fetchRubric(categories?.[0] ?? '')
      case 'logic_model':
        return this._fetchLogicModel(categories?.[0] ?? '')
      case 'need_data':
        return this._fetchNeedData(categories?.[0] ?? '')
      case 'budget_pattern':
        return this._fetchBudgetPattern(categories?.[0] ?? '')
      case 'evaluation':
        return this._fetchEvaluationFramework(categories?.[0] ?? '')
      case 'compliance':
        return this._fetchComplianceItems(queryText)
      case 'grantmaker':
        return this._searchGrantmakers(supabase, embedding, limit)
      case 'outcome_benchmark':
        return this._fetchOutcomeBenchmarks(categories?.[0] ?? '')
    }
  }

  private async _searchFundedProposals(
    supabase: SupabaseClient,
    embedding: number[],
    limit: number,
  ): Promise<SearchResult[]> {
    const { data } = await supabase.rpc('match_proposal_sections', {
      query_embedding: embedding,
      match_threshold: 0.65,
      filter_section_types: null,
      match_count: limit,
    })

    if (!data) return []

    return (data as Array<{
      id: string
      section_text: string
      section_type: string
      similarity: number
      funder_name: string | null
      grant_program: string | null
      award_year: number | null
    }>).map((row) => ({
      id: row.id,
      kb_type: 'funded_proposal' as KBType,
      title: [row.funder_name, row.grant_program].filter(Boolean).join(' – ') || 'Funded Proposal',
      excerpt: row.section_text.slice(0, 300),
      relevance_score: row.similarity,
      metadata: {
        section_type: row.section_type,
        funder_name: row.funder_name,
        grant_program: row.grant_program,
        award_year: row.award_year,
      },
    }))
  }

  private async _searchGrantmakers(
    supabase: SupabaseClient,
    _embedding: number[],
    limit: number,
  ): Promise<SearchResult[]> {
    const { data } = await supabase
      .from('intelligence_grantmaker_profiles')
      .select('foundation_id, name, ein, program_priorities, avg_award_amount, geographic_focus')
      .limit(limit)

    if (!data) return []

    return data.map((row, i) => ({
      id: row.foundation_id ?? String(i),
      kb_type: 'grantmaker' as KBType,
      title: row.name ?? 'Unknown Grantmaker',
      excerpt: Array.isArray(row.program_priorities)
        ? (row.program_priorities as string[]).slice(0, 3).join(', ')
        : '',
      relevance_score: 0.5,
      metadata: {
        ein: row.ein,
        avg_award_amount: row.avg_award_amount,
        geographic_focus: row.geographic_focus,
      },
    }))
  }

  private async _fetchRubric(category: string): Promise<SearchResult[]> {
    try {
      const rubric = await retrieveRubric({ category })
      if (!rubric) return []
      return [
        {
          id: rubric.id,
          kb_type: 'rubric',
          title: rubric.funder_name ?? rubric.grant_program ?? 'Scoring Rubric',
          excerpt: rubric.full_text?.slice(0, 300) ?? JSON.stringify(rubric.dimensions).slice(0, 300),
          relevance_score: 0.8,
          metadata: {
            source: rubric.source,
            grant_program: rubric.grant_program,
            category: rubric.category,
          },
        },
      ]
    } catch {
      return []
    }
  }

  private async _fetchLogicModel(category: string): Promise<SearchResult[]> {
    try {
      const lm = await retrieveLogicModel(category)
      if (!lm) return []
      return [
        {
          id: lm.id,
          kb_type: 'logic_model',
          title: `Logic Model – ${lm.category}${lm.subcategory ? ` (${lm.subcategory})` : ''}`,
          excerpt: `Inputs: ${JSON.stringify(lm.inputs).slice(0, 150)}`,
          relevance_score: 0.75,
          metadata: {
            category: lm.category,
            subcategory: lm.subcategory,
          },
        },
      ]
    } catch {
      return []
    }
  }

  private async _fetchNeedData(category: string): Promise<SearchResult[]> {
    try {
      const points = await retrieveNeedData({ category })
      return points.slice(0, 5).map((p) => ({
        id: p.id,
        kb_type: 'need_data' as KBType,
        title: p.metric_name,
        excerpt: `${p.metric_value} (${p.geographic_level}${p.state ? `, ${p.state}` : ''}) — ${p.citation}`,
        relevance_score: 0.7,
        metadata: {
          source: p.source,
          geographic_level: p.geographic_level,
          metric_year: p.metric_year,
          citation: p.citation,
        },
      }))
    } catch {
      return []
    }
  }

  private async _fetchBudgetPattern(category: string): Promise<SearchResult[]> {
    try {
      const lib = new BudgetPatternLibrary()
      const template = await lib.getTemplateByCategory(category || 'housing', 'federal')
      return [
        {
          id: `budget-${category}`,
          kb_type: 'budget_pattern',
          title: `Budget Template – ${template.programCategory} (${template.grantType})`,
          excerpt: template.justificationExamples[0] ?? template.lineItems[0]?.justificationExample ?? '',
          relevance_score: 0.65,
          metadata: {
            programCategory: template.programCategory,
            grantType: template.grantType,
            lineItemCount: template.lineItems.length,
          },
        },
      ]
    } catch {
      return []
    }
  }

  private async _fetchEvaluationFramework(category: string): Promise<SearchResult[]> {
    try {
      const lib = new EvaluationLibrary()
      const framework = await lib.getFrameworkByCategory(category || 'housing')
      return [
        {
          id: `eval-${category}`,
          kb_type: 'evaluation',
          title: `Evaluation Framework – ${framework.programCategory}`,
          excerpt: framework.evaluationDesign.slice(0, 300),
          relevance_score: 0.65,
          metadata: {
            programCategory: framework.programCategory,
            kpiCount: framework.kpis.length,
          },
        },
      ]
    } catch {
      return []
    }
  }

  private async _fetchComplianceItems(grantTypeOrQuery: string): Promise<SearchResult[]> {
    try {
      const lib = new ComplianceLibrary()
      const requirements = lib.getRequirements(grantTypeOrQuery, 'federal')
      return requirements.slice(0, 5).map((req) => ({
        id: req.id,
        kb_type: 'compliance' as KBType,
        title: req.name,
        excerpt: req.description,
        relevance_score: 0.6,
        metadata: {
          severity: req.severity,
          check_type: req.check_type,
          citation: req.citation,
        },
      }))
    } catch {
      return []
    }
  }

  private async _fetchGrantmakerProfile(foundationId: string | null): Promise<SearchResult[]> {
    if (!foundationId) return []
    try {
      const builder = new GrantmakerProfileBuilder()
      const profile = await builder.buildProfile(foundationId)
      return [
        {
          id: foundationId,
          kb_type: 'grantmaker',
          title: profile.name,
          excerpt: profile.program_priorities.slice(0, 3).join(', '),
          relevance_score: 0.9,
          metadata: {
            ein: profile.ein,
            avg_award: profile.avg_award,
            geographic_focus: profile.geographic_focus,
          },
        },
      ]
    } catch {
      return []
    }
  }

  private async _fetchOutcomeBenchmarks(category: string): Promise<SearchResult[]> {
    try {
      const engine = new OutcomeBenchmarkEngine()
      const benchmarks = await engine.getBenchmarks(category)
      return benchmarks.slice(0, 5).map((b) => ({
        id: `benchmark-${b.metric}`,
        kb_type: 'outcome_benchmark' as KBType,
        title: b.metric,
        excerpt: `${b.typical_range.low}–${b.typical_range.high}${b.typical_range.unit} (median ${b.typical_range.median}${b.typical_range.unit}). Source: ${b.source}`,
        relevance_score: 0.65,
        metadata: {
          low: b.typical_range.low,
          median: b.typical_range.median,
          high: b.typical_range.high,
          unit: b.typical_range.unit,
          source: b.source,
        },
      }))
    } catch {
      return []
    }
  }

  private _emptyRelated(): RelatedIntelligence {
    return {
      funded_proposals: [],
      rubrics: [],
      logic_models: [],
      need_data: [],
      budget_patterns: [],
      evaluation_frameworks: [],
      compliance_requirements: [],
      grantmaker_profiles: [],
      outcome_benchmarks: [],
    }
  }
}
