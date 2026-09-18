// Deadline Extraction Agent - AGENTS.md Agent 03.
//
// Deterministic, NO AI. Reads an opportunity's dates and recurrence and creates
// the corresponding deadline records:
//   - the application_deadline itself (from opportunity.deadline)
//   - follow_up_date reminders 7 / 14 / 30 days before it (only those whose date
//     is still in the future, i.e. there is lead time)
//   - a reporting_deadline when the opportunity text mentions reporting
//   - a renewal_date one year out when the opportunity recurs annually
//
// It is idempotent: existing (type, due_date) pairs for the opportunity are
// skipped, so re-running never produces duplicates. Like every agent it logs to
// agent_runs via BaseAgent; tokens_used is 0 since no model is called.

import {
  AgentError,
  BaseAgent,
  withCause,
  type AgentExecution,
} from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";
import type { Enums } from "@/types/database";

type DeadlineType = Enums<"deadline_type">;

/** Days-before-deadline reminders to create (AGENTS.md Agent 03 step 3). */
const FOLLOW_UP_OFFSETS = [30, 14, 7] as const;
/** Estimated lead time from an application deadline to a reporting deadline. */
const REPORTING_OFFSET_DAYS = 90;

export interface DeadlineExtractionInput {
  opportunityId: string;
}

export interface CreatedDeadline {
  deadlineType: DeadlineType;
  dueDate: string;
  title: string;
}

export interface DeadlineExtractionResult {
  opportunityId: string;
  created: CreatedDeadline[];
  /** True when the opportunity has no deadline to extract from. */
  noDeadline: boolean;
}

export class DeadlineExtractor extends BaseAgent<
  DeadlineExtractionInput,
  DeadlineExtractionResult
> {
  readonly agentType: AgentType = "deadline_extraction";

  protected async execute(
    input: DeadlineExtractionInput,
  ): Promise<AgentExecution<DeadlineExtractionResult>> {
    const opportunityId = input.opportunityId;

    const { data: opp, error } = await this.client
      .from("opportunities")
      .select(
        "id, name, deadline, recurrence, description, eligibility_requirements",
      )
      .eq("id", opportunityId)
      .eq("organization_id", this.organizationId)
      .single();

    if (error || !opp) {
      throw new AgentError("Opportunity not found.", "not_found", 404);
    }

    const name = opp.name as string;
    const deadlineRaw = (opp.deadline as string | null) ?? null;
    const deadlineDate = deadlineRaw ? new Date(deadlineRaw) : null;

    if (!deadlineDate || Number.isNaN(deadlineDate.getTime())) {
      // Nothing to anchor deadlines to - no AI, no guessing.
      return {
        data: { opportunityId, created: [], noDeadline: true },
        outputSummary: `"${name}" has no deadline - no deadline records created.`,
        itemsFound: 0,
        itemsProcessed: 0,
        tokensUsed: 0,
      };
    }

    // Candidate deadlines, built deterministically.
    const candidates: {
      deadline_type: DeadlineType;
      due_date: string;
      title: string;
      description: string | null;
    }[] = [];

    candidates.push({
      deadline_type: "application_deadline",
      due_date: toDateOnly(deadlineDate),
      title: `Application due: ${name}`,
      description: "Application submission deadline.",
    });

    // Follow-up reminders before the deadline, only where lead time remains.
    const today = startOfToday();
    for (const offset of FOLLOW_UP_OFFSETS) {
      const date = addDays(deadlineDate, -offset);
      if (date.getTime() >= today.getTime()) {
        candidates.push({
          deadline_type: "follow_up_date",
          due_date: toDateOnly(date),
          title: `${offset}-day check: ${name}`,
          description: `Preparation checkpoint - ${offset} days before the deadline.`,
        });
      }
    }

    // Reporting deadline when the opportunity mentions reporting (estimated date).
    const text =
      `${opp.description ?? ""} ${opp.eligibility_requirements ?? ""}`.toLowerCase();
    if (/\breport(ing|s)?\b/.test(text)) {
      candidates.push({
        deadline_type: "reporting_deadline",
        due_date: toDateOnly(addDays(deadlineDate, REPORTING_OFFSET_DAYS)),
        title: `Reporting due (estimated): ${name}`,
        description:
          "Estimated reporting deadline derived from a reporting requirement in the opportunity - confirm the actual date.",
      });
    }

    // Renewal one year out for annually recurring opportunities.
    if ((opp.recurrence as string | null) === "annual") {
      candidates.push({
        deadline_type: "renewal_date",
        due_date: toDateOnly(addYears(deadlineDate, 1)),
        title: `Renewal cycle: ${name}`,
        description: "Next annual cycle of this recurring opportunity.",
      });
    }

    // Idempotency: skip any (type, due_date) that already exists for this opp.
    const { data: existingRows } = await this.client
      .from("deadlines")
      .select("deadline_type, due_date")
      .eq("opportunity_id", opportunityId)
      .eq("organization_id", this.organizationId);
    const existing = new Set(
      (existingRows ?? []).map(
        (r) => `${r.deadline_type as string}|${r.due_date as string}`,
      ),
    );

    const toInsert = candidates.filter(
      (c) => !existing.has(`${c.deadline_type}|${c.due_date}`),
    );

    if (toInsert.length > 0) {
      const { error: insertError } = await this.client.from("deadlines").insert(
        toInsert.map((c) => ({
          organization_id: this.organizationId,
          opportunity_id: opportunityId,
          deadline_type: c.deadline_type,
          due_date: c.due_date,
          title: c.title,
          description: c.description,
        })),
      );
      if (insertError) {
        throw new AgentError(
          withCause("Failed to create deadlines.", insertError),
          "write_failed",
        );
      }
    }

    const created: CreatedDeadline[] = toInsert.map((c) => ({
      deadlineType: c.deadline_type,
      dueDate: c.due_date,
      title: c.title,
    }));

    return {
      data: { opportunityId, created, noDeadline: false },
      outputSummary: `Created ${created.length} deadline(s) for "${name}".`,
      itemsFound: candidates.length,
      itemsProcessed: created.length,
      tokensUsed: 0,
    };
  }
}

// --- date helpers (UTC, to keep the date-only column stable across zones) -----

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addYears(date: Date, years: number): Date {
  const next = new Date(date);
  next.setUTCFullYear(next.getUTCFullYear() + years);
  return next;
}
