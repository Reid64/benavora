// Corporate Giving DNA generator (FEATURE_REGISTRY_v2.md row #92).
//
// Synthesizes a short, honest per-company giving profile from whatever real
// data already exists on a corporate_prospects row -- the identity/
// classification columns (107_corporate_prospects.sql), the EA-01..EA-10
// `enrichment` jsonb (corporate-enrichment-shared.ts), and AG-22's `scores`
// jsonb (PS-01..PS-10 + ranking) -- into `giving_dna`. Never calls a search
// engine or invents facts: every sentence Claude is allowed to write must
// trace back to a fact this file actually extracted from the row, and the
// prompt says so explicitly. `basedOnFields` records exactly which real
// columns/keys contributed, so a caller (or a live test) can check the
// output against the row rather than trusting the model's own claim.

import type { SupabaseClient } from "@supabase/supabase-js";

import { callClaude } from "@/lib/ai/claude";
import { parseClaudeJson } from "@/lib/agents/corporate-enrichment-shared";

export interface GivingDnaProspectRow {
  id: string;
  legal_name: string;
  dba_name: string | null;
  website: string | null;
  industry_category: string | null;
  naics_description: string | null;
  sic_code: string | null;
  employee_count_estimate: string | null;
  revenue_estimate: string | null;
  location_count: number | null;
  geographic_footprint: string[] | null;
  address_city: string | null;
  address_state: string | null;
  is_family_owned: boolean | null;
  is_veteran_owned: boolean | null;
  is_minority_owned: boolean | null;
  is_woman_owned: boolean | null;
  enrichment: Record<string, unknown> | null;
  scores: Record<string, unknown> | null;
}

export interface GivingDnaResult {
  summary: string;
  outreach_angles: string[];
  data_gaps: string[];
  based_on_fields: string[];
  generated_at: string;
}

interface Fact {
  /** Dotted path into the row, e.g. "enrichment.has_giving_program" -- used as the grounding record. */
  field: string;
  text: string;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "") : [];
}

/** Extracts only the real, populated facts from a prospect row -- nothing inferred, nothing padded. */
export function buildGivingDnaFacts(prospect: GivingDnaProspectRow): Fact[] {
  const facts: Fact[] = [];
  const enrichment = prospect.enrichment ?? {};
  const scores = prospect.scores ?? {};

  const industryBits = [prospect.industry_category, prospect.naics_description, prospect.sic_code].filter(
    (v): v is string => typeof v === "string" && v.trim() !== "",
  );
  if (industryBits.length > 0) {
    facts.push({ field: "industry_category", text: `Industry: ${industryBits.join(" / ")}.` });
  }

  const locationBits = [prospect.address_city, prospect.address_state].filter(Boolean);
  if (locationBits.length > 0) {
    facts.push({ field: "address_city", text: `Headquartered in ${locationBits.join(", ")}.` });
  }

  if (prospect.employee_count_estimate) {
    facts.push({ field: "employee_count_estimate", text: `Estimated employee count: ${prospect.employee_count_estimate}.` });
  }
  if (prospect.revenue_estimate) {
    facts.push({ field: "revenue_estimate", text: `Estimated revenue: ${prospect.revenue_estimate}.` });
  }
  if (prospect.location_count || (prospect.geographic_footprint && prospect.geographic_footprint.length > 0)) {
    const footprint = prospect.geographic_footprint?.length ? ` across ${prospect.geographic_footprint.join(", ")}` : "";
    facts.push({
      field: "location_count",
      text: `${prospect.location_count ?? "Multiple"} known location(s)${footprint}.`,
    });
  }

  const ownership = [
    prospect.is_family_owned ? "family-owned" : null,
    prospect.is_veteran_owned ? "veteran-owned" : null,
    prospect.is_minority_owned ? "minority-owned" : null,
    prospect.is_woman_owned ? "woman-owned" : null,
  ].filter((v): v is string => v !== null);
  if (ownership.length > 0) {
    facts.push({ field: "is_family_owned", text: `Ownership: ${ownership.join(", ")}.` });
  }

  if (typeof enrichment.has_giving_program === "boolean") {
    if (enrichment.has_giving_program) {
      const donationTypes = stringArray(enrichment.known_donation_types);
      const portal = typeof enrichment.giving_portal_url === "string" ? enrichment.giving_portal_url : null;
      facts.push({
        field: "enrichment.has_giving_program",
        text: `Runs a corporate giving program${donationTypes.length ? ` (${donationTypes.join(", ")})` : ""}${portal ? `, portal: ${portal}` : ""}.`,
      });
    } else {
      facts.push({ field: "enrichment.has_giving_program", text: "No corporate giving/CSR/community page was found on their website." });
    }
  }

  const decisionMakerNames = stringArray(enrichment.decision_maker_names);
  if (decisionMakerNames.length > 0) {
    const titles = stringArray(enrichment.decision_maker_titles);
    facts.push({
      field: "enrichment.decision_maker_names",
      text: `Known decision-maker(s): ${decisionMakerNames.map((n, i) => (titles[i] ? `${n} (${titles[i]})` : n)).join(", ")}.`,
    });
  }
  const boardMembers = stringArray(enrichment.board_members);
  if (boardMembers.length > 0) {
    facts.push({ field: "enrichment.board_members", text: `Known board member(s): ${boardMembers.join(", ")}.` });
  }

  if (typeof enrichment.rating === "number") {
    facts.push({ field: "enrichment.rating", text: `Google Places rating: ${enrichment.rating}.` });
  }
  const googleTypes = stringArray(enrichment.google_types);
  if (googleTypes.length > 0) {
    facts.push({ field: "enrichment.google_types", text: `Google Places category tags: ${googleTypes.join(", ")}.` });
  }

  const ps01 = scores["PS-01"] as { score?: unknown; rationale?: unknown } | undefined;
  if (ps01 && typeof ps01.score === "number") {
    facts.push({
      field: "scores.PS-01",
      text: `AG-22 overall giving propensity score: ${ps01.score}/100${typeof ps01.rationale === "string" ? ` (${ps01.rationale})` : ""}.`,
    });
  }
  const ranking = scores.ranking as { is_priority_prospect?: unknown; rank?: unknown } | undefined;
  if (ranking?.is_priority_prospect === true) {
    facts.push({ field: "scores.ranking", text: `Flagged as a priority prospect (rank #${ranking.rank}).` });
  }

  return facts;
}

