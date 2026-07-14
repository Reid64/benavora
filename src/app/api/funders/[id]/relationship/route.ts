import { NextResponse } from 'next/server'

import { requireRole } from '@/lib/auth/role-gate'
import { computeRelationshipScore } from '@/lib/intelligence/relationship-scorer'

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const gate = await requireRole('viewer')
  if ('error' in gate) return gate.error
  const { supabase, organizationId } = gate

  const funderId = params.id
  const { data: funder } = await supabase
    .from('funders')
    .select('id')
    .eq('id', funderId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (!funder) {
    return jsonError('Funder not found.', 'not_found', 404)
  }

  const result = await computeRelationshipScore(funderId, organizationId, supabase)

  return NextResponse.json({ funder_id: funderId, ...result })
}
