import { createAdminClient } from '@/lib/supabase/admin'
import { extractSections } from './section-extractor'
import { generateEmbedding } from './embeddings'

const NIH_REPORTER_API = 'https://api.reporter.nih.gov/v2/projects/search'

// Cycling search terms — rotate by day-of-year so each cron run covers a different area.
const NIH_SEARCH_TERMS = [
  'community health equity',
  'housing assistance social services',
  'social determinants of health',
  'homeless services supportive housing',
  'community development health',
  'nonprofit capacity building',
  'substance abuse prevention community',
]

export interface NihIngestionResult {
  success: boolean
  ingested: number
  skipped: number
  message?: string
}

interface NihProject {
  appl_id: number
  project_title?: string
  abstract_text?: string | null
  pref_terms?: string | null
  project_start_date?: string | null
  award_amount?: number | null
  principal_investigators?: Array<{ full_name: string }> | null
  organization?: { org_name?: string }
}

interface NihSearchResponse {
  results: NihProject[]
  meta?: { total: number }
}

export async function ingestNihProposals(): Promise<NihIngestionResult> {
  let supabase: ReturnType<typeof createAdminClient>
  try {
    supabase = createAdminClient()
  } catch {
    return { success: false, ingested: 0, skipped: 0, message: 'Admin client not configured.' }
  }

  // Deterministic rotation by day-of-year
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000)
  const searchTerm = NIH_SEARCH_TERMS[dayOfYear % NIH_SEARCH_TERMS.length]!

  let projects: NihProject[] = []
  try {
    const currentYear = new Date().getFullYear()
    const res = await fetch(NIH_REPORTER_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        criteria: {
          advanced_text_search: {
            operator: 'Or',
            search_field: 'all',
            search_text: searchTerm,
          },
          award_year_range: { start_year: currentYear - 2, end_year: currentYear },
        },
        include_fields: [
          'ApplId', 'ProjectTitle', 'AbstractText', 'AwardAmount',
          'PrefTerms', 'ProjectStartDate', 'PrincipalInvestigators', 'Organization',
        ],
        offset: 0,
        limit: 25,
        sort_field: 'award_amount',
        sort_order: 'desc',
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) {
      return {
        success: false, ingested: 0, skipped: 0,
        message: `NIH Reporter API returned HTTP ${res.status}.`,
      }
    }
    const body = (await res.json()) as NihSearchResponse
    projects = body.results ?? []
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'NIH Reporter fetch failed.'
    return { success: false, ingested: 0, skipped: 0, message: msg }
  }

  const withText = projects.filter(
    (p) => typeof p.abstract_text === 'string' && p.abstract_text.trim().length > 100,
  )

  let ingested = 0
  let skipped = 0

  for (const project of withText.slice(0, 10)) {
    const sourceKey = `nih:${project.appl_id}`
    const sourceUrl = `https://reporter.nih.gov/project-details/${project.appl_id}`
    const grantProgram = project.pref_terms?.split(';')[0]?.trim() ?? null
    const funderName = 'NIH'

    const { data: existingBySource } = await supabase
      .from('intelligence_funded_proposals')
      .select('id')
      .eq('source', sourceKey)
      .maybeSingle()

    const { data: existingByUrl } = await supabase
      .from('intelligence_funded_proposals')
      .select('id')
      .eq('source_url', sourceUrl)
      .maybeSingle()

    let existingByTitle: { id: string } | null = null
    if (grantProgram) {
      const { data } = await supabase
        .from('intelligence_funded_proposals')
        .select('id')
        .eq('grant_program', grantProgram)
        .eq('funder_name', funderName)
        .maybeSingle()
      existingByTitle = data
    }

    if (existingBySource || existingByUrl || existingByTitle) { skipped++; continue }

    const fullText = [project.project_title, project.abstract_text].filter(Boolean).join('\n\n')

    let sections: Record<string, string> = {}
    try {
      const extracted = await extractSections(fullText)
      sections = Object.fromEntries(
        Object.entries(extracted).filter(
          (e): e is [string, string] => typeof e[1] === 'string' && e[1].length > 0,
        ),
      )
    } catch {
      // section extraction failure: still insert the proposal
    }

    if (Object.keys(sections).length === 0) { skipped++; continue }

    const startYear = project.project_start_date
      ? new Date(project.project_start_date).getFullYear()
      : null

    const { data: proposalRow, error: insertErr } = await supabase
      .from('intelligence_funded_proposals')
      .insert({
        source: sourceKey,
        source_url: sourceUrl,
        full_text: fullText.slice(0, 100_000),
        funder_name: funderName,
        grant_program: grantProgram,
        award_amount: project.award_amount ?? null,
        award_year: startYear,
        metadata: {
          appl_id: project.appl_id,
          organization: project.organization?.org_name ?? null,
          pi: project.principal_investigators?.[0]?.full_name ?? null,
          search_term: searchTerm,
        },
      })
      .select('id')
      .single()

    if (insertErr || !proposalRow) { skipped++; continue }

    const { data: existingSections } = await supabase
      .from('intelligence_proposal_sections')
      .select('section_type')
      .eq('proposal_id', proposalRow.id)

    const existingSectionTypes = new Set((existingSections ?? []).map((s) => s.section_type))

    const sectionRows = (
      await Promise.all(
        Object.entries(sections)
          .filter(([sectionType]) => !existingSectionTypes.has(sectionType))
          .map(async ([sectionType, sectionText]) => {
            let embedding: number[] | null = null
            try {
              embedding = await generateEmbedding(sectionText.slice(0, 8_000))
            } catch {
              // embedding optional — store without it
            }
            return {
              proposal_id: proposalRow.id as string,
              section_type: sectionType,
              content: sectionText,
              embedding,
            }
          }),
      )
    )

    if (sectionRows.length > 0) {
      await supabase.from('intelligence_proposal_sections').insert(sectionRows)
    }
    ingested++
  }

  const message =
    ingested === 0
      ? `No new NIH proposals found for: "${searchTerm}".`
      : `Ingested ${ingested} NIH proposals for: "${searchTerm}".`

  return { success: true, ingested, skipped, message }
}
