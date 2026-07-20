import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import {
  calculateTwinCompleteness,
  type KnowledgeBaseEntry,
  type KnowledgeBaseProfile,
  type OrganizationalDigitalTwin,
} from "@/lib/intelligence/twin-completeness";

// GET /api/intelligence/twin/completeness — AG-29 Fundability Scorer's twin
// diagnostic (twin-completeness.ts's calculateTwinCompleteness()), distinct
// from the coarser 10-points-per-boolean-field score
// buildDigitalTwin() persists to organizational_digital_twins.twin_completeness_score.
// This route assembles the same OrganizationalDigitalTwin/KnowledgeBaseProfile
// shape twin-auto-populate.ts builds after a rebuild (see its "Reload the
// final persisted twin + KB to score completeness" step) so the two code
// paths stay consistent, but reads the currently-persisted twin rather than
// forcing a rebuild — GET must not have side effects.

export const runtime = "nodejs";
export const maxDuration = 300;

interface OrgRow {
  id: string;
  name: string;
  ein: string | null;
  mission_statement: string | null;
  target_population: string | null;
  founding_date: string | null;
  founder_name: string | null;
  tax_status: string | null;
}

interface TwinRow {
  mission: string | null;
  vision: string | null;
  service_areas: string[] | null;
  programs: OrganizationalDigitalTwin["programs"] | null;
  financial_profile: Record<string, number> | null;
  board_composition: OrganizationalDigitalTwin["board_composition"] | null;
  proven_narrative_patterns: string[] | null;
  key_strengths: string[] | null;
  known_weaknesses: string[] | null;
  twin_completeness_score: number | null;
  last_rebuilt_at: string | null;
}

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data: orgData, error: orgError } = await supabase
    .from("organizations")
    .select(
      "id, name, ein, mission_statement, target_population, founding_date, founder_name, tax_status",
    )
    .eq("id", organizationId)
    .maybeSingle();

  if (orgError || !orgData) {
    return NextResponse.json(
      { error: "Organization not found." },
      { status: 404 },
    );
  }
  const org = orgData as OrgRow;

  const [twinRes, kbRes, applicationsRes, outcomesRes] = await Promise.all([
    supabase
      .from("organizational_digital_twins")
      .select(
        "mission, vision, service_areas, programs, financial_profile, board_composition, proven_narrative_patterns, key_strengths, known_weaknesses, twin_completeness_score, last_rebuilt_at",
      )
      .eq("organization_id", organizationId)
      .maybeSingle(),
    supabase
      .from("knowledge_base")
      .select("id, category, title, content, is_proven, funder_categories")
      .eq("organization_id", organizationId),
    supabase.from("applications").select("id").eq("organization_id", organizationId),
    supabase.from("outcomes").select("result").eq("organization_id", organizationId),
  ]);

  const twinRow = twinRes.data as TwinRow | null;
  const kb = (kbRes.data ?? []) as KnowledgeBaseEntry[];

  const twin: OrganizationalDigitalTwin = {
    organization_id: organizationId,
    mission: twinRow?.mission ?? org.mission_statement ?? null,
    vision: twinRow?.vision ?? null,
    service_areas: twinRow?.service_areas ?? [],
    programs: twinRow?.programs ?? [],
    financial_profile: twinRow?.financial_profile ?? {},
    board_composition: twinRow?.board_composition ?? [],
    proven_narrative_patterns: twinRow?.proven_narrative_patterns ?? [],
    key_strengths: twinRow?.key_strengths ?? [],
    known_weaknesses: twinRow?.known_weaknesses ?? [],
    twin_completeness_score: twinRow?.twin_completeness_score ?? 0,
    last_rebuilt_at: twinRow?.last_rebuilt_at ?? new Date().toISOString(),
    target_population: org.target_population,
    founding_date: org.founding_date,
    founder_name: org.founder_name,
    tax_status: org.tax_status,
    ein: org.ein,
    stats: {
      outcomes_count: (outcomesRes.data ?? []).length,
      kb_entries_count: kb.length,
      applications_count: (applicationsRes.data ?? []).length,
      applications_by_stage: {},
      most_applied_categories: [],
    },
  };

  const kbProfile: KnowledgeBaseProfile = { entries: kb };
  const report = await calculateTwinCompleteness(twin, kbProfile);

  return NextResponse.json({
    orgName: org.name,
    lastRebuiltAt: twin.last_rebuilt_at,
    report,
  });
}
