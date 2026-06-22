import { NextResponse } from 'next/server'

import { requireRole } from '@/lib/auth/role-gate'
import { createClient } from '@/lib/supabase/server'
import { FunderRecommender } from '@/lib/intelligence/funder-recommender'

export const runtime = 'nodejs'

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

  const { data: org } = await supabase
    .from('organizations')
    .select('state, service_area')
    .eq('id', orgId)
    .single()

  const { searchParams } = new URL(request.url)
  const category = searchParams.get('category')?.trim() ?? ''
  const amountParam = searchParams.get('amount')?.trim()
  const limitParam = searchParams.get('limit')?.trim()

  const amount = amountParam ? parseInt(amountParam, 10) : 50000
  const limit = limitParam ? Math.min(50, parseInt(limitParam, 10)) : 20
  const geography = org?.service_area ?? org?.state ?? ''

  try {
    const recommender = new FunderRecommender()
    const recommendations = await recommender.recommend({
      orgId,
      programCategory: category,
      grantAmount: isNaN(amount) ? 50000 : amount,
      geography,
    })

    return NextResponse.json({
      recommendations: recommendations.slice(0, limit),
      count: Math.min(recommendations.length, limit),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Recommendation lookup failed.'
    return jsonError(message, 'lookup_failed', 500)
  }
}
