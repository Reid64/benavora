import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const body = await req.json() as { targetOpportunityId: string };
  const { data: src } = await supabase.from('applications').select('org_id').eq('id', params.id).single();
  if (!src) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const { data: app } = await supabase.from('applications').insert({ opportunity_id: body.targetOpportunityId, org_id: (src as { org_id: string }).org_id, status: 'discovery' }).select().single();
  return NextResponse.json({ sourceId: params.id, newApplicationId: (app as { id: string } | null)?.id });
}