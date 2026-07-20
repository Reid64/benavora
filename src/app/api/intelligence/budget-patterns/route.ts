import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/role-gate';
import { createClient } from '@/lib/supabase/server';
import { BudgetPatternLibrary } from '@/lib/intelligence/budget-patterns';

export const runtime = 'nodejs';
// BudgetPatternLibrary calls Claude for a single non-streaming completion — give it room.
export const maxDuration = 300;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

/**
 * GET /api/intelligence/budget-patterns?category=housing&grant_type=federal
 *
 * Returns a BudgetTemplate (line items, typical percentages, justification examples)
 * plus indirect cost rate guidance for the given program category and grant type.
 *
 * grant_type: federal | state | foundation | corporate (defaults to "federal")
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
  const grantType = searchParams.get('grant_type')?.trim() ?? 'federal';

  if (!category) {
    return jsonError('category query parameter is required.', 'invalid_input', 400);
  }

  try {
    const library = new BudgetPatternLibrary();
    const [template, indirectGuidance] = await Promise.all([
      library.getTemplateByCategory(category, grantType),
      Promise.resolve(library.getIndirectCostRateGuidance(grantType)),
    ]);

    return NextResponse.json({ template, indirectGuidance });
  } catch {
    return jsonError('Budget pattern lookup failed.', 'lookup_failed', 500);
  }
}
