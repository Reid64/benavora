import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/role-gate';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const gate = await requireRole('viewer');
  if ('error' in gate) return gate.error;

  return NextResponse.json({ foundationId: params.id, competitors: [] });
}