// AG-27 Board Meeting Packet Agent (AutonomousAgent, migration 078/105:
// board_meetings, board_meeting_packets, RLS added migration 105; this
// build's own migration adds the 'ag-27-board-packet' agent_type enum value
// and a UNIQUE(meeting_id) constraint on board_meeting_packets as
// defense-in-depth). Enterprise spec: AGENTS_v2.md §5, AG-27 "Board Meeting
// Packet Agent". Purpose: generates a complete board meeting packet 48
// hours before every scheduled meeting — pipeline summary, outcomes since
// the last meeting, a lightweight financial snapshot, a plain-language
// financial narrative, and Claude-written, evidence-grounded discussion
// items.
//
// FEATURE_REGISTRY_v2.md row #139 ("Plain Language Financials"): this file
// used to explicitly decline that row, on the grounds that its own
// financialSnapshot (organizations.annual_budget/total_staff/
// total_volunteers) is deliberately lightweight, not the deeper narrative
// row #139 actually asks for. That is still true of financialSnapshot
// specifically — it is unchanged below. Row #139 itself is now attempted,
// as a second, additional packet_content key, plainLanguageFinancials
// (buildFinancialAggregates()/generatePlainLanguageFinancials() below):
// real aggregates from grant_budgets/grant_expenses/
// grant_reconciliation_reports (migrations 084/089 — that table family
// uses organization_id, NOT board_meetings'/board_meeting_packets' org_id;
// see each query below), narrated by Claude into 2-4 board-appropriate
// sentences with every claim grounded in a real computed number (a
// groundedFacts array — the same trace-every-claim-to-a-real-fact
// discipline groundedIn already enforces for discussion items, adapted for
// short prose instead of a list). Chosen to live inside the packet (rather
// than a new /board/[id] section computed live on every page view, or a
// standalone page) because: (1) it is genuinely the deeper counterpart to
// the packet's own existing financialSnapshot, presented the way a board
// member reads it, alongside that same meeting's pipeline/outcomes — not
// an unrelated feature; (2) it reuses this agent's already-live trigger
// (daily schedule + event safety net), Claude-retry, and packet-storage
// plumbing instead of adding a second Claude-calling code path with its
// own rate limiting; (3) /board/[id] (q34-002) already renders one card
// per packet — this is a new field on that same card, not a new fetch, API
// route, or page. Degrades honestly, matching this file's own established
// pattern: an org with zero real grant_budgets/grant_expenses/
// grant_reconciliation_reports rows gets an explicit "no financial data on
// file yet" note and no Claude call, never a fabricated narrative.
//
// Confirmed live before writing this file (not assumed, via DATABASE_URL/
// psql): board_meetings (id, org_id, meeting_date [date, NOT timestamptz],
// meeting_type, agenda, status, created_at) and board_meeting_packets (id,
// org_id, meeting_id [FK -> board_meetings.id ON DELETE CASCADE],
// packet_content jsonb NOT NULL, generated_at, viewed_by text[]) both exist
// live with RLS enabled (migration 078/105). board_members' real live
// columns are organization_id/name/title/bio/is_active — NOT the
// org_id/active/role/expertise columns an earlier session's AG-32 bug once
// assumed (AGENT_VERIFICATION_LOG.md) — not used directly by this agent,
// but confirmed for consistency since board_meetings and board_members sit
// in the same "board" feature area with genuinely different column-naming
// conventions (org_id vs organization_id) that are easy to conflate.
//
// meeting_date is a DATE column with no time component — the spec's "47-49
// hour window around the 48-hour mark" is therefore implemented at day
// granularity, not hour granularity, AND widened from the spec's literal
// "exactly 47-49 hours out" framing to "0-2 calendar days out inclusive"
// (see resolveBoardPacketScope() in worker/autonomous-orchestrator.ts).
// This is a deliberate, stated interpretive choice: a narrow one-day-only
// window would only ever catch a given meeting on a single calendar day's
// run, which contradicts the spec's own Idempotency section ("a meeting
// that failed today is still in-window tomorrow... until either a packet
// exists or the meeting date passes") — that retry guarantee only holds if
// the scope query keeps re-selecting an as-yet-unpacketed meeting on every
// day up to the meeting date itself, not just on the one day it happens to
// be exactly 2 days out. Widening the window preserves the spec's real
// intent (packet ready ~48h ahead, with a safety margin) while making the
// stated retry behavior actually true.
//
// Trigger design, per spec (two triggers):
// 1. Daily schedule (primary) — worker/scheduler.ts, 2:00 AM CST, scope
//    resolved by resolveBoardPacketScope() in
//    worker/autonomous-orchestrator.ts: board_meetings with
//    status='scheduled' AND meeting_date within [today, today+2 days] AND
//    no board_meeting_packets row yet for meeting_id. Passed into
//    run('schedule', meetingIds) as an explicit array, mirroring AG-23's
//    resolveIncrementalBoardMemberScope() -> run('schedule', ids) convention
//    (relationship-graph-builder-agent.ts).
// 2. Event-chained safety net — POST /api/autonomous/board-packet-trigger
//    enqueues agent_queue (agent_id: "ag-27-board-packet", trigger_source:
//    "event", input_payload: { meetingId }) for a meeting created or
//    rescheduled with less than 48 hours' notice — the case the daily
//    schedule's once-a-day granularity could otherwise miss entirely if the
//    meeting is created after that day's run. Routed from the queue in
//    worker/autonomous-orchestrator.ts's routeQueueItem(); resolved via
//    loadEventScope(), mirroring GrantDnaAgent's/FollowupGeneratorAgent's
//    identical "read the queue row the worker marked processing" pattern.
//
// Idempotency (spec's own framing, restated): the scope query itself is the
// primary guarantee — "no board_meeting_packets row exists yet for this
// meeting_id" excludes any already-packeted meeting from the schedule scope
// query. processOneMeeting() below adds a second, defense-in-depth check
// (a fresh existence lookup per meeting) since the event path has no scope
// query of its own to exclude on, and a 23505 unique-violation on the
// insert itself (caught explicitly) is treated as a legitimate no-op rather
// than a failure, for the case where both triggers race for the same
// meeting. The migration's UNIQUE(meeting_id) constraint is the actual
// backstop underneath both checks, per the spec's own "should still be
// added... explicitly flagged as part of this agent's own build task"
// instruction.
//
// Autonomy level: full autonomy for generation, no submit/send capability —
// this agent never emails or distributes the packet itself
// (AUTONOMOUS_HARD_LIMITS.NEVER_SEND_EMAIL_WITHOUT_APPROVAL); it writes a
// packet a human opens in-app and fires a real in-app notification
// (createNotification()) that one is ready. Distribution/viewing is a
// human-driven UI flow, out of this agent's own scope per the spec.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import { callClaude, DEFAULT_MODEL } from "@/lib/ai/claude";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule" | "event";

const DISCUSSION_ITEMS_MAX_TOKENS = 900;
const PIPELINE_WINDOW_DAYS = 90;
const FIRST_MEETING_LOOKBACK_DAYS = 90;
const FINANCIAL_NARRATIVE_MAX_TOKENS = 500;
const FINANCIAL_CATEGORY_TOP_N = 5;

const DISCUSSION_SYSTEM_PROMPT =
  "You are the Board Meeting Packet Agent inside Benavora, an AI-powered " +
  "nonprofit funding intelligence platform. You are given a real board " +
  "meeting's agenda plus deterministically-assembled pipeline, outcomes, " +
  "and financial sections for one organization. Write 3-5 board-relevant " +
  "discussion items a development director could raise at this specific " +
  "meeting. Every item must be genuinely grounded in one of the facts you " +
  "were given - a specific pipeline opportunity, a specific outcome, the " +
  "financial snapshot, or the meeting's own agenda - never a generic " +
  "platitude a board could hear at any nonprofit's meeting. Never invent a " +
  "fact, number, or opportunity name that was not given to you. You are " +
  "producing structured data for another system, not prose for a human to " +
  "read directly - respond with ONLY the requested JSON, no markdown " +
  "fences, no commentary before or after it.";

// FEATURE_REGISTRY_v2.md row #139, "Plain Language Financials" — see file
// header. Distinct from DISCUSSION_SYSTEM_PROMPT: this call's only job is to
// translate real, already-aggregated grant financial figures into
// jargon-free prose a board member (not an accountant) can read, never to
// introduce a new fact.
const FINANCIAL_NARRATIVE_SYSTEM_PROMPT =
  "You are the Board Meeting Packet Agent inside Benavora, an AI-powered " +
  "nonprofit funding intelligence platform. You are given real, " +
  "deterministically-aggregated grant budget and expense figures for one " +
  "organization - never raw accounting data, never estimates. Write a " +
  "short, jargon-free financial summary (2-4 sentences) a nonprofit board " +
  "member with no accounting background could read and understand in " +
  "under a minute. Use plain English, not accounting terms (say 'money " +
  "budgeted' not 'appropriation', 'money spent so far' not 'expenditure', " +
  "'money left' not 'variance'). Every dollar figure and category name in " +
  "your summary must be one of the exact figures/names you were given - " +
  "never round loosely, never invent a spending category, program, or " +
  "number that was not given to you, and never speculate about causes you " +
  "were not told. For each sentence, cite which given fact(s) it is based " +
  "on in a groundedFacts array (e.g. \"totalBudgeted\", \"categoryBreakdown\", " +
  "\"reconciliation\"). You are producing structured data for another " +
  "system, not prose for a human to read directly in this response - " +
  "respond with ONLY the requested JSON, no markdown fences, no commentary " +
  "before or after it.";

interface BoardMeetingRow {
  id: string;
  org_id: string;
  meeting_date: string;
  meeting_type: string;
  agenda: string | null;
  status: string;
}

interface OrgRow {
  id: string;
  name: string | null;
  annual_budget: number | null;
  total_staff: number | null;
  total_volunteers: number | null;
}

interface OpportunityRow {
  id: string;
  name: string;
  category: string | null;
  amount_min: number | null;
  amount_max: number | null;
  deadline: string | null;
}

interface OutcomeRow {
  result: string;
  awarded_amount: number | null;
  recorded_at: string | null;
}

interface PipelineSummary {
  count: number;
  note?: string;
  opportunities: {
    name: string;
    category: string | null;
    amountMin: number | null;
    amountMax: number | null;
    deadline: string | null;
  }[];
}

interface OutcomesSummary {
  sinceDate: string;
  isFirstMeeting: boolean;
  count: number;
  awarded: number;
  denied: number;
  partial: number;
  totalAwardedAmount: number;
  note: string;
}

interface FinancialSnapshot {
  annualBudget: number | null;
  totalStaff: number | null;
  totalVolunteers: number | null;
  note?: string;
}

// Migration 084/089 — real columns confirmed against src/types/database.ts
// and the live /api/applications/[id]/reconcile route. This table family is
// organization_id-scoped, unlike board_meetings/board_meeting_packets'
// org_id (see file header).
interface GrantBudgetRow {
  application_id: string | null;
  total_budget: number;
}

interface GrantExpenseRow {
  application_id: string | null;
  category: string | null;
  amount: number;
}

// compliance_status is real, free text written only by
// /api/applications/[id]/reconcile: "under_budget" | "on_budget" |
// "over_budget" | "no_budget_set" — not a DB enum, so read as plain string.
interface GrantReconciliationRow {
  application_id: string;
  compliance_status: string | null;
}

interface CategoryAmount {
  category: string;
  amount: number;
}

interface ComplianceStatusCount {
  status: string;
  count: number;
}

interface FinancialAggregates {
  totalBudgeted: number;
  totalSpent: number;
  variance: number;
  budgetsCount: number;
  expensesCount: number;
  categoryBreakdown: CategoryAmount[];
  reconciliation: ComplianceStatusCount[];
  hasAnyData: boolean;
}

interface PlainLanguageFinancials extends FinancialAggregates {
  narrative: string | null;
  groundedFacts: string[];
  note?: string;
}

interface ClaudeFinancialNarrativeRaw {
  narrative?: unknown;
  groundedFacts?: unknown;
}

interface DiscussionItem {
  item: string;
  groundedIn: string;
}

