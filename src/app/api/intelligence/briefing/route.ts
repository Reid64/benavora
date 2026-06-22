import { NextResponse } from 'next/server'

import { requireRole } from '@/lib/auth/role-gate'
import { createClient } from '@/lib/supabase/server'
import { UnifiedIntelligenceSearch } from '@/lib/intelligence/unified-search'

export const runtime = 'nodejs'
export const maxDuration = 300

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function GET(request: Request) {
  const roleCheck = await requireRole('viewer')
  if ('error' in roleCheck) return roleCheck.error

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return jsonError('Authentication required.', 'unauthenticated', 401)

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  if (!profile?.organization_id) {
    return jsonError('No organization associated with this account.', 'no_org', 403)
  }

  const { searchParams } = new URL(request.url)
  const opportunityId = searchParams.get('opportunity_id')?.trim()
  if (!opportunityId) {
    return jsonError('Query parameter "opportunity_id" is required.', 'missing_opportunity_id', 400)
  }

  // Verify the opportunity belongs to this org (RLS handles it, but explicit check gives a clean 404)
  const orgId = profile.organization_id
  const { data: opp } = await supabase
    .from('opportunities')
    .select('id, name')
    .eq('id', opportunityId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!opp) {
    return jsonError('Opportunity not found.', 'not_found', 404)
  }

  try {
    const searcher = new UnifiedIntelligenceSearch()
    const briefing = await searcher.getRelatedIntelligence(opportunityId)

    const totalItems = Object.values(briefing).reduce(
      (sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0),
      0,
    )

    return NextResponse.json({
      opportunity_id: opportunityId,
      opportunity_name: opp.name,
      briefing,
      total_items: totalItems,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Briefing generation failed.'
    return jsonError(message, 'briefing_failed', 500)
  }
}
