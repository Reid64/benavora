import { NextResponse } from 'next/server'

import { requireRole } from '@/lib/auth/role-gate'
import { createClient } from '@/lib/supabase/server'
import { extractSections } from '@/lib/intelligence/section-extractor'
import { generateEmbedding } from '@/lib/intelligence/embeddings'
import { ingestNihProposals } from '@/lib/intelligence/ingest-nih-proposals'

export const runtime = 'nodejs'
export const maxDuration = 300

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function POST(request: Request) {
  const roleCheck = await requireRole('writer')
  if ('error' in roleCheck) return roleCheck.error

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError('Request body must be valid JSON.', 'invalid_body', 400)
  }

  const { source, url, text, metadata } = (body ?? {}) as {
    source?: unknown
    url?: unknown
    text?: unknown
    metadata?: unknown
  }

  if (typeof source !== 'string' || !['nih', 'manual', 'url'].includes(source)) {
    return jsonError("source must be one of: nih, manual, url", 'invalid_source', 400)
  }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return jsonError('Authentication required.', 'unauthenticated', 401)
  }

  if (source === 'nih') {
    const result = await ingestNihProposals()
    return NextResponse.json(result)
  }

  let fullText: string

  if (source === 'url') {
    if (typeof url !== 'string' || url.trim() === '') {
      return jsonError('url is required for source=url', 'missing_url', 400)
    }
    let fetchRes: Response
    try {
      fetchRes = await fetch(url.trim(), {
        headers: { 'User-Agent': 'Benavora Grant Intelligence Crawler/1.0' },
        signal: AbortSignal.timeout(30_000),
      })
    } catch {
      return jsonError('Failed to fetch the provided URL.', 'fetch_failed', 400)
    }
    if (!fetchRes.ok) {
      return jsonError(`URL returned HTTP ${fetchRes.status}.`, 'fetch_error', 400)
    }
    const contentType = fetchRes.headers.get('content-type') ?? ''
    if (!contentType.includes('text/')) {
      return jsonError(
        'URL must return text content (text/html or text/plain).',
        'unsupported_content',
        400,
      )
    }
    fullText = await fetchRes.text()
  } else {
    if (typeof text !== 'string' || text.trim() === '') {
      return jsonError('text is required for source=manual', 'missing_text', 400)
    }
    fullText = text
  }

  const sections = await extractSections(fullText)
  const sectionEntries = Object.entries(sections).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0,
  )

  if (sectionEntries.length === 0) {
    return jsonError(
      'Could not extract any sections from the provided content.',
      'extraction_failed',
      422,
    )
  }

  const proposalMeta =
    typeof metadata === 'object' && metadata !== null ? (metadata as Record<string, unknown>) : {}

  const funderName = typeof proposalMeta.funder_name === 'string' ? proposalMeta.funder_name : null
  const grantProgram = typeof proposalMeta.grant_program === 'string' ? proposalMeta.grant_program : null
  const awardAmount = typeof proposalMeta.award_amount === 'number' ? proposalMeta.award_amount : null
  const awardYear = typeof proposalMeta.award_year === 'number' ? proposalMeta.award_year : null
  const category = Array.isArray(proposalMeta.category) ? (proposalMeta.category as string[]) : null

  const dedupSourceUrl = source === 'url' ? (url as string) : null
  if (dedupSourceUrl) {
    const { data: existingByUrl } = await supabase
      .from('intelligence_funded_proposals')
      .select('id')
      .eq('source_url', dedupSourceUrl)
      .maybeSingle()
    if (existingByUrl) {
      return NextResponse.json({
        success: true,
        skipped: true,
        proposal_id: existingByUrl.id,
        reason: 'duplicate_source_url',
      })
    }
  }
  if (funderName && grantProgram) {
    const { data: existingByTitle } = await supabase
      .from('intelligence_funded_proposals')
      .select('id')
      .eq('grant_program', grantProgram)
      .eq('funder_name', funderName)
      .maybeSingle()
    if (existingByTitle) {
      return NextResponse.json({
        success: true,
        skipped: true,
        proposal_id: existingByTitle.id,
        reason: 'duplicate_title_funder',
      })
    }
  }

  const { data: proposalRow, error: proposalError } = await supabase
    .from('intelligence_funded_proposals')
    .insert({
      source: source === 'url' ? (url as string) : 'manual',
      source_url: source === 'url' ? (url as string) : null,
      full_text: fullText.slice(0, 100_000),
      metadata: proposalMeta,
      funder_name: funderName,
      grant_program: grantProgram,
      award_amount: awardAmount,
      award_year: awardYear,
      category: category,
    })
    .select('id')
    .single()

  if (proposalError || !proposalRow) {
    return jsonError('Failed to store proposal.', 'db_error', 500)
  }

  const proposalId = proposalRow.id as string
  let sectionsExtracted = 0

  for (const [sectionType, sectionText] of sectionEntries) {
    const { data: existingSection } = await supabase
      .from('intelligence_proposal_sections')
      .select('id')
      .eq('proposal_id', proposalId)
      .eq('section_type', sectionType)
      .maybeSingle()
    if (existingSection) continue

    let embedding: number[]
    try {
      embedding = await generateEmbedding(sectionText)
    } catch {
      continue
    }

    const { error: sectionError } = await supabase
      .from('intelligence_proposal_sections')
      .insert({
        proposal_id: proposalId,
        section_type: sectionType,
        section_text: sectionText,
        embedding,
      })

    if (!sectionError) sectionsExtracted++
  }

  return NextResponse.json({
    success: true,
    proposal_id: proposalId,
    sections_extracted: sectionsExtracted,
  })
}
