// GET  /api/autoapply/ab-tests — return A/B test results for the org.
// POST /api/autoapply/ab-tests — create a new variant.
// DELETE /api/autoapply/ab-tests — deactivate a variant by id.

import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/role-gate';
import { ABTestEngine } from '@/lib/autoapply/ab-testing';

export const runtime = 'nodejs';

const engine = new ABTestEngine();

export async function GET() {
  const gate = await requireRole('viewer');
  if ('error' in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const results = await engine.getTestResults(organizationId, supabase);
  return NextResponse.json({ results });
}

export async function POST(request: Request) {
  const gate = await requireRole('writer');
  if ('error' in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { funder_category, variant_name, pitch_style, emphasis } = body as {
    funder_category?: unknown;
    variant_name?: unknown;
    pitch_style?: unknown;
    emphasis?: unknown;
  };

  if (typeof funder_category !== 'string' || !funder_category.trim()) {
    return NextResponse.json(
      { error: 'funder_category is required.' },
      { status: 400 },
    );
  }
  if (typeof variant_name !== 'string' || !variant_name.trim()) {
    return NextResponse.json(
      { error: 'variant_name is required.' },
      { status: 400 },
    );
  }
  if (typeof pitch_style !== 'string' || !pitch_style.trim()) {
    return NextResponse.json(
      { error: 'pitch_style is required.' },
      { status: 400 },
    );
  }
  if (typeof emphasis !== 'string' || !emphasis.trim()) {
    return NextResponse.json(
      { error: 'emphasis is required.' },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from('ab_test_variants')
    .insert({
      organization_id: organizationId,
      funder_category: funder_category.trim(),
      variant_name: variant_name.trim(),
      pitch_style: pitch_style.trim(),
      emphasis: emphasis.trim(),
    })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      { error: 'Failed to create variant.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ variant: data }, { status: 201 });
}

export async function DELETE(request: Request) {
  const gate = await requireRole('writer');
  if ('error' in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { variant_id } = body as { variant_id?: unknown };
  if (typeof variant_id !== 'string' || !variant_id) {
    return NextResponse.json(
      { error: 'variant_id is required.' },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from('ab_test_variants')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', variant_id)
    .eq('organization_id', organizationId);

  if (error) {
    return NextResponse.json(
      { error: 'Failed to deactivate variant.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
