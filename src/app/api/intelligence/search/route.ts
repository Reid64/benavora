import { NextResponse } from 'next/server'

import { requireRole } from '@/lib/auth/role-gate'
import { createClient } from '@/lib/supabase/server'
import { resolveTier } from '@/lib/billing/usage-tracker'
import { UnifiedIntelligenceSearch, type KBType } from '@/lib/intelligence/unified-search'

export const runtime = 'nodejs'

const TIER_LIMITS: Record<string, number> = {
  free: 3,
  starter: 3,
  professional: 10,
  enterprise: 100,
  consultant: 100,
}

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

  const orgId = profile.organization_id

  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q')?.trim()
  if (!query) return jsonError('Query parameter "q" is required.', 'missing_q', 400)

  const kbTypesParam = searchParams.get('kb_types')?.trim()
  const categoryParam = searchParams.get('category')?.trim()
  const limitParam = searchParams.get('limit')?.trim()

  const tier = await resolveTier(supabase, orgId)
  const tierLimit = TIER_LIMITS[tier] ?? 3

  const requestedLimit = limitParam ? Math.min(parseInt(limitParam, 10), 100) : tierLimit
  const effectiveLimit = Math.min(requestedLimit, tierLimit)

  const kbTypes = kbTypesParam
    ? (kbTypesParam.split(',').map((s) => s.trim()).filter(Boolean) as KBType[])
    : undefined

  const categories = categoryParam ? [categoryParam] : undefined

  try {
    const searcher = new UnifiedIntelligenceSearch()
    const results = await searcher.search(query, { kbTypes, categories, limit: effectiveLimit })

    return NextResponse.json({
      results,
      count: results.length,
      limit: effectiveLimit,
      tier_limit: tierLimit,
    })
  } catch {
    return jsonError('Search failed.', 'search_failed', 500)
  }
}
