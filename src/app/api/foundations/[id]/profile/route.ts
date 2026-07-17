import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { computeFoundationProfile } from '@/lib/intelligence/foundation-profiler';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();

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
}