interface ClaudeDiscussionItemRaw {
  item?: unknown;
  groundedIn?: unknown;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error.";
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// Real values only: "under_budget" | "on_budget" | "over_budget" |
// "no_budget_set" (written by /api/applications/[id]/reconcile), plus this
// file's own "not_reconciled" fallback for a grant with no report at all.
function humanizeComplianceStatus(status: string): string {
  switch (status) {
    case "under_budget":
      return "Under budget";
    case "on_budget":
      return "On budget";
    case "over_budget":
      return "Over budget";
    case "no_budget_set":
      return "No budget set";
    case "not_reconciled":
      return "Not yet reconciled";
    default:
      return status;
  }
}

export class BoardPacketAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-27-board-packet", supabase);
  }

  /**
   * Reads the agent_queue row the worker marked "processing" for this
   * org/agent this run — AutonomousAgent has no queue-item id passed into
   * run(), so the currently-processing row is the only way to recover the
   * event payload (mirrors GrantDnaAgent.loadEventScope /
   * FollowupGeneratorAgent.loadTriggerPayload).
   */
  private async loadEventScope(): Promise<string[]> {
    const { data: queueRow } = await this.supabase
      .from("agent_queue")
      .select("input_payload")
      .eq("org_id", this.orgId)
      .eq("agent_id", this.agentId)
      .eq("status", "processing")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const payload = (queueRow?.input_payload ?? {}) as { meetingId?: unknown };
    if (typeof payload.meetingId !== "string" || payload.meetingId.trim() === "") {
      return [];
    }
    return [payload.meetingId];
  }

  /**
   * Resolves the set of board_meetings to process this run: an explicit
   * scope (the schedule path, passed by
   * runBoardPacketDailyPipeline()/resolveBoardPacketScope() in
   * autonomous-orchestrator.ts) takes priority; otherwise, on an "event"
   * trigger, falls back to loadEventScope(). A "manual" trigger with no
   * explicit scope resolves to zero meetings — a legitimate no-op
   * completion, not a failure, matching every other AutonomousAgent's
   * empty-scope handling in this codebase.
   */
  private async resolveMeetings(
    triggerSource: TriggerSource,
    meetingIds?: string[],
  ): Promise<BoardMeetingRow[]> {
    let ids: string[];
    if (meetingIds && meetingIds.length > 0) {
      ids = meetingIds;
    } else if (triggerSource === "event") {
      ids = await this.loadEventScope();
    } else {
      ids = [];
    }
    if (ids.length === 0) return [];

    const { data } = await this.supabase
      .from("board_meetings")
      .select("id, org_id, meeting_date, meeting_type, agenda, status")
      .in("id", ids)
      .eq("org_id", this.orgId);
    return (data ?? []) as BoardMeetingRow[];
  }

  /** Step 2, pipeline section: open opportunities in the 90-day window. An
   * explicit, honest zero rather than an omitted section (spec step 2). */
  private async buildPipelineSummary(): Promise<PipelineSummary> {
    const windowEnd = addDays(new Date(), PIPELINE_WINDOW_DAYS);

    const { data } = await this.supabase
      .from("opportunities")
      .select("id, name, category, amount_min, amount_max, deadline")
      .eq("organization_id", this.orgId)
      .eq("status", "open")
      .lte("deadline", windowEnd.toISOString());
    const opportunities = (data ?? []) as OpportunityRow[];

    if (opportunities.length === 0) {
      return {
        count: 0,
        note: "No opportunities currently in the 90-day pipeline.",
        opportunities: [],
      };
    }

    return {
      count: opportunities.length,
      opportunities: opportunities.map((o) => ({
        name: o.name,
        category: o.category,
        amountMin: o.amount_min,
        amountMax: o.amount_max,
        deadline: o.deadline,
      })),
    };
  }

  /** Step 2, outcomes-since-last-meeting section: if this is genuinely the
   * org's first tracked meeting (no prior board_meeting_packets row exists
   * for this org at all), states that explicitly and falls back to a
   * trailing-90-day lookback rather than silently implying "since last
   * meeting" when there wasn't one. */
  private async buildOutcomesSummary(
    meeting: BoardMeetingRow,
  ): Promise<OutcomesSummary> {
    const { data: packetRows } = await this.supabase
      .from("board_meeting_packets")
      .select("meeting_id")
      .eq("org_id", this.orgId);

    let sinceDateObj: Date;
    let isFirstMeeting = false;
    let note: string;

    const meetingIds = (packetRows ?? [])
      .map((p) => p.meeting_id as string | null)
      .filter((id): id is string => typeof id === "string");

    if (meetingIds.length === 0) {
      isFirstMeeting = true;
      sinceDateObj = addDays(
        new Date(meeting.meeting_date),
        -FIRST_MEETING_LOOKBACK_DAYS,
      );
      note =
        "This is the first tracked board meeting for this organization — " +
        "showing outcomes from the trailing 90 days rather than \"since last meeting.\"";
    } else {
      const { data: priorMeetings } = await this.supabase
        .from("board_meetings")
        .select("id, meeting_date")
        .in("id", meetingIds)
        .lt("meeting_date", meeting.meeting_date)
        .order("meeting_date", { ascending: false })
        .limit(1);
      const previous = (priorMeetings ?? [])[0] as
        | { id: string; meeting_date: string }
        | undefined;

      if (previous) {
        sinceDateObj = new Date(previous.meeting_date);
        note = `Outcomes recorded since the ${previous.meeting_date} board meeting.`;
      } else {
        isFirstMeeting = true;
        sinceDateObj = addDays(
          new Date(meeting.meeting_date),
          -FIRST_MEETING_LOOKBACK_DAYS,
        );
        note =
          "No earlier packeted board meeting found for this organization — " +
          "showing outcomes from the trailing 90 days.";
      }
    }

    const { data: outcomeData } = await this.supabase
      .from("outcomes")
      .select("result, awarded_amount, recorded_at")
      .eq("organization_id", this.orgId)
      .gte("recorded_at", sinceDateObj.toISOString());
    const outcomes = (outcomeData ?? []) as OutcomeRow[];

    const awarded = outcomes.filter((o) => o.result === "awarded").length;
    const denied = outcomes.filter((o) => o.result === "denied").length;
    const partial = outcomes.filter((o) => o.result === "partial").length;
    const totalAwardedAmount = outcomes
      .filter((o) => o.result === "awarded" || o.result === "partial")
      .reduce((sum, o) => sum + (o.awarded_amount ?? 0), 0);

    if (outcomes.length === 0) {
      note += " No outcomes were recorded in this window.";
    }

    return {
      sinceDate: toDateOnly(sinceDateObj),
      isFirstMeeting,
      count: outcomes.length,
      awarded,
      denied,
      partial,
      totalAwardedAmount,
      note,
    };
  }

  /** Step 2, financial section: null annual_budget states "not yet on
   * file" explicitly rather than showing a blank or a misleading $0. */
  private buildFinancialSnapshot(org: OrgRow): FinancialSnapshot {
    if (org.annual_budget == null) {
      return {
        annualBudget: null,
        totalStaff: org.total_staff,
        totalVolunteers: org.total_volunteers,
        note: "Financial data not yet on file.",
      };
    }
    return {
      annualBudget: org.annual_budget,
      totalStaff: org.total_staff,
      totalVolunteers: org.total_volunteers,
    };
  }

  /** FEATURE_REGISTRY_v2.md row #139 support, step 1: real, deterministic
   * aggregates from grant_budgets/grant_expenses/grant_reconciliation_reports
   * (migrations 084/089), organization_id-scoped (NOT this file's usual
   * org_id — see header). No Claude call here; this is the grounding-fact
   * layer generatePlainLanguageFinancials() below narrates from, never lets
   * Claude compute itself. */
  private async buildFinancialAggregates(): Promise<FinancialAggregates> {
    const [budgetsRes, expensesRes, reconciliationRes] = await Promise.all([
      this.supabase
        .from("grant_budgets")
        .select("application_id, total_budget")
        .eq("organization_id", this.orgId),
      this.supabase
        .from("grant_expenses")
        .select("application_id, category, amount")
        .eq("organization_id", this.orgId),
      this.supabase
        .from("grant_reconciliation_reports")
        .select("application_id, compliance_status")
        .eq("organization_id", this.orgId),
    ]);

    const budgets = (budgetsRes.data ?? []) as GrantBudgetRow[];
    const expenses = (expensesRes.data ?? []) as GrantExpenseRow[];
    const reconciliation = (reconciliationRes.data ?? []) as GrantReconciliationRow[];

    const totalBudgeted = budgets.reduce((sum, b) => sum + (b.total_budget ?? 0), 0);
    const totalSpent = expenses.reduce((sum, e) => sum + (e.amount ?? 0), 0);

    const categoryTotals = new Map<string, number>();
    for (const e of expenses) {
      const key = e.category?.trim() || "Uncategorized";
      categoryTotals.set(key, (categoryTotals.get(key) ?? 0) + (e.amount ?? 0));
    }
    const categoryBreakdown: CategoryAmount[] = Array.from(
      categoryTotals.entries(),
      ([category, amount]) => ({ category, amount }),
    )
      .sort((a, b) => b.amount - a.amount)
      .slice(0, FINANCIAL_CATEGORY_TOP_N);

    const statusCounts = new Map<string, number>();
    for (const r of reconciliation) {
      const key = r.compliance_status?.trim() || "not_reconciled";
      statusCounts.set(key, (statusCounts.get(key) ?? 0) + 1);
    }
    const reconciliationSummary: ComplianceStatusCount[] = Array.from(
      statusCounts.entries(),
      ([status, count]) => ({ status, count }),
    );

    return {
      totalBudgeted,
      totalSpent,
      variance: totalBudgeted - totalSpent,
      budgetsCount: budgets.length,
      expensesCount: expenses.length,
      categoryBreakdown,
      reconciliation: reconciliationSummary,
      hasAnyData: budgets.length > 0 || expenses.length > 0 || reconciliation.length > 0,
    };
  }

  /** FEATURE_REGISTRY_v2.md row #139 support, step 2: the grounding prompt
   * for the plain-language financial narrative. Every number/category name
   * here is a real value from buildFinancialAggregates() — Claude is asked
   * to translate, never to compute or invent. */
  private buildFinancialNarrativePrompt(aggregates: FinancialAggregates): string {
    const categoryLines = aggregates.categoryBreakdown
      .map((c) => `  - ${c.category}: $${c.amount.toLocaleString("en-US")}`)
      .join("\n");
    const reconciliationLines = aggregates.reconciliation
      .map((r) => `  - ${humanizeComplianceStatus(r.status)}: ${r.count} grant(s)`)
      .join("\n");

    return (
      `[totalBudgeted] Total money budgeted across ${aggregates.budgetsCount} grant(s): ` +
      `$${aggregates.totalBudgeted.toLocaleString("en-US")}.\n` +
      `[totalSpent] Total money spent so far across ${aggregates.expensesCount} recorded ` +
      `expense(s): $${aggregates.totalSpent.toLocaleString("en-US")}.\n` +
      `[variance] Money remaining (budgeted minus spent): $${aggregates.variance.toLocaleString("en-US")}.\n` +
      `[categoryBreakdown] Top spending categories (real category names from recorded expenses):\n` +
      `${categoryLines || "  (no categorized expenses on file)"}\n` +
      `[reconciliation] Reconciliation status across grants with a reconciliation report on file:\n` +
      `${reconciliationLines || "  (no reconciliation reports have been run yet)"}\n\n` +
      "For EACH sentence, cite exactly which fact(s) above it is grounded in via a groundedFacts " +
      'array (e.g. "totalBudgeted", "categoryBreakdown") — every sentence must trace back to a ' +
      "real fact stated above, never an unfalsifiable generic statement about the organization's " +
      "finances.\n\n" +
      'Respond with ONLY JSON, shaped exactly as: {"narrative": string, "groundedFacts": string[]}'
    );
  }

  /** FEATURE_REGISTRY_v2.md row #139 support, step 3: one bounded Claude
   * call, only when there is real financial data to narrate. An org with
   * zero grant_budgets/grant_expenses/grant_reconciliation_reports rows
   * gets an explicit "no financial data on file yet" note and no Claude
   * call — never a fabricated narrative (matches this file's own
   * buildFinancialSnapshot()/buildOutcomesSummary() precedent). On total
   * Claude failure, degrades to the real aggregates with no narrative,
   * same as generateDiscussionItems() below. */
  private async generatePlainLanguageFinancials(): Promise<{
    result: PlainLanguageFinancials;
    tokensUsed: number;
  }> {
    const aggregates = await this.buildFinancialAggregates();

    if (!aggregates.hasAnyData) {
      return {
        result: {
          ...aggregates,
          narrative: null,
          groundedFacts: [],
          note: "No financial data on file yet.",
        },
        tokensUsed: 0,
      };
    }

    const prompt = this.buildFinancialNarrativePrompt(aggregates);
    try {
      const { text, tokensUsed } = await this.callClaudeWithRetry(
        prompt,
        FINANCIAL_NARRATIVE_SYSTEM_PROMPT,
        FINANCIAL_NARRATIVE_MAX_TOKENS,
      );
      const jsonText = text
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/i, "");
      const parsed = JSON.parse(jsonText) as ClaudeFinancialNarrativeRaw;
      const narrative = typeof parsed.narrative === "string" ? parsed.narrative.trim() : "";
      const groundedFacts = Array.isArray(parsed.groundedFacts)
        ? parsed.groundedFacts.filter((f): f is string => typeof f === "string")
        : [];

      if (narrative === "") {
        return {
          result: {
            ...aggregates,
            narrative: null,
            groundedFacts: [],
            note: "Financial narrative synthesis returned no usable text this run.",
          },
          tokensUsed,
        };
      }

      return {
        result: { ...aggregates, narrative, groundedFacts },
        tokensUsed,
      };
    } catch {
      return {
        result: {
          ...aggregates,
          narrative: null,
          groundedFacts: [],
          note: "Financial narrative synthesis unavailable this run (Claude call failed after 3 attempts).",
        },
        tokensUsed: 0,
      };
    }
  }

  private buildDiscussionPrompt(
    meeting: BoardMeetingRow,
    pipeline: PipelineSummary,
    outcomes: OutcomesSummary,
    financial: FinancialSnapshot,
  ): string {
    const pipelineLines = pipeline.opportunities
      .slice(0, 15)
      .map(
        (o, i) =>
          `  [opportunities[${i}]] "${o.name}" (category: ${o.category ?? "uncategorized"}, ` +
          `amount: ${o.amountMin ?? "?"}-${o.amountMax ?? "?"}, deadline: ${o.deadline ?? "none"})`,
      )
      .join("\n");

    const financialLine = financial.note
      ? financial.note
      : `Annual budget $${financial.annualBudget?.toLocaleString("en-US")}, ` +
        `${financial.totalStaff ?? "unknown"} staff, ${financial.totalVolunteers ?? "unknown"} volunteers.`;

    return (
      `Board meeting: ${meeting.meeting_type} on ${meeting.meeting_date}. ` +
      `Agenda: ${meeting.agenda ?? "no agenda on file"}.\n\n` +
      `[pipeline] Pipeline summary (90-day window): ${pipeline.count} open opportunity/ies.` +
      `${pipeline.note ? " " + pipeline.note : ""}\n${pipelineLines}\n\n` +
      `[outcomes] Outcomes summary: ${outcomes.note} ${outcomes.count} outcome(s) recorded ` +
      `(${outcomes.awarded} awarded, ${outcomes.denied} denied, ${outcomes.partial} partial), ` +
      `totaling $${outcomes.totalAwardedAmount.toLocaleString("en-US")} awarded/partial.\n\n` +
      `[financial] Financial snapshot: ${financialLine}\n\n` +
      "For EACH item, cite exactly which fact above it is grounded in via a groundedIn field " +
      '(e.g. "opportunities[2]", "outcomes", "financial", "agenda") — every item must trace back ' +
      "to a real fact stated above, never an unfalsifiable generic recommendation.\n\n" +
      'Respond with ONLY JSON, shaped exactly as: {"items": [{"item": string, "groundedIn": string}, ...]}'
    );
  }

  /** Claude call with 3-attempt exponential backoff (1s/2s/4s), the pattern
   * already proven in src/lib/intelligence/embeddings.ts and reused by
   * AG-10/AG-26. Shared by generateDiscussionItems() and
   * generatePlainLanguageFinancials() — system/maxTokens are parameters
   * rather than the discussion-items constants, so both callers get real
   * retry/backoff without a second copy of this loop. */
  private async callClaudeWithRetry(
    prompt: string,
    system: string,
    maxTokens: number,
  ): Promise<{ text: string; tokensUsed: number }> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await callClaude({
          model: DEFAULT_MODEL,
          maxTokens,
          system,
          prompt,
        });
        return { text: response.text, tokensUsed: response.usage.totalTokens };
      } catch (err) {
        lastError = err;
        if (attempt < 2) {
          await new Promise((resolve) =>
            setTimeout(resolve, Math.pow(2, attempt) * 1000),
          );
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Claude call failed after 3 attempts.");
  }

  /** Step 3: one bounded Claude call per meeting. On total Claude failure,
   * degrades to an empty item list rather than blocking the run — the
   * deterministic sections (pipeline/outcomes/financial) are the
   * load-bearing content a board actually needs (spec's Error handling
   * section). */
  private async generateDiscussionItems(
    meeting: BoardMeetingRow,
    pipeline: PipelineSummary,
    outcomes: OutcomesSummary,
    financial: FinancialSnapshot,
  ): Promise<{ items: DiscussionItem[]; tokensUsed: number; degraded: boolean }> {
    const prompt = this.buildDiscussionPrompt(meeting, pipeline, outcomes, financial);

    try {
      const { text, tokensUsed } = await this.callClaudeWithRetry(
        prompt,
        DISCUSSION_SYSTEM_PROMPT,
        DISCUSSION_ITEMS_MAX_TOKENS,
      );
      const jsonText = text
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/i, "");
      const parsed = JSON.parse(jsonText) as { items?: unknown };
      const rawItems = Array.isArray(parsed.items) ? parsed.items : [];

      const items: DiscussionItem[] = rawItems
        .filter(
          (x): x is ClaudeDiscussionItemRaw =>
            typeof x === "object" && x !== null,
        )
        .map((x) => ({
          item: typeof x.item === "string" ? x.item : "",
          groundedIn: typeof x.groundedIn === "string" ? x.groundedIn : "",
        }))
        .filter((x) => x.item.trim() !== "");

      return { items, tokensUsed, degraded: false };
    } catch {
      return { items: [], tokensUsed: 0, degraded: true };
    }
  }

  /** Steps 2-6 for one meeting: idempotency guard, assemble the three
   * sections, one Claude call, write the packet, log a decision, notify. */
  private async processOneMeeting(
    runId: string,
    meeting: BoardMeetingRow,
  ): Promise<{
    written: boolean;
    decisionId?: string;
    tokensUsed: number;
    sectionsWithRealData: number;
    sectionsFallback: number;
  }> {
    // Defense-in-depth idempotency check (see file header) — the schedule
    // path's scope query already excludes packeted meetings; the event path
    // has no scope query of its own, so this is its own guarantee.
    const { data: existingPacket } = await this.supabase
      .from("board_meeting_packets")
      .select("id")
      .eq("meeting_id", meeting.id)
      .maybeSingle();
    if (existingPacket) {
      return { written: false, tokensUsed: 0, sectionsWithRealData: 0, sectionsFallback: 0 };
    }

    const { data: orgRow } = await this.supabase
      .from("organizations")
      .select("id, name, annual_budget, total_staff, total_volunteers")
      .eq("id", meeting.org_id)
      .maybeSingle();
    if (!orgRow) {
      throw new Error(`Organization ${meeting.org_id} not found.`);
    }
    const org = orgRow as OrgRow;

    const pipeline = await this.buildPipelineSummary();
    const outcomes = await this.buildOutcomesSummary(meeting);
    const financial = this.buildFinancialSnapshot(org);
    const { result: plainLanguageFinancials, tokensUsed: financialTokensUsed } =
      await this.generatePlainLanguageFinancials();

    const { items, tokensUsed: discussionTokensUsed, degraded } = await this.generateDiscussionItems(
      meeting,
      pipeline,
      outcomes,
      financial,
    );
    const tokensUsed = financialTokensUsed + discussionTokensUsed;

    const sectionsWithRealData = [
      pipeline.count > 0,
      outcomes.count > 0,
      financial.annualBudget != null,
      plainLanguageFinancials.hasAnyData,
    ].filter(Boolean).length;
    const sectionsFallback = 4 - sectionsWithRealData;

    const packetContent: Record<string, unknown> = {
      agenda: meeting.agenda,
      pipelineSummary: {
        count: pipeline.count,
        opportunities: pipeline.opportunities,
        ...(pipeline.note ? { note: pipeline.note } : {}),
      },
      outcomesSinceLastMeeting: {
        sinceDate: outcomes.sinceDate,
        isFirstMeeting: outcomes.isFirstMeeting,
        count: outcomes.count,
        awarded: outcomes.awarded,
        denied: outcomes.denied,
        partial: outcomes.partial,
        totalAwardedAmount: outcomes.totalAwardedAmount,
        note: outcomes.note,
      },
      financialSnapshot: financial,
      // FEATURE_REGISTRY_v2.md row #139 — the deeper narrative
      // financialSnapshot deliberately doesn't attempt (see file header).
      plainLanguageFinancials,
      recommendedDiscussionItems: items,
      generatedFor: meeting.meeting_date,
    };
    if (degraded) {
      packetContent.narrativeUnavailable =
        "Discussion-item synthesis unavailable this run (Claude call failed after 3 attempts).";
    }

    const { error: insertError } = await this.supabase
      .from("board_meeting_packets")
      .insert({
        org_id: meeting.org_id,
        meeting_id: meeting.id,
        packet_content: packetContent,
        viewed_by: [],
      });

    if (insertError) {
      // 23505 = unique_violation — the UNIQUE(meeting_id) constraint caught
      // a race between the schedule and event triggers (or two concurrent
      // worker ticks). Per the spec's Idempotency section this is a
      // legitimate no-op, not a failure.
      if (insertError.code === "23505") {
        return {
          written: false,
          tokensUsed,
          sectionsWithRealData,
          sectionsFallback,
        };
      }
      throw new Error(`Failed to write board_meeting_packets: ${insertError.message}`);
    }

    const decisionId = await this.logDecision({
      decisionType: "board_packet_generated",
      agentRunId: runId,
      entityType: "board_meeting",
      entityId: meeting.id,
      reasoning:
        `Generated a board packet for the ${meeting.meeting_type} meeting on ${meeting.meeting_date}. ` +
        `${sectionsWithRealData}/4 sections had real data (${sectionsFallback}/4 used an explicit ` +
        `"nothing to report" fallback).` +
        (degraded
          ? " Discussion-item synthesis was unavailable this run (Claude call failed after 3 attempts) " +
            "— the deterministic sections were still written."
          : ` ${items.length} discussion item(s) were generated, each grounded in a specific fact.`),
      confidenceScore: degraded ? 50 : 90,
      actionTaken: "generated_board_packet",
      actionPayload: { sectionsWithRealData, sectionsFallback, itemCount: items.length },
    });

    await this.createNotification(
      "board_packet_ready",
      "Board packet ready",
      `Board packet ready for the ${meeting.meeting_date} ${meeting.meeting_type} meeting.`,
    );

    return { written: true, decisionId, tokensUsed, sectionsWithRealData, sectionsFallback };
  }

  override async run(
    triggerSource: TriggerSource,
    meetingIds?: string[],
  ): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(
      triggerSource,
      meetingIds ? { meetingIds } : undefined,
    );
    const errors: string[] = [];
    const decisions: string[] = [];

    try {
      const meetings = await this.resolveMeetings(triggerSource, meetingIds);

      if (meetings.length === 0) {
        await this.completeRun(runId, {
          outputSummary: "No board meetings in scope for this run.",
          itemsFound: 0,
          itemsProcessed: 0,
          itemsQueued: 0,
        });
        return {
          success: true,
          itemsFound: 0,
          itemsProcessed: 0,
          itemsQueued: 0,
          decisions,
          nextActions: [],
          errors,
        };
      }

      let packetsWritten = 0;
      let totalTokens = 0;
      let sectionsWithRealDataTotal = 0;
      let sectionsFallbackTotal = 0;

      // Step 7: each meeting's steps 2-6 run inside its own try/catch — one
      // meeting's bad data never blocks another's packet in the same run.
      for (const meeting of meetings) {
        try {
          const result = await this.processOneMeeting(runId, meeting);
          if (result.written) {
            packetsWritten++;
            if (result.decisionId) decisions.push(result.decisionId);
          }
          totalTokens += result.tokensUsed;
          sectionsWithRealDataTotal += result.sectionsWithRealData;
          sectionsFallbackTotal += result.sectionsFallback;
        } catch (err) {
          errors.push(`Meeting ${meeting.id}: ${errMsg(err)}`);
        }
      }

      await this.completeRun(runId, {
        outputSummary: `${packetsWritten}/${meetings.length} board packet(s) written.`,
        itemsFound: meetings.length,
        itemsProcessed: packetsWritten,
        itemsQueued: 0,
        tokensUsed: totalTokens,
        outputPayload: {
          meetingIds: meetings.map((m) => m.id),
          packetsWritten,
          sectionsWithRealData: sectionsWithRealDataTotal,
          sectionsFallback: sectionsFallbackTotal,
          errors,
        },
      });

      return {
        success: true,
        itemsFound: meetings.length,
        itemsProcessed: packetsWritten,
        itemsQueued: 0,
        decisions,
        nextActions: [],
        errors,
      };
    } catch (err) {
      const message = errMsg(err) || "Board packet generation failed.";
      await this.failRun(runId, message);
      return {
        success: false,
        itemsFound: 0,
        itemsProcessed: 0,
        itemsQueued: 0,
        decisions,
        nextActions: [],
        errors: [...errors, message],
      };
    }
  }
}