interface ClaudeGivingDnaOutput {
  summary?: unknown;
  outreach_angles?: unknown;
  data_gaps?: unknown;
}

const SYSTEM_PROMPT =
  "You are a nonprofit fundraising analyst producing an internal-use 'Corporate Giving DNA' briefing on a " +
  "prospective corporate donor. You will be given a numbered list of facts already on file -- these are the " +
  "ONLY facts you may reference. Never state a dollar figure, executive name, donation history, or any other " +
  "specific detail that is not one of the listed facts. If the fact list is short, say so plainly in the " +
  "summary and lean on general, honest outreach angles rather than inventing specifics. Respond with ONLY a " +
  "JSON object: {\"summary\": \"2-4 sentence profile\", \"outreach_angles\": [\"2-3 concrete next steps\"], " +
  "\"data_gaps\": [\"what's missing that would strengthen this profile\"]}.";

function buildPrompt(displayName: string, facts: Fact[]): string {
  const lines = facts.map((f, i) => `${i + 1}. ${f.text}`);
  const factsBlock = lines.length > 0 ? lines.join("\n") : "(none -- no enrichment or scoring data is on file for this company yet.)";
  return `Company: ${displayName}\n\nFacts on file:\n${factsBlock}`;
}

/**
 * Generates a Giving DNA profile for one prospect and persists it to
 * `corporate_prospects.giving_dna`. Throws on a missing prospect, a dead
 * Claude call, or an unusable response -- callers report the failure rather
 * than silently writing a blank profile.
 */
export async function generateGivingDna(
  client: SupabaseClient,
  prospectId: string,
): Promise<GivingDnaResult> {
  const { data, error } = await client
    .from("corporate_prospects")
    .select(
      "id, legal_name, dba_name, website, industry_category, naics_description, sic_code, employee_count_estimate, revenue_estimate, location_count, geographic_footprint, address_city, address_state, is_family_owned, is_veteran_owned, is_minority_owned, is_woman_owned, enrichment, scores",
    )
    .eq("id", prospectId)
    .maybeSingle();

  if (error || !data) {
    throw new Error("Corporate prospect not found.");
  }
  const prospect = data as unknown as GivingDnaProspectRow;
  const displayName = prospect.dba_name?.trim() || prospect.legal_name;

  const facts = buildGivingDnaFacts(prospect);
  const prompt = buildPrompt(displayName, facts);

  const response = await callClaude({ prompt, system: SYSTEM_PROMPT, maxTokens: 700 });
  const parsed = parseClaudeJson<ClaudeGivingDnaOutput>(response.text, {});

  const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
  if (!summary) {
    throw new Error("AI did not return a usable Giving DNA summary.");
  }
  const outreachAngles = stringArray(parsed.outreach_angles);
  const dataGaps = stringArray(parsed.data_gaps);

  const result: GivingDnaResult = {
    summary,
    outreach_angles: outreachAngles,
    data_gaps: dataGaps,
    based_on_fields: facts.map((f) => f.field),
    generated_at: new Date().toISOString(),
  };

  const { error: updateError } = await client
    .from("corporate_prospects")
    .update({ giving_dna: result, updated_at: new Date().toISOString() })
    .eq("id", prospectId);
  if (updateError) {
    throw new Error("Generated a Giving DNA profile but could not save it.");
  }

  return result;
}
