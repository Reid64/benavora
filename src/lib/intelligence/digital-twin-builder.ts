// Organizational Digital Twin Builder (PLATFORM_VISION_ARCHITECTURE.md Pillar 6
// / AGENTS_v2.md AG-16).
//
// Deterministic (non-Claude) precursor to the full AG-16 agent: assembles a
// twin object from organizations, knowledge_base, board_members, outcomes,
// applications, and opportunities data alone, and persists it to
// organizational_digital_twins (migration 093).
//
// Deviations from the task-given spec, matching this project's established
// practice of checking real column/enum names before applying a literal spec
// (see migration 093's own header for the prior instance of this pattern):
//   - `org.mission` / `org.service_areas` don't exist on organizations; the
//     real columns are `mission_statement` and `service_area` (a single
//     text field, not an array -- split on commas to build service_areas).
//   - KB entries "tagged 'program'" -- the real knowledge_base_category enum
//     has no `program` value, only `program_description`. Used that instead.
//   - "outcomes where result='awarded' mapped to their KB categories" --
//     outcomes has no FK to knowledge_base. The closest real linkage is
//     outcomes.funder_category / opportunity_category (funder_category enum)
//     against knowledge_base.funder_categories (funder_category[]). Proven
//     narrative patterns are is_proven KB entries whose funder_categories
//     overlap the categories of awarded outcomes.
//   - Org scoping column is `organization_id` everywhere in this schema, not
//     `org_id`.

export interface DigitalTwinBoardMember {
  name: string;
  title: string | null;
  bio: string | null;
  email: string | null;
}

export interface DigitalTwinProgram {
  title: string;
  description: string;
}

export interface DigitalTwin {
  organization_id: string;
  mission: string | null;
  service_areas: string[];
  programs: DigitalTwinProgram[];
  financial_profile: Record<string, number>;
  board_composition: DigitalTwinBoardMember[];
  proven_narrative_patterns: string[];
  key_strengths: string[];
  twin_completeness_score: number;
  last_rebuilt_at: string;
  stats: {
    outcomes_count: number;
    kb_entries_count: number;
    applications_count: number;
    applications_by_stage: Record<string, number>;
    most_applied_categories: { category: string; count: number }[];
  };
}

interface KnowledgeBaseRow {
  id: string;
  category: string;
  title: string;
  content: string;
  is_proven: boolean | null;
  funder_categories: string[] | null;
}

interface BoardMemberRow {
  id: string;
  name: string;
  title: string | null;
  bio: string | null;
  email: string | null;
}

interface OutcomeRow {
  result: string;
  funder_category: string | null;
  opportunity_category: string | null;
  awarded_amount: number | null;
}

interface ApplicationRow {
  id: string;
  stage: string;
  opportunities: { category: string | null } | { category: string | null }[] | null;
}

export async function buildDigitalTwin(
  orgId: string,
  supabase: any,
): Promise<DigitalTwin> {
  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select(
      "id, mission_statement, service_area, city, state, annual_budget, total_staff, total_volunteers",
    )
    .eq("id", orgId)
    .maybeSingle();

  if (orgError || !org) {
    throw new Error("Organization not found.");
  }

  const [kbRes, boardRes, outcomesRes, applicationsRes] = await Promise.all([
    supabase
      .from("knowledge_base")
      .select("id, category, title, content, is_proven, funder_categories")
      .eq("organization_id", orgId),
    supabase
      .from("board_members")
      .select("id, name, title, bio, email")
      .eq("organization_id", orgId)
      .eq("is_active", true),
    supabase
      .from("outcomes")
      .select("result, funder_category, opportunity_category, awarded_amount")
      .eq("organization_id", orgId)
      .order("recorded_at", { ascending: false })
      .limit(50),
    supabase
      .from("applications")
      .select("id, stage, opportunities(category)")
      .eq("organization_id", orgId),
  ]);

  const kbEntries = (kbRes.data ?? []) as KnowledgeBaseRow[];
  const boardMembers = (boardRes.data ?? []) as BoardMemberRow[];
  const outcomes = (outcomesRes.data ?? []) as OutcomeRow[];
  const applications = (applicationsRes.data ?? []) as ApplicationRow[];

  const mission = buildMission(org, kbEntries);
  const service_areas = buildServiceAreas(org);
  const programs = buildPrograms(kbEntries);
  const financial_profile = buildFinancialProfile(org);
  const board_composition = buildBoardComposition(boardMembers);
  const proven_narrative_patterns = buildProvenNarrativePatterns(
    kbEntries,
    outcomes,
  );
  const applications_by_stage = buildApplicationsByStage(applications);
  const most_applied_categories = buildMostAppliedCategories(applications);
  const key_strengths = buildKeyStrengths({
    outcomes,
    programs,
    board_composition,
    kbEntries,
  });

  const twin_completeness_score = computeCompletenessScore({
    mission,
    service_areas,
    programs,
    financial_profile,
    board_composition,
    proven_narrative_patterns,
    key_strengths,
    outcomes,
    kbEntries,
    applications,
  });

  const last_rebuilt_at = new Date().toISOString();

  const twin: DigitalTwin = {
    organization_id: orgId,
    mission,
    service_areas,
    programs,
    financial_profile,
    board_composition,
    proven_narrative_patterns,
    key_strengths,
    twin_completeness_score,
    last_rebuilt_at,
    stats: {
      outcomes_count: outcomes.length,
      kb_entries_count: kbEntries.length,
      applications_count: applications.length,
      applications_by_stage,
      most_applied_categories,
    },
  };

  const { error: upsertError } = await supabase
    .from("organizational_digital_twins")
    .upsert(
      {
        organization_id: orgId,
        mission: twin.mission,
        service_areas: twin.service_areas,
        programs: twin.programs,
        financial_profile: twin.financial_profile,
        board_composition: twin.board_composition,
        proven_narrative_patterns: twin.proven_narrative_patterns,
        key_strengths: twin.key_strengths,
        twin_completeness_score: twin.twin_completeness_score,
        last_rebuilt_at: twin.last_rebuilt_at,
      },
      { onConflict: "organization_id" },
    );

  if (upsertError) {
    throw new Error(`Failed to persist digital twin: ${upsertError.message}`);
  }

  return twin;
}

