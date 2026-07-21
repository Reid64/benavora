import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireRole } from "@/lib/auth/role-gate";
import { buildDigitalTwin } from "@/lib/intelligence/digital-twin-builder";
import {
  calculateTwinCompleteness,
  type KnowledgeBaseEntry,
  type KnowledgeBaseProfile,
  type OrganizationalDigitalTwin,
} from "@/lib/intelligence/twin-completeness";
import {
  computeSectionScores,
  mergeExtendedProfile,
  SECTION_KEYS,
  type ExtendedProfile,
  type OrganizationProfileFields,
  type SectionKey,
} from "@/lib/knowledge-base/profile";
import type { Tables, TablesUpdate } from "@/types/database";

// GET/PATCH /api/knowledge-base — the 10-section Knowledge Base Editor
// (/knowledge-base/edit). See src/lib/knowledge-base/profile.ts's header for
// why this reads/writes organizations + extended_profile (migration 104) +
// board_members + programs + knowledge_base rather than a
// `knowledge_base_profiles` table, which does not exist in this schema.
//
// After every PATCH, the digital twin is rebuilt (buildDigitalTwin) and
// rescored (calculateTwinCompleteness) and organizational_digital_twins.
// twin_completeness_score is updated — the same final step
// twin-auto-populate.ts's autoPopulateTwin() performs, so this editor and the
// Digital Twin page (/intelligence/twin) never disagree about the score.
// organizational_digital_twins has no generated Supabase type yet (see
// digital-twin-builder.ts's own `supabase: any` param) so reads/writes against
// it below are cast rather than typed through Database.

export const runtime = "nodejs";
export const maxDuration = 300;

type OrgRow = OrganizationProfileFields & {
  id: string;
  extended_profile: ExtendedProfile | null;
};

const ORG_SELECT =
  "id, name, ein, tax_status, mission_statement, vision_statement, founding_date, founder_name, founder_bio, service_area, target_population, annual_budget, total_staff, total_volunteers, extended_profile";

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

async function loadAll(organizationId: string, supabase: SupabaseClient) {
  const [orgRes, boardRes, programsRes, taxDocsRes, twinRes] = await Promise.all([
    supabase.from("organizations").select(ORG_SELECT).eq("id", organizationId).maybeSingle(),
    supabase
      .from("board_members")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: true }),
    supabase
      .from("programs")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: true }),
    supabase
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("category", "tax_documents"),
    supabase
      .from("organizational_digital_twins")
      .select("twin_completeness_score, last_rebuilt_at")
      .eq("organization_id", organizationId)
      .maybeSingle(),
  ]);

  return {
    org: orgRes.data as OrgRow | null,
    orgError: orgRes.error,
    boardMembers: (boardRes.data ?? []) as Tables<"board_members">[],
    programs: (programsRes.data ?? []) as Tables<"programs">[],
    taxDocumentCount: taxDocsRes.count ?? 0,
    twinCompletenessScore: (twinRes.data as { twin_completeness_score: number | null } | null)
      ?.twin_completeness_score ?? 0,
  };
}

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { org, orgError, boardMembers, programs, taxDocumentCount, twinCompletenessScore } =
    await loadAll(organizationId, supabase);

  if (orgError || !org) {
    return NextResponse.json({ error: "Organization not found." }, { status: 404 });
  }

  const extended: ExtendedProfile = org.extended_profile ?? {};
  const sectionScores = computeSectionScores({
    org,
    extended,
    boardMemberCount: boardMembers.length,
    boardMembersWithBio: boardMembers.filter((b) => Boolean(b.bio)).length,
    programCount: programs.length,
    programsWithDescription: programs.filter((p) => Boolean(p.description)).length,
    taxDocumentCount,
  });

  return NextResponse.json({
    organization: { ...org, extended_profile: extended },
    boardMembers,
    programs,
    taxDocumentCount,
    sectionScores,
    twinCompletenessScore,
  });
}

interface PatchBody {
  section: SectionKey;
  orgFields?: Partial<
    Omit<OrganizationProfileFields, "name">
  >;
  extended?: Partial<ExtendedProfile>;
}

function isPatchBody(value: unknown): value is PatchBody {
  if (!value || typeof value !== "object") return false;
  const section = (value as { section?: unknown }).section;
  return typeof section === "string" && (SECTION_KEYS as readonly string[]).includes(section);
}

/** Rebuilds + rescores the twin after a profile change (mirrors
 * twin-auto-populate.ts's final step) and returns the fresh score. */
async function recomputeTwin(
  organizationId: string,
  supabase: SupabaseClient,
  org: OrgRow,
): Promise<number> {
  await buildDigitalTwin(organizationId, supabase);

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

  await supabase
    .from("organizational_digital_twins")
    .update({
      twin_completeness_score: report.overall_score,
      last_rebuilt_at: new Date().toISOString(),
    })
    .eq("organization_id", organizationId);

  return report.overall_score;
}

export async function PATCH(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const body: unknown = await request.json().catch(() => null);
  if (!isPatchBody(body)) {
    return NextResponse.json(
      { error: "Body must include a valid `section`." },
      { status: 400 },
    );
  }

  const { org, orgError } = await loadAll(organizationId, supabase);
  if (orgError || !org) {
    return NextResponse.json({ error: "Organization not found." }, { status: 404 });
  }

  if (body.orgFields || body.extended) {
    const update: TablesUpdate<"organizations"> = {
      ...(body.orgFields ?? {}),
      updated_at: new Date().toISOString(),
    };
    if (body.extended) {
      update.extended_profile = mergeExtendedProfile(
        org.extended_profile ?? {},
        body.extended,
      ) as TablesUpdate<"organizations">["extended_profile"];
    }

    const { error: updateError } = await supabase
      .from("organizations")
      .update(update)
      .eq("id", organizationId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
  }

  const { org: freshOrg, orgError: freshError, boardMembers, programs, taxDocumentCount } =
    await loadAll(organizationId, supabase);
  if (freshError || !freshOrg) {
    return NextResponse.json({ error: "Organization not found." }, { status: 404 });
  }

  const twinCompletenessScore = await recomputeTwin(organizationId, supabase, freshOrg);

  const extended: ExtendedProfile = freshOrg.extended_profile ?? {};
  const sectionScores = computeSectionScores({
    org: freshOrg,
    extended,
    boardMemberCount: boardMembers.length,
    boardMembersWithBio: boardMembers.filter((b) => Boolean(b.bio)).length,
    programCount: programs.length,
    programsWithDescription: programs.filter((p) => Boolean(p.description)).length,
    taxDocumentCount,
  });

  return NextResponse.json({
    organization: { ...freshOrg, extended_profile: extended },
    sectionScores,
    twinCompletenessScore,
  });
}
