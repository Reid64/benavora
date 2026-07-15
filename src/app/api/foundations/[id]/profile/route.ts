import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data } = await supabase.from('foundation_profiles').select('*').eq('foundation_id', params.id).single();
  return NextResponse.json(data ?? { foundationId: params.id, avg_grant_size: null });
}