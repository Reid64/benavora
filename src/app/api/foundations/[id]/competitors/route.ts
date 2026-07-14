import { NextResponse } from 'next/server'

import { requireRole } from '@/lib/auth/role-gate'
import { getCompetitorIntel } from '@/lib/intelligence/competitor-intel'

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const gate = await requireRole('viewer')
  if ('error' in gate) return gate.error
  const { supabase } = gate

  const foundationId = params.id
  const { data: foundation } = await supabase
    .from('foundation_directory')
    .select('id')
    .eq('id', foundationId)
    .maybeSingle()

  if (!foundation) {
    return jsonError('Foundation not found.', 'not_found', 404)
  }

  const competitors = await getCompetitorIntel(foundationId, supabase)

  return NextResponse.json({ competitors })
}
