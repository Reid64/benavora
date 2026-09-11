// Funder Relationship Agent - AGENTS.md Agent 23.
//
// CONSOLIDATED onto the canonical event-sourced formula in
// src/lib/intelligence/relationship-scorer.ts (see BEHAVIORAL_CONTRACTS.md's
// "Relationship Scoring" contract). This agent used to run its own
// decay-based delta model entirely independent of that scorer, which meant
// the same funder could show a different relationship score on the Funders
// list/detail pages (this agent's write) than on the funder's dedicated
// relationship tab (src/app/api/funders/[id]/relationship, which has always
// called the canonical scorer directly). Every call now: (1) records the
// interaction as a row in funder_relationship_events, mapped onto that
// table's fixed 6-value vocabulary (EVENT_TO_CANONICAL_TYPE below — 'award'/
// 'application'/'response'/'outreach'/'meeting'/'rejection', per migration
// 091's CHECK constraint), then (2) calls computeRelationshipScore() to get
// the same score/momentum every other reader of that funder's relationship
// data sees. `note_added` has no canonical equivalent (it carries no
// relationship signal) and is intentionally not logged as an event — it
// still updates this table's own bookkeeping columns (recent_events/
// total_interactions) but never touches the score.
//
// Results are written to funder_relationship_scores under BOTH of that
// table's live column families (see migration 139's header comment: the
// table was extended twice, live, with two never-reconciled column sets --
// relationship_score/trend/recent_events/is_stale/total_interactions/
// successful_applications/last_interaction_at, read by the Funders UI, and
// score/events/last_updated_at, written by RelationshipBuilderAgent/AG-19).
// Writing the identical canonical value into both eliminates the case where
// the two agents' rows disagree for the same funder.

import {
  AgentError,
  BaseAgent,
  type AgentExecution,
} from "@/lib/agents/base-agent";
import {
  computeRelationshipScore,
  type FunderRelationshipEventType,
  type RelationshipMomentum,
} from "@/lib/intelligence/relationship-scorer";
import type { AgentType } from "@/types/agents";

// --- event catalogue ---------------------------------------------------------

export type FunderRelationshipEvent =
  | "cold_outreach_sent"
  | "response_received"
  | "application_submitted"
  | "awarded"
  | "denied_with_feedback"
  | "denied_no_feedback"
  | "three_plus_consecutive_denials"
  | "renewal_submitted"
  | "note_added";

/** Maps this agent's 9-value event vocabulary onto the canonical scorer's
 * fixed 6-value funder_relationship_events.event_type CHECK constraint.
 * `null` means "record the interaction for bookkeeping only, no scored
 * event" — there is no canonical equivalent for a free-text note. */
const EVENT_TO_CANONICAL_TYPE: Record<
  FunderRelationshipEvent,
  FunderRelationshipEventType | null
> = {
  cold_outreach_sent: "outreach",
  response_received: "response",
  application_submitted: "application",
  awarded: "award",
  denied_with_feedback: "rejection",
  denied_no_feedback: "rejection",
  three_plus_consecutive_denials: "rejection",
  renewal_submitted: "application",
  note_added: null,
};

/** Maps the canonical scorer's rising/stable/declining onto this table's
 * existing rising/falling/neutral trend vocabulary — same mapping
 * RelationshipBuilderAgent uses for the same reason (see its
 * momentumToTrend). */
function momentumToTrend(momentum: RelationshipMomentum): FunderRelationshipResult["trend"] {
  if (momentum === "rising") return "rising";
  if (momentum === "declining") return "falling";
  return "neutral";
}

// --- input / result ----------------------------------------------------------

export interface FunderRelationshipInput {
  funderId: string;
  event: FunderRelationshipEvent;
}

export type RelationshipTrend = "rising" | "falling" | "neutral";

export interface FunderRelationshipResult {
  funderId: string;
  relationshipScore: number;
  trend: RelationshipTrend;
  isStale: boolean;
  eventApplied: FunderRelationshipEvent;
  previousScore: number;
}

// --- agent -------------------------------------------------------------------

const STALE_DAYS = 180;
const RECENT_EVENTS_KEEP = 10;

interface StoredEvent {
  event: string;
  canonicalEventType: FunderRelationshipEventType | null;
  at: string;
}

export class FunderRelationshipAgent extends BaseAgent<
  FunderRelationshipInput,
  FunderRelationshipResult
