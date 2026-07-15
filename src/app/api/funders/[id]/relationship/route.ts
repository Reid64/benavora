import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data } = await supabase.from('funder_relationship_scores').select('*').eq('funder_id', params.id).single();
  return NextResponse.json(data ?? { funderId: params.id, score: 0, momentum: 'stable' });
}