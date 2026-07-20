// AG-30 Donor Intent Monitor Agent (AutonomousAgent, migration 093:
// corporate_intent_signals). Phase 2 per AUTONOMOUS_PLATFORM_VISION.md
// section "AI Donor Intent Engine" and AGENTS_v2.md's Phase 2-5 spec section
// ("AG-30: Donor Intent Monitor").
//
// Numbering note: AUTONOMOUS_PLATFORM_VISION.md itself numbers this feature
// AG-31 ("New AG-31 (Donor Intent Agent)"), while AGENTS_v2.md's Phase 2-5
// addendum (the doc this build task was scoped from) calls it AG-30 - the two
// governance docs disagree and both flag it as a known mismatch rather than
// an accident (see AGENTS_v2.md section 1.4 and its Phase 2-5 numbering
// table). This agent's agentId ("ag-30-donor-intent") is deliberately
// suffixed, matching the precedent set by fundability-scorer-agent.ts
// ("ag-29-fundability") and community-need-predictor-agent.ts
// ("ag-35-community-need"), so its agent_type enum value can never collide
// with a future literal "ag-30"/"ag-31" build either way.
//
// Purpose: continuously monitors press releases, ESG/CSR reports, SEC
// filings, hiring trends, facility expansions, and disaster declarations for
// corporate prospects and scores the probability (0-100) that each announces
// a giving initiative in the next 30-90 days - moving Reputation Intelligence
// (AG-18) and the Relationship Builder concept (AG-19) from reactive
// (detecting a scandal after it's public) to predictive.
//
// Per-org scope: like every other Generation-2 agent (fundability-scorer-
// agent.ts, community-need-predictor-agent.ts), this class operates on
// `this.orgId` only. AutonomousAgent's constructor requires a single orgId,
// so the "for each active org" framing in this feature's own build task is a
// future worker/autonomous-orchestrator.ts registration concern, not
// something this class does itself - wiring that registration is out of
// scope here.
//
// corporate_prospects has no organization_id column - it is a shared pool
// across all orgs (see relationship-graph-builder-agent.ts's identical note
// and project memory `benavora-corporate-prospects-no-org-id`). This agent
// reads from that shared pool without ever writing to it.
//
// NTEE deviation: the build task asked this agent to load "org ... NTEE
// category," but `organizations` (SCHEMA_REGISTRY_v2.md §Tables - Core
// Tenant) has no ntee_code column - NTEE classification lives on
// `foundation_directory`, a different entity than the org itself. This agent
// substitutes the org fields fundability-scorer-agent.ts already established
// as the real available profile signal (tax_status, mission_statement,
// service_area, target_population) rather than inventing a column.
//
// Grounding: signal facts (summary, url, date) must come from a real
// web_search result - callClaudeWithWebSearch's usedWebSearch flag gates
// every prospect the same way community-need-predictor-agent.ts gates its
// own run, so a model turn that never actually searched never gets persisted
// as if it had (CLAUDE.md Iron Law #8 / #3). geographic_relevance and
// mission_alignment are the model's numeric judgment over facts already on
// hand (org profile + prospect record), not a claim about external reality,
// matching the pattern fundability-scorer-agent.ts uses for its own scores.
//
// Hard limits (AUTONOMOUS_HARD_LIMITS, AGENTS_v2.md AG-30 spec): never
// asserts intent as fact - every inserted row carries its signal_url/
// signal_date evidence and only ever surfaces a recommended_action for a
// human to act on. NEVER_SEND_EMAIL_WITHOUT_APPROVAL applies structurally -
// this agent never contacts a prospect, drafts outreach, or triggers AG-11/
// AG-24; a "Predicted Intent" signal is a badge for a human, never a trigger.

import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, addHours, format, subDays } from "date-fns";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import { callClaudeWithWebSearch } from "@/lib/ai/claude";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule" | "event";

