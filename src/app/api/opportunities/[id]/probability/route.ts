import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data } = await supabase.from('opportunities').select('eligibility_score').eq('id', params.id).single();
  const score = (data as { eligibility_score?: number } | null)?.eligibility_score ?? 50;
  return NextResponse.json({ opportunityId: params.id, score, confidence: score > 70 ? 'high' : score > 40 ? 'medium' : 'low' });
}