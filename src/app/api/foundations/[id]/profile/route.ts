import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/role-gate';
import { computeFoundationProfile } from '@/lib/intelligence/foundation-profiler';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const gate = await requireRole('viewer');
  if ('error' in gate) return gate.error;
  const { supabase } = gate;

  try {
    const profile = await computeFoundationProfile(params.id, supabase);

    const { data: saved, error } = await supabase
      .from('foundation_profiles')
      .upsert(
        {
          foundation_id: profile.foundation_id,
          avg_grant_size: profile.avg_grant_size,
          geographic_focus: profile.geographic_focus,
          funding_categories: profile.funding_categories,
          total_grants_made: profile.total_grants_made,
          top_recipients: profile.top_recipients,
          grant_history: profile.grant_history,
          computed_at: new Date().toISOString(),
        },
        { onConflict: 'foundation_id' },
      )
      .select('*')
      .single();

    if (error) {
      return NextResponse.json(profile);
    }

    return NextResponse.json(saved);
  } catch {
    return NextResponse.json(
      { error: 'Could not compute the foundation profile.', code: 'profile_failed' },
      { status: 500 },
    );
  }
}
