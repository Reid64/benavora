import { NextResponse } from 'next/server'

import { requireRole } from '@/lib/auth/role-gate'
import { predictDeadlines } from '@/lib/intelligence/deadline-predictor'

// GET /api/intelligence/deadline-predictions?funderId=<uuid>

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function GET(request: Request) {
  const gate = await requireRole('viewer')
  if ('error' in gate) return gate.error
  const { supabase } = gate

  const { searchParams } = new URL(request.url)
  const funderId = searchParams.get('funderId')

  if (!funderId) {
    return jsonError('funderId is required.', 'missing_funder_id', 400)
  }

  const predictions = await predictDeadlines(funderId, supabase)

  return NextResponse.json({ predictions })
}
