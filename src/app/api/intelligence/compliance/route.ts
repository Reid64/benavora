import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/role-gate';
import { createClient } from '@/lib/supabase/server';
import { ComplianceLibrary } from '@/lib/intelligence/compliance-library';

export const runtime = 'nodejs';

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

/**
 * GET /api/intelligence/compliance?grant_type=housing&funding_source=grants_gov
 *
 * Returns the ComplianceRequirement[] that apply to the specified grant type
 * and funding source combination. At least one of the two parameters is required.
 *
 * grant_type: program category / grant purpose (e.g. "housing", "workforce", "construction")
 * funding_source: source identifier (e.g. "grants_gov", "federal", "hud", "foundation")
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
  const grantType = searchParams.get('grant_type')?.trim() ?? '';
  const fundingSource = searchParams.get('funding_source')?.trim() ?? '';

  if (!grantType && !fundingSource) {
    return jsonError(
      'At least one of grant_type or funding_source is required.',
      'invalid_input',
      400,
    );
  }

  try {
    const library = new ComplianceLibrary();
    const requirements = library.getRequirements(grantType, fundingSource);

    return NextResponse.json({ requirements, count: requirements.length });
  } catch {
    return jsonError('Compliance requirements lookup failed.', 'lookup_failed', 500);
  }
}
