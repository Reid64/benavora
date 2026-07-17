import { NextResponse } from 'next/server'

import { requireRole } from '@/lib/auth/role-gate'
import { scoreFromEvents, type RelationshipEventRow } from '@/lib/intelligence/relationship-scorer'

// GET /api/funders/relationship-scores - event-sourced relationship score +
// momentum for every funder in the caller's org (defaults to a zero/stable
// score for funders with no recorded events yet).

export async function GET() {
  const gate = await requireRole('viewer')
  if ('error' in gate) return gate.error
  const { supabase, organizationId } = gate

  const [{ data: funders, error: fundersError }, { data: events, error: eventsError }] = await Promise.all([
    supabase.from('funders').select('id').eq('organization_id', organizationId),
    supabase
      .from('funder_relationship_events')
      .select('funder_id, event_type, event_date')
      .eq('organization_id', organizationId),
  ])

  if (fundersError || eventsError) {
    return NextResponse.json(
      { error: (fundersError ?? eventsError)?.message, code: 'query_failed' },
      { status: 500 },
    )
  }

  const eventsByFunder = new Map<string, RelationshipEventRow[]>()
  for (const event of events ?? []) {
    const funderId = event.funder_id as string
    const list = eventsByFunder.get(funderId) ?? []
    list.push({ event_type: event.event_type as string, event_date: event.event_date as string })
    eventsByFunder.set(funderId, list)
  }

  const scores = (funders ?? []).map((funder) => {
    const funderId = funder.id as string
    const result = scoreFromEvents(eventsByFunder.get(funderId) ?? [])
    return { funder_id: funderId, score: result.score, momentum: result.momentum }
  })

  return NextResponse.json({ scores })
}