type SignalType =
  | "press_release"
  | "esg_report"
  | "sec_filing"
  | "hiring_trend"
  | "facility_expansion"
  | "disaster_declaration"
  | "foundation_appointment"
  | "csr_announcement"
  | "executive_interview";

const SIGNAL_TYPES: SignalType[] = [
  "press_release",
  "esg_report",
  "sec_filing",
  "hiring_trend",
  "facility_expansion",
  "disaster_declaration",
  "foundation_appointment",
  "csr_announcement",
  "executive_interview",
];

/** Base weight per signal type, per this feature's own build task. The task
 * only specified weights for six of the nine signal_type CHECK values
 * (facility_expansion, disaster_declaration, csr_announcement, esg_report,
 * hiring_trend, press_release); sec_filing/foundation_appointment/
 * executive_interview are reasoned defaults slotted between the given
 * anchors by relative strength as a leading indicator, not fabricated. */
const SIGNAL_TYPE_WEIGHTS: Record<SignalType, number> = {
  facility_expansion: 90,
  disaster_declaration: 85,
  foundation_appointment: 75,
  csr_announcement: 80,
  esg_report: 70,
  sec_filing: 65,
  hiring_trend: 60,
  executive_interview: 55,
  press_release: 50,
};

const INTENT_SCORE_THRESHOLD = 60;
const HIGH_INTENT_THRESHOLD = 80;
const MAX_PROSPECTS_PER_RUN = 6;
const MAX_SIGNALS_PER_PROSPECT = 3;
const MAX_TOKENS = 1400;
const MAX_SEARCHES_PER_PROSPECT = 4;
const DEDUP_WINDOW_DAYS = 14;

interface OrgProfile {
  id: string;
  name: string;
  tax_status: string | null;
  mission_statement: string | null;
  service_area: string | null;
  target_population: string | null;
  city: string | null;
  state: string | null;
}

interface ProspectRow {
  id: string;
  legal_name: string;
  website: string | null;
  address_city: string | null;
  address_state: string | null;
  naics_description: string | null;
  industry_category: string | null;
}

interface RawSignal {
  signal_type?: string;
  signal_summary?: string;
  signal_url?: string;
  signal_date?: string;
  geographic_relevance?: number;
  mission_alignment?: number;
  recommended_action?: string;
}

interface ValidatedSignal {
  signal_type: SignalType;
  signal_summary: string;
  signal_url: string | null;
  signal_date: string | null;
  geographic_relevance: number;
  mission_alignment: number;
  recommended_action: string | null;
}

function clamp0to100(value: unknown, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function isValidDate(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime());
}

/** Validates one of Claude's raw signal objects against
 * corporate_intent_signals' CHECK constraints (migration 093). An invalid
 * signal_type or missing summary is rejected outright rather than inserted
 * and left for a downstream reader to reconcile, mirroring
 * community-need-predictor-agent.ts's validateSignal(). */
function validateSignal(raw: RawSignal): ValidatedSignal | null {
  if (!raw.signal_type || !SIGNAL_TYPES.includes(raw.signal_type as SignalType)) {
    return null;
  }
  if (!raw.signal_summary || raw.signal_summary.trim() === "") return null;

  const signal_date =
    typeof raw.signal_date === "string" && isValidDate(raw.signal_date)
      ? raw.signal_date
      : null;

  return {
    signal_type: raw.signal_type as SignalType,
    signal_summary: raw.signal_summary,
    signal_url: typeof raw.signal_url === "string" && raw.signal_url.trim() !== "" ? raw.signal_url : null,
    signal_date,
    geographic_relevance: clamp0to100(raw.geographic_relevance, 50),
    mission_alignment: clamp0to100(raw.mission_alignment, 50),
    recommended_action:
      typeof raw.recommended_action === "string" && raw.recommended_action.trim() !== ""
        ? raw.recommended_action
        : null,
  };
}

/** Recency decay: a signal found via live search is worth less the older its
 * underlying event is, since "will they announce in the next 30-90 days" is
 * inherently a near-term prediction. No date found is treated as neutral
 * rather than penalized, since the search may simply not have surfaced one. */
function recencyScore(signalDate: string | null): number {
  if (!signalDate) return 50;
  const days = Math.floor(
    (Date.now() - new Date(signalDate).getTime()) / (1000 * 60 * 60 * 24),
  );
  if (days < 0) return 50;
  if (days <= 30) return 100;
  if (days <= 90) return 70;
  if (days <= 180) return 40;
  return 15;
}

/** Deterministic composite score: signal-type strength is the dominant
 * factor (this is fundamentally about what kind of event predicts giving
 * intent), with geographic/mission fit and recency as modifiers. Kept
 * deterministic rather than asked of Claude directly so the same inputs
 * always produce the same score and the formula stays auditable. */
function computeIntentScore(signal: ValidatedSignal): number {
  const typeWeight = SIGNAL_TYPE_WEIGHTS[signal.signal_type];
  const recency = recencyScore(signal.signal_date);
  const score =
    0.45 * typeWeight +
    0.2 * signal.geographic_relevance +
    0.2 * signal.mission_alignment +
    0.15 * recency;
  return clamp0to100(score, 0);
}

function extractJsonArray(text: string): RawSignal[] {
  const jsonText = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");
  try {
    const parsed: unknown = JSON.parse(jsonText);
    return Array.isArray(parsed) ? (parsed as RawSignal[]) : [];
  } catch {
    return [];
  }
}

