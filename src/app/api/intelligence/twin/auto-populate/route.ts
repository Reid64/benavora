import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { autoPopulateTwin } from "@/lib/intelligence/twin-auto-populate";

// POST /api/intelligence/twin/auto-populate — runs autoPopulateTwin()
// (src/lib/intelligence/twin-auto-populate.ts): nonprofits (IRS BMF) ->
// Claude web search -> foundation_directory/foundation_profiles ->
// agent_decisions waterfall, never overwriting existing non-null fields,
// then rebuilds the twin and recomputes its completeness score.

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST() {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  try {
    const result = await autoPopulateTwin(organizationId, supabase);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Auto-populate failed.",
      },
      { status: 500 },
    );
  }
}
