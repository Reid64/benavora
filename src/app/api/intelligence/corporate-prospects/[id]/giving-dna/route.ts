// POST /api/intelligence/corporate-prospects/[id]/giving-dna — generates (or
// regenerates) the Corporate Giving DNA profile for one corporate_prospects
// row (FEATURE_REGISTRY_v2.md row #92). Real Claude synthesis over whatever
// EA-01..EA-10 enrichment and AG-22 scores already exist on the row — see
// src/lib/intelligence/giving-dna.ts for the grounding logic.
//
// corporate_prospects has no organization_id (shared, cross-org table, same
// precedent as GET .../corporate-prospects/[id]) — service-role admin client,
// not session-scoped. Gated "writer" (not "viewer") since this performs a
// real Claude spend and a real write, matching /api/intelligence/outreach/generate.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateGivingDna } from "@/lib/intelligence/giving-dna";

export const runtime = "nodejs";
export const maxDuration = 300;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;

  const admin = createAdminClient();

  try {
    const givingDna = await generateGivingDna(admin, params.id);
    return NextResponse.json({ givingDna });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not generate a Giving DNA profile.";
    const status = message === "Corporate prospect not found." ? 404 : 502;
    return jsonError(message, status);
  }
}
