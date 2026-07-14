import { NextResponse } from 'next/server'

import { requireRole } from '@/lib/auth/role-gate'
import { computeFoundationProfile } from '@/lib/intelligence/foundation-profiler'

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

  const profile = await computeFoundationProfile(foundationId, supabase)

  const row = {
    foundation_id: profile.foundation_id,
    avg_grant_size: profile.avg_grant_size,
    geographic_focus: profile.geographic_focus,
    funding_categories: profile.funding_categories,
    computed_at: new Date().toISOString(),
  }

  // foundation_id has a plain (non-unique) index, so upsert manually rather
  // than via .upsert({ onConflict }), which requires a unique constraint.
  const { data: existing } = await supabase
    .from('foundation_profiles')
    .select('id')
    .eq('foundation_id', foundationId)
    .maybeSingle()

  const { data: saved, error } = existing
    ? await supabase.from('foundation_profiles').update(row).eq('id', existing.id).select().maybeSingle()
    : await supabase.from('foundation_profiles').insert(row).select().maybeSingle()

  if (error) {
    return jsonError(error.message, 'profile_save_failed', 500)
  }

  return NextResponse.json({ profile: saved ?? profile })
}
