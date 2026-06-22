import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/role-gate';
import { createClient } from '@/lib/supabase/server';
import { NeedStatementEngine } from '@/lib/intelligence/need-statement-engine';
import type { NeedDataPoint } from '@/lib/intelligence/sources/types';

export const runtime = 'nodejs';
// generateNeedStatement calls Claude with up to 2048 tokens — give it room.
export const maxDuration = 300;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

/**
 * GET /api/intelligence/need-data?state=TX&county=Harris&category=poverty,housing
 *
 * Returns NeedDataPoint[] from intelligence_need_data filtered by state, optional county,
 * and optional comma-separated category list.
 */
export async function GET(request: Request) {
  const roleCheck = await requireRole('viewer');
  if ('error' in roleCheck) return roleCheck.error;

  const { searchParams } = new URL(request.url);
  const state = searchParams.get('state')?.trim();
  const county = searchParams.get('county')?.trim() ?? undefined;
  const categoryParam = searchParams.get('category');
  const categories = categoryParam
    ? categoryParam.split(',').map((c) => c.trim()).filter(Boolean)
    : [];

  if (!state) {
    return jsonError('state query parameter is required.', 'missing_state', 400);
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError('Authentication required.', 'unauthenticated', 401);

  let query = supabase
    .from('intelligence_need_data')
    .select(
      'id, source, data_type, geographic_level, state, county, metric_name, metric_value, metric_year, citation, context',
    )
    .ilike('state', state);

  if (county) {
    query = query.ilike('county', county);
  }
  if (categories.length > 0) {
    query = query.in('data_type', categories);
  }

  const { data, error } = await query.order('metric_year', { ascending: false }).limit(100);

  if (error) {
    return jsonError('Failed to query need data.', 'db_error', 500);
  }

  // Map DB rows to NeedDataPoint shape for uniform client consumption
  const points: NeedDataPoint[] = (data ?? []).map((row) => ({
    metric: (row.metric_name as string),
    value: parseFloat(row.metric_value as string) || 0,
    year: (row.metric_year as number | null) ?? new Date().getFullYear(),
    geography: county ? `${county}, ${state}` : state,
    source: (row.source as string),
    citation: (row.citation as string),
    category: (row.data_type as NeedDataPoint['category']),
  }));

  return NextResponse.json({ data: points, count: points.length });
}

/**
 * POST /api/intelligence/need-data
 *
 * Body: { state, county?, programCategory, orgProfile? }
 *
 * Gathers fresh need data via the NeedStatementEngine (live Census/HUD/BLS/CDC APIs)
 * and generates a Claude-backed need statement with inline citations.
 *
 * Returns: { statement: string, citations: string[], dataPoints: NeedDataPoint[] }
 */
export async function POST(request: Request) {
  // Generating a draft section is a write action.
  const roleCheck = await requireRole('writer');
  if ('error' in roleCheck) return roleCheck.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('Request body must be valid JSON.', 'invalid_body', 400);
  }

  const { state, county, programCategory, orgProfile } = (body ?? {}) as {
    state?: unknown;
    county?: unknown;
    programCategory?: unknown;
    orgProfile?: unknown;
  };

  if (typeof state !== 'string' || state.trim() === '') {
    return jsonError('state is required.', 'missing_state', 400);
  }
  if (typeof programCategory !== 'string' || programCategory.trim() === '') {
    return jsonError('programCategory is required.', 'missing_category', 400);
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError('Authentication required.', 'unauthenticated', 401);

  const engine = new NeedStatementEngine();

  const geography = {
    state: state.trim(),
    county: typeof county === 'string' ? county.trim() : undefined,
  };

  // Derive categories from the program category (all = all sources)
  const dataCategories = deriveCategories(programCategory.trim());

  const needData = await engine.gatherNeedData(geography, dataCategories);

  const safeOrgProfile =
    orgProfile && typeof orgProfile === 'object' && !Array.isArray(orgProfile)
      ? (orgProfile as Record<string, unknown>)
      : {};

  const { statement, citations } = await engine.generateNeedStatement(
    safeOrgProfile,
    needData,
    programCategory.trim(),
  );

  return NextResponse.json({ statement, citations, dataPoints: needData });
}

/**
 * Map a grant program category to the need data categories that are most
 * relevant. Falls back to all categories when the category is unknown.
 */
function deriveCategories(programCategory: string): string[] {
  const lower = programCategory.toLowerCase();
  if (lower.includes('hous') || lower.includes('homeles')) {
    return ['poverty', 'housing', 'demographics'];
  }
  if (lower.includes('employment') || lower.includes('workforce') || lower.includes('job')) {
    return ['employment', 'demographics'];
  }
  if (lower.includes('health') || lower.includes('substance') || lower.includes('mental')) {
    return ['health', 'demographics'];
  }
  // Default: return all categories so the engine queries every source
  return [];
}
