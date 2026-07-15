import { NextResponse } from 'next/server';
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return NextResponse.json({ foundationId: params.id, competitors: [] });
}