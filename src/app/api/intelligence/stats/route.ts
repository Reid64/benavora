import { NextResponse } from 'next/server'

import { requireRole } from '@/lib/auth/role-gate'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function GET() {
  const roleCheck = await requireRole('viewer')
  if ('error' in roleCheck) return roleCheck.error

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return jsonError('Authentication required.', 'unauthenticated', 401)
  }

  const [proposalsRes, sectionsRes, rubricsRes, logicModelsRes, needDataRes] = await Promise.all([
    supabase
      .from('intelligence_funded_proposals')
      .select('created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(1),
    supabase
      .from('intelligence_proposal_sections')
      .select('section_type, created_at', { count: 'exact' })
      .order('created_at', { ascending: false }),
    supabase
      .from('intelligence_scoring_rubrics')
      .select('created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(1),
    supabase
      .from('intelligence_logic_models')
      .select('created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(1),
    supabase
      .from('intelligence_need_data')
      .select('created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(1),
  ])

  const sectionsByType: Record<string, number> = {}
  for (const row of sectionsRes.data ?? []) {
    const t = row.section_type ?? 'unknown'
    sectionsByType[t] = (sectionsByType[t] ?? 0) + 1
  }

  const latestTimes = [
    proposalsRes.data?.[0]?.created_at,
    sectionsRes.data?.[0]?.created_at,
    rubricsRes.data?.[0]?.created_at,
    logicModelsRes.data?.[0]?.created_at,
    needDataRes.data?.[0]?.created_at,
  ].filter((t): t is string => typeof t === 'string')

  const lastIngestionAt =
    latestTimes.length > 0 ? latestTimes.reduce((a, b) => (a > b ? a : b)) : null

  return NextResponse.json({
    funded_proposals_count: proposalsRes.count ?? 0,
    sections_count: sectionsRes.count ?? 0,
    rubrics_count: rubricsRes.count ?? 0,
    logic_models_count: logicModelsRes.count ?? 0,
    need_data_count: needDataRes.count ?? 0,
    last_ingestion_at: lastIngestionAt,
    sections_by_type: sectionsByType,
  })
}
