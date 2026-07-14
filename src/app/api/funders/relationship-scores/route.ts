import { NextResponse } from 'next/server'

import { requireRole } from '@/lib/auth/role-gate'

export async function GET() {
  const gate = await requireRole('viewer')
  if ('error' in gate) return gate.error
  const { supabase, organizationId } = gate

  const { data, error } = await supabase
    .from('funder_relationship_scores')
    .select('funder_id, relationship_score, trend, is_stale')
    .eq('organization_id', organizationId)

  if (error) {
    return NextResponse.json({ error: error.message, code: 'query_failed' }, { status: 500 })
  }

  const scores = (data ?? []).map((row) => ({
    funder_id: row.funder_id as string,
    score: row.relationship_score as number,
    momentum: row.trend as string,
    is_stale: row.is_stale as boolean,
  }))

  return NextResponse.json({ scores })
}
