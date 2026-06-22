import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/role-gate';
import { createClient } from '@/lib/supabase/server';
import { EvaluationLibrary } from '@/lib/intelligence/evaluation-library';

export const runtime = 'nodejs';

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

/**
 * GET /api/intelligence/evaluation?category=housing
 *
 * Returns the evaluation framework (design, KPIs, data collection methods,
 * reporting schedule, analysis plan) and a list of recommended data collection
 * tools for the given program category.
 */
export async function GET(request: Request) {
  const roleCheck = await requireRole('viewer');
  if ('error' in roleCheck) return roleCheck.error;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError('Authentication required.', 'unauthenticated', 401);

  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category')?.trim() ?? '';

  if (!category) {
    return jsonError('category query parameter is required.', 'invalid_input', 400);
  }

  try {
    const library = new EvaluationLibrary();
    const [framework, kpis] = await Promise.all([
      library.getFrameworkByCategory(category),
      library.getKPIs(category),
    ]);
    const dataCollectionTools = library.getDataCollectionTools(kpis);

    return NextResponse.json({ framework, kpis, dataCollectionTools });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Evaluation framework lookup failed.';
    return jsonError(message, 'lookup_failed', 500);
  }
}
