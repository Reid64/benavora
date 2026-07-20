"use strict";
// Funder Relationship Agent - AGENTS.md Agent 23.
//
// Deterministic scoring — no Claude call required. Each event fires a fixed
// delta against the funder's current relationship_score. Time decay reduces
// the score by 5% for every 90 days of no interaction (floor 0). Trend is
// derived from the net of the last 3 recorded event deltas. Score is clamped
// to 0-100. Results are stored in funder_relationship_scores.
Object.defineProperty(exports, "__esModule", { value: true });
exports.FunderRelationshipAgent = void 0;
const base_agent_1 = require("@/lib/agents/base-agent");
const EVENT_DELTAS = {
    cold_outreach_sent: 5,
    response_received: 15,
    application_submitted: 10,
    awarded: 25,
    denied_with_feedback: 5,
    denied_no_feedback: -5,
    three_plus_consecutive_denials: -15,
    renewal_submitted: 10,
    note_added: 2,
};
// --- agent -------------------------------------------------------------------
const DECAY_PERIOD_DAYS = 90;
const DECAY_RATE = 0.05;
const STALE_DAYS = 180;
const RECENT_EVENTS_KEEP = 10;
const TREND_WINDOW = 3;
class FunderRelationshipAgent extends base_agent_1.BaseAgent {
    agentType = "funder_relationship";
    async execute(input) {
        const { funderId, event } = input;
        const delta = EVENT_DELTAS[event];
        // Verify funder belongs to this org.
        const { data: funder, error: funderError } = await this.client
            .from("funders")
            .select("id")
            .eq("id", funderId)
            .eq("organization_id", this.organizationId)
            .single();
        if (funderError || !funder) {
            throw new base_agent_1.AgentError("Funder not found.", "not_found", 404);
        }
        // Load existing score row (may not exist yet).
        const { data: existing } = await this.client
            .from("funder_relationship_scores")
            .select("relationship_score, last_interaction_at, recent_events, total_interactions, successful_applications")
            .eq("funder_id", funderId)
            .eq("organization_id", this.organizationId)
            .maybeSingle();
        const previousScore = existing?.relationship_score ?? 0;
        const lastInteractionAt = existing?.last_interaction_at;
        const rawEvents = existing?.recent_events;
        const storedEvents = Array.isArray(rawEvents)
            ? rawEvents
            : [];
        const prevInteractions = existing?.total_interactions ?? 0;
        const prevSuccessful = existing?.successful_applications ?? 0;
        // Apply time decay: -5% per 90 days of no interaction.
        const decayedScore = applyDecay(previousScore, lastInteractionAt);
        // Apply event delta and clamp.
        const rawNewScore = decayedScore + delta;
        const newScore = Math.max(0, Math.min(100, Math.round(rawNewScore)));
        // Update event history (rolling window).
        const nowIso = new Date().toISOString();
        const newEvent = { event, delta };
        const updatedEvents = [...storedEvents, newEvent].slice(-RECENT_EVENTS_KEEP);
        // Compute trend from last 3 events.
        const trend = computeTrend(updatedEvents);
        // Stale: score 0 AND no interaction in 180 days.
        const isStale = computeIsStale(newScore, nowIso, lastInteractionAt);
        const newInteractions = prevInteractions + 1;
        const newSuccessful = prevSuccessful + (event === "awarded" ? 1 : 0);
        const { error: upsertError } = await this.client
            .from("funder_relationship_scores")
            .upsert({
            organization_id: this.organizationId,
            funder_id: funderId,
            relationship_score: newScore,
            trend,
            recent_events: updatedEvents,
            is_stale: isStale,
            total_interactions: newInteractions,
            successful_applications: newSuccessful,
            last_interaction_at: nowIso,
            updated_at: nowIso,
        }, { onConflict: "organization_id,funder_id" });
        if (upsertError) {
            throw new base_agent_1.AgentError("Failed to save relationship score.", "write_failed");
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
exports.FunderRelationshipAgent = FunderRelationshipAgent;
// --- helpers -----------------------------------------------------------------
function applyDecay(score, lastInteractionAt) {
    if (score === 0 || !lastInteractionAt)
        return score;
    const daysSince = (Date.now() - new Date(lastInteractionAt).getTime()) / 86_400_000;
    const periods = Math.floor(daysSince / DECAY_PERIOD_DAYS);
    if (periods === 0)
        return score;
    const decayed = score * Math.pow(1 - DECAY_RATE, periods);
    return Math.max(0, decayed);
}
function computeTrend(events) {
    const window = events.slice(-TREND_WINDOW);
    if (window.length < TREND_WINDOW)
        return "neutral";
    const net = window.reduce((sum, e) => sum + e.delta, 0);
    if (net > 0)
        return "rising";
    if (net < 0)
        return "falling";
    return "neutral";
}
function computeIsStale(score, nowIso, lastInteractionAt) {
    if (score !== 0)
        return false;
    if (!lastInteractionAt)
        return false;
    const daysSince = (new Date(nowIso).getTime() - new Date(lastInteractionAt).getTime()) /
        86_400_000;
    return daysSince >= STALE_DAYS;
}