function buildMission(
  org: { mission_statement: string | null },
  kbEntries: KnowledgeBaseRow[],
): string | null {
  if (org.mission_statement && org.mission_statement.trim() !== "") {
    return org.mission_statement;
  }
  const missionEntry = kbEntries.find((e) => e.category === "mission");
  return missionEntry?.content ?? null;
}

function buildServiceAreas(org: {
  service_area: string | null;
  city: string | null;
  state: string | null;
}): string[] {
  if (org.service_area && org.service_area.trim() !== "") {
    return org.service_area
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const cityState = [org.city, org.state].filter(Boolean).join(", ");
  return cityState ? [cityState] : [];
}

function buildPrograms(kbEntries: KnowledgeBaseRow[]): DigitalTwinProgram[] {
  return kbEntries
    .filter((e) => e.category === "program_description")
    .map((e) => ({ title: e.title, description: e.content }));
}

function buildFinancialProfile(org: {
  annual_budget: number | null;
  total_staff: number | null;
  total_volunteers: number | null;
}): Record<string, number> {
  const profile: Record<string, number> = {};
  if (org.annual_budget != null) profile.annual_budget = org.annual_budget;
  if (org.total_staff != null) profile.total_staff = org.total_staff;
  if (org.total_volunteers != null) {
    profile.total_volunteers = org.total_volunteers;
  }
  return profile;
}

function buildBoardComposition(
  boardMembers: BoardMemberRow[],
): DigitalTwinBoardMember[] {
  return boardMembers.map((b) => ({
    name: b.name,
    title: b.title,
    bio: b.bio,
    email: b.email,
  }));
}

function buildProvenNarrativePatterns(
  kbEntries: KnowledgeBaseRow[],
  outcomes: OutcomeRow[],
): string[] {
  const awardedCategories = new Set(
    outcomes
      .filter((o) => o.result === "awarded")
      .flatMap((o) => [o.funder_category, o.opportunity_category])
      .filter((c): c is string => Boolean(c)),
  );

  if (awardedCategories.size === 0) return [];

  const patterns = kbEntries
    .filter(
      (e) =>
        e.is_proven &&
        (e.funder_categories ?? []).some((fc) => awardedCategories.has(fc)),
    )
    .map((e) => `${e.category}: ${e.title}`);

  return Array.from(new Set(patterns));
}

function buildApplicationsByStage(
  applications: ApplicationRow[],
): Record<string, number> {
  const byStage: Record<string, number> = {};
  for (const app of applications) {
    byStage[app.stage] = (byStage[app.stage] ?? 0) + 1;
  }
  return byStage;
}

function buildMostAppliedCategories(
  applications: ApplicationRow[],
): { category: string; count: number }[] {
  const counts: Record<string, number> = {};
  for (const app of applications) {
    const opportunity = Array.isArray(app.opportunities)
      ? app.opportunities[0]
      : app.opportunities;
    const category = opportunity?.category;
    if (category) {
      counts[category] = (counts[category] ?? 0) + 1;
    }
  }
  return Object.entries(counts)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}

function buildKeyStrengths(args: {
  outcomes: OutcomeRow[];
  programs: DigitalTwinProgram[];
  board_composition: DigitalTwinBoardMember[];
  kbEntries: KnowledgeBaseRow[];
}): string[] {
  const { outcomes, programs, board_composition, kbEntries } = args;
  const strengths: string[] = [];

  const awardedCount = outcomes.filter((o) => o.result === "awarded").length;
  if (outcomes.length > 0 && awardedCount / outcomes.length >= 0.3) {
    strengths.push(
      `${Math.round((awardedCount / outcomes.length) * 100)}% award rate across ${outcomes.length} recorded outcome${outcomes.length === 1 ? "" : "s"}.`,
    );
  }

  if (programs.length > 0) {
    strengths.push(
      `${programs.length} documented program${programs.length === 1 ? "" : "s"}.`,
    );
  }

  if (board_composition.length > 0) {
    strengths.push(
      `${board_composition.length} active board member${board_composition.length === 1 ? "" : "s"} on record.`,
    );
  }

  if (kbEntries.length > 10) {
    strengths.push("Well-developed knowledge base (10+ entries).");
  }

  return strengths;
}

function computeCompletenessScore(args: {
  mission: string | null;
  service_areas: string[];
  programs: DigitalTwinProgram[];
  financial_profile: Record<string, number>;
  board_composition: DigitalTwinBoardMember[];
  proven_narrative_patterns: string[];
  key_strengths: string[];
  outcomes: OutcomeRow[];
  kbEntries: KnowledgeBaseRow[];
  applications: ApplicationRow[];
}): number {
  let score = 0;
  if (args.mission) score += 10;
  if (args.service_areas.length > 0) score += 10;
  if (args.programs.length > 0) score += 10;
  if (Object.keys(args.financial_profile).length > 0) score += 10;
  if (args.board_composition.length > 0) score += 10;
  if (args.proven_narrative_patterns.length > 0) score += 10;
  if (args.key_strengths.length > 0) score += 10;
  if (args.outcomes.length > 5) score += 10;
  if (args.kbEntries.length > 10) score += 10;
  if (args.applications.length > 5) score += 10;
  return Math.min(100, score);
}