export class DonorIntentMonitorAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-30-donor-intent", supabase);
  }

  private async loadOrgProfile(): Promise<OrgProfile | null> {
    const { data } = await this.supabase
      .from("organizations")
      .select(
        "id, name, tax_status, mission_statement, service_area, target_population, city, state",
      )
      .eq("id", this.orgId)
      .maybeSingle();
    return (data ?? null) as OrgProfile | null;
  }

  /** corporate_prospects is a shared, non-org-scoped pool (see file header).
   * Prefer prospects in the org's own state when known so geographic_relevance
   * has a real anchor; fall back to the most recently added prospects
   * overall when the org has no state on file. */
  private async loadProspects(org: OrgProfile): Promise<ProspectRow[]> {
    const baseSelect =
      "id, legal_name, website, address_city, address_state, naics_description, industry_category";

    if (org.state) {
      const { data, error } = await this.supabase
        .from("corporate_prospects")
        .select(baseSelect)
        .eq("address_state", org.state)
        .order("created_at", { ascending: false })
        .limit(MAX_PROSPECTS_PER_RUN * 3);

      if (!error && data && data.length > 0) {
        return (data as ProspectRow[]).slice(0, MAX_PROSPECTS_PER_RUN);
      }
    }

    const { data, error } = await this.supabase
      .from("corporate_prospects")
      .select(baseSelect)
      .order("created_at", { ascending: false })
      .limit(MAX_PROSPECTS_PER_RUN);

    if (error) throw new Error(`Failed to load corporate_prospects: ${error.message}`);
    return (data ?? []) as ProspectRow[];
  }

  /** Skips a prospect this org has already scored in the dedup window rather
   * than re-inserting the same intent signal on every run. */
  private async recentlyScored(companyName: string): Promise<boolean> {
    const since = subDays(new Date(), DEDUP_WINDOW_DAYS).toISOString();
    const { data } = await this.supabase
      .from("corporate_intent_signals")
      .select("id")
      .eq("org_id", this.orgId)
      .eq("company_name", companyName)
      .gte("created_at", since)
      .limit(1);
    return (data?.length ?? 0) > 0;
  }

  private buildPrompt(org: OrgProfile, prospect: ProspectRow): { system: string; prompt: string } {
    const system = [
      "You are a corporate giving intelligence analyst. Your job is to find REAL, CURRENTLY VERIFIABLE public signals - via web search - that predict whether a specific company is likely to announce a charitable giving initiative in the next 30-90 days.",
      "",
      "RULES:",
      "1. Only report a signal when you found real, cited evidence via web search. Never estimate, infer, or recall a signal from training data alone - if search finds nothing relevant, return an empty array.",
      "2. signal_type must be exactly one of: " + SIGNAL_TYPES.join(", ") + ".",
      "3. geographic_relevance (0-100) rates how relevant this company's footprint is to the nonprofit's service area given below - 100 means the company operates directly in that area.",
      "4. mission_alignment (0-100) rates how well this company's apparent giving priorities (from what you find, or its industry if nothing giving-specific is found) align with the nonprofit's mission and target population given below.",
      "5. recommended_action must be one concrete, specific next step for the nonprofit (e.g. 'Submit a letter of inquiry referencing their new distribution center opening in [city]'), never a vague generality.",
      `6. Report at most ${MAX_SIGNALS_PER_PROSPECT} signals, only the strongest ones you can actually substantiate.`,
      "7. Respond with ONLY a JSON array (no markdown fences, no prose) of objects shaped exactly:",
      '{"signal_type": "...", "signal_summary": "one to two sentences", "signal_url": "source URL", "signal_date": "YYYY-MM-DD if known", "geographic_relevance": <integer 0-100>, "mission_alignment": <integer 0-100>, "recommended_action": "..."}',
    ].join("\n");

    const orgLines = [
      `- Name: ${org.name}`,
      org.tax_status ? `- Tax status: ${org.tax_status}` : null,
      org.mission_statement ? `- Mission: ${org.mission_statement}` : null,
      org.service_area
        ? `- Service area: ${org.service_area}`
        : org.city || org.state
          ? `- Service area: ${[org.city, org.state].filter(Boolean).join(", ")}`
          : null,
      org.target_population ? `- Target population: ${org.target_population}` : null,
    ].filter((line): line is string => line !== null);

    const prospectLines = [
      `- Company: ${prospect.legal_name}`,
      prospect.website ? `- Website: ${prospect.website}` : null,
      prospect.address_city || prospect.address_state
        ? `- Known location: ${[prospect.address_city, prospect.address_state].filter(Boolean).join(", ")}`
        : null,
      prospect.industry_category
        ? `- Industry: ${prospect.industry_category}`
        : prospect.naics_description
          ? `- Industry (NAICS): ${prospect.naics_description}`
          : null,
    ].filter((line): line is string => line !== null);

    const prompt = [
      "## Nonprofit (the org looking for donor intent signals)",
      orgLines.join("\n"),
      "",
      "## Company to research",
      prospectLines.join("\n"),
      "",
      `Use web search now for "${prospect.legal_name}" combined with terms like press release, CSR, ESG, corporate giving, community investment, and the nonprofit's service area above. ` +
        "Look specifically for facility expansions, disaster response commitments, new CSR/foundation appointments, hiring surges, SEC filings mentioning community investment, or executive interviews discussing giving plans. " +
        "Return ONLY the JSON array described above.",
    ].join("\n");

    return { system, prompt };
  }

  override async run(triggerSource: TriggerSource): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource);
    const errors: string[] = [];
    const decisions: string[] = [];
    let tokensUsed = 0;
    let itemsFound = 0;
    let itemsProcessed = 0;
    let itemsQueued = 0;

    try {
      const org = await this.loadOrgProfile();
      if (!org) throw new Error(`Could not load organization ${this.orgId}.`);

      const prospects = await this.loadProspects(org);
      itemsFound = prospects.length;

      for (const prospect of prospects) {
        try {
          if (await this.recentlyScored(prospect.legal_name)) {
            continue;
          }

          const { system, prompt } = this.buildPrompt(org, prospect);
          const response = await callClaudeWithWebSearch({
            system,
            prompt,
            maxTokens: MAX_TOKENS,
            maxSearches: MAX_SEARCHES_PER_PROSPECT,
          });
          tokensUsed += response.usage.totalTokens;
          itemsProcessed += 1;

          if (!response.usedWebSearch) {
            errors.push(
              `${prospect.legal_name}: Claude did not issue a web_search call - discarded any response rather than persist an ungrounded signal.`,
            );
            continue;
          }

          const rawSignals = extractJsonArray(response.text);
          const validSignals = rawSignals
            .map(validateSignal)
            .filter((s): s is ValidatedSignal => s !== null)
            .slice(0, MAX_SIGNALS_PER_PROSPECT);

          for (const signal of validSignals) {
            const intentScore = computeIntentScore(signal);
            if (intentScore < INTENT_SCORE_THRESHOLD) continue;

            const isHighIntent = intentScore >= HIGH_INTENT_THRESHOLD;
            const recommendedDeadline = format(
              isHighIntent ? addHours(new Date(), 48) : addDays(new Date(), 7),
              "yyyy-MM-dd",
            );

            const { data: inserted, error: insertError } = await this.supabase
              .from("corporate_intent_signals")
              .insert({
                org_id: this.orgId,
                company_name: prospect.legal_name,
                signal_type: signal.signal_type,
                signal_summary: signal.signal_summary,
                signal_url: signal.signal_url,
                signal_date: signal.signal_date,
                intent_score: intentScore,
                geographic_relevance: signal.geographic_relevance,
                mission_alignment: signal.mission_alignment,
                recommended_action: signal.recommended_action,
                recommended_deadline: recommendedDeadline,
              })
              .select("id")
              .single();

            if (insertError || !inserted) {
              errors.push(
                `Failed to save intent signal for "${prospect.legal_name}": ${
                  insertError?.message ?? "no row returned"
                }`,
              );
              continue;
            }

            itemsQueued += 1;
            const signalId = (inserted as { id: string }).id;

            decisions.push(
              await this.logDecision({
                decisionType: "donor_intent_detected",
                agentRunId: runId,
                entityType: "corporate_intent_signal",
                entityId: signalId,
                reasoning:
                  `${prospect.legal_name}: ${signal.signal_summary} ` +
                  `(type=${signal.signal_type}, geo=${signal.geographic_relevance}, mission=${signal.mission_alignment}) ` +
                  `-> intent_score ${intentScore}/100.`,
                confidenceScore: intentScore,
                actionTaken: isHighIntent
                  ? `Recorded HIGH-intent signal (>=${HIGH_INTENT_THRESHOLD}); recommended action due within 48 hours.`
                  : `Recorded intent signal; recommended action due within 7 days.`,
                actionPayload: {
                  signal_type: signal.signal_type,
                  signal_url: signal.signal_url,
                  intent_score: intentScore,
                  recommended_action: signal.recommended_action,
                  recommended_deadline: recommendedDeadline,
                },
                requiredHumanReview: true,
              }),
            );

            if (isHighIntent) {
              await this.createNotification(
                "donor_intent_high",
                `High donor intent: ${prospect.legal_name}`,
                signal.recommended_action ?? signal.signal_summary,
              );
            }
          }
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Failed to analyze prospect for donor intent.";
          errors.push(`${prospect.legal_name}: ${message}`);
        }
      }

      const summary =
        itemsQueued > 0
          ? `Analyzed ${itemsProcessed} of ${itemsFound} prospect(s); recorded ${itemsQueued} donor intent signal(s) at or above ${INTENT_SCORE_THRESHOLD}/100.`
          : `Analyzed ${itemsProcessed} of ${itemsFound} prospect(s); no signal reached the ${INTENT_SCORE_THRESHOLD}/100 intent threshold.`;

      await this.completeRun(runId, {
        outputSummary: summary,
        itemsFound,
        itemsProcessed,
        itemsQueued,
        tokensUsed,
      });

      return {
        success: true,
        itemsFound,
        itemsProcessed,
        itemsQueued,
        decisions,
        nextActions: [],
        errors,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Donor intent monitoring run failed.";
      await this.failRun(runId, message);
      return {
        success: false,
        itemsFound,
        itemsProcessed,
        itemsQueued,
        decisions,
        nextActions: [],
        errors: [...errors, message],
      };
    }
  }
}