> {
  readonly agentType: AgentType = "funder_relationship";

  protected async execute(
    input: FunderRelationshipInput,
  ): Promise<AgentExecution<FunderRelationshipResult>> {
    const { funderId, event } = input;

    // Verify funder belongs to this org.
    const { data: funder, error: funderError } = await this.client
      .from("funders")
      .select("id")
      .eq("id", funderId)
      .eq("organization_id", this.organizationId)
      .single();

    if (funderError || !funder) {
      throw new AgentError("Funder not found.", "not_found", 404);
    }

    // Load existing row for bookkeeping fields only — the score itself no
    // longer derives from the previous row (see canonical scorer above).
    const { data: existing } = await this.client
      .from("funder_relationship_scores")
      .select(
        "relationship_score, last_interaction_at, recent_events, total_interactions, successful_applications",
      )
      .eq("funder_id", funderId)
      .eq("organization_id", this.organizationId)
      .maybeSingle();

    const previousScore = (existing?.relationship_score as number | null) ?? 0;
    const lastInteractionAt = existing?.last_interaction_at as string | null;
    const rawEvents = existing?.recent_events;
    const storedEvents: StoredEvent[] = Array.isArray(rawEvents)
      ? (rawEvents as StoredEvent[])
      : [];
    const prevInteractions = (existing?.total_interactions as number | null) ?? 0;
    const prevSuccessful = (existing?.successful_applications as number | null) ?? 0;

    const nowIso = new Date().toISOString();
    const canonicalEventType = EVENT_TO_CANONICAL_TYPE[event];

    if (canonicalEventType) {
      const { error: eventInsertError } = await this.client
        .from("funder_relationship_events")
        .insert({
          organization_id: this.organizationId,
          funder_id: funderId,
          event_type: canonicalEventType,
          event_date: nowIso,
          notes: event,
        });

      if (eventInsertError) {
        throw new AgentError(
          "Failed to record relationship event.",
          "write_failed",
        );
      }
    }

    const { score: newScore, momentum } = await computeRelationshipScore(
      funderId,
      this.organizationId,
      this.client,
    );
    const trend = momentumToTrend(momentum);

    // Update event history (rolling window) and staleness/interaction
    // bookkeeping — unaffected by which formula produced the score.
    const newEvent: StoredEvent = { event, canonicalEventType, at: nowIso };
    const updatedEvents = [...storedEvents, newEvent].slice(-RECENT_EVENTS_KEEP);
    const isStale = computeIsStale(newScore, nowIso, lastInteractionAt);

    const newInteractions = prevInteractions + 1;
    const newSuccessful = prevSuccessful + (event === "awarded" ? 1 : 0);

    const { error: upsertError } = await this.client
      .from("funder_relationship_scores")
      .upsert(
        {
          organization_id: this.organizationId,
          funder_id: funderId,
          // Canonical column family (Funders list/detail UI).
          relationship_score: newScore,
          trend,
          recent_events: updatedEvents,
          is_stale: isStale,
          total_interactions: newInteractions,
          successful_applications: newSuccessful,
          last_interaction_at: nowIso,
          updated_at: nowIso,
          // AG-19's column family — kept in sync so no reader of this table
          // can see two different scores for the same funder.
          score: newScore,
          events: { trend, momentum },
          last_updated_at: nowIso,
        },
        { onConflict: "organization_id,funder_id" },
      );

    if (upsertError) {
      throw new AgentError(
        "Failed to save relationship score.",
        "write_failed",
      );
    }

    return {
      data: {
        funderId,
        relationshipScore: newScore,
        trend,
        isStale,
        eventApplied: event,
        previousScore,
      },
      outputSummary: `Funder relationship score updated: ${previousScore} → ${newScore} (${event}, trend: ${trend}).`,
      itemsFound: 1,
      itemsProcessed: 1,
    };
  }
}

// --- helpers -----------------------------------------------------------------

/** Stale: score 0 AND no interaction in 180 days (as of the interaction this
 * call is about to record). */
function computeIsStale(
  score: number,
  nowIso: string,
  lastInteractionAt: string | null,
): boolean {
  if (score !== 0) return false;
  if (!lastInteractionAt) return false;
  const daysSince =
    (new Date(nowIso).getTime() - new Date(lastInteractionAt).getTime()) /
    86_400_000;
  return daysSince >= STALE_DAYS;
}
