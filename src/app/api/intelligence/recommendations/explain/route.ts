import { NextResponse } from 'next/server'

import { requireRole } from '@/lib/auth/role-gate'
import { createClient } from '@/lib/supabase/server'
import { FunderRecommender } from '@/lib/intelligence/funder-recommender'

export const runtime = 'nodejs'
export const maxDuration = 60

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
  const funderId = searchParams.get('funderId')?.trim()
  if (!funderId) return jsonError('Missing funderId query parameter.', 'missing_funder_id', 400)

  try {
    const recommender = new FunderRecommender()
    const explanation = await recommender.explainMatch(funderId, profile.organization_id)
    return NextResponse.json({ explanation })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate match explanation.'
    return jsonError(message, 'explain_failed', 500)
  }
}
