import { NextResponse } from 'next/server'

import { requireRole } from '@/lib/auth/role-gate'
import { matchFunders } from '@/lib/intelligence/semantic-matcher'

// POST /api/match/foundations
// Body: { orgId, mission, minGrant, maxGrant, state }
// `orgId` is accepted for compatibility with the request shape but ignored -
// organization_id is always derived from the session (Contracts §2), never
// trusted from the body.

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function POST(request: Request) {
  const gate = await requireRole('viewer')
  if ('error' in gate) return gate.error
  const { supabase, organizationId } = gate

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError('Invalid JSON body.', 'invalid_body', 400)
  }

  if (typeof body !== 'object' || body === null) {
    return jsonError('Invalid JSON body.', 'invalid_body', 400)
  }
  const record = body as Record<string, unknown>

  const mission = typeof record['mission'] === 'string' ? record['mission'].trim() : ''
  if (!mission) {
    return jsonError('mission is required.', 'missing_mission', 400)
  }

  const minGrant = typeof record['minGrant'] === 'number' ? record['minGrant'] : null
  const maxGrant = typeof record['maxGrant'] === 'number' ? record['maxGrant'] : null
  const state = typeof record['state'] === 'string' && record['state'].trim() ? record['state'].trim() : null

  const results = await matchFunders(mission, organizationId, supabase, {
    minGrant,
    maxGrant,
    state,
  })

  return NextResponse.json({ results })
}
