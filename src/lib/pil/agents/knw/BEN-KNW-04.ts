import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import { getPilClient } from "@/lib/pil/db";
import { getEvidence } from "@/lib/pil/evidence";
import { createReviewItem } from "@/lib/pil/human-review";
import { logAction } from "@/lib/pil/audit";
import { nameSimilarity } from "@/lib/pil/agents/knw/BEN-KNW-02";
import { VERIFICATION_WEIGHT } from "@/lib/pil/agents/knw/BEN-KNW-03";
import { CLAIM_TYPES_BY_DIMENSION } from "@/lib/pil/agents/qlf/BEN-QLF-04";
import type { ContradictionResolutionStatus, EvidenceContradiction, EvidenceFreshnessStatus, EvidenceItem } from "@/lib/pil/types";
import { pilBlendedTokenRateUsd, PIL_AGENT_MODEL } from "@/lib/pil/model-pricing";

// BEN-KNW-04 -- Contradiction and Freshness Investigator
// (PROSPECT_INTELLIGENCE_AGENTS.md, FAMILY 7 -- KNOWLEDGE INTEGRITY;
// pil_agent_registry.mission): "Detect conflicting or outdated prospect
// information and determine what should remain canonical."
//
// This closes out Knowledge Integrity at 4/4 implemented and retires the
// graceful-NotImplementedAgent fallback BEN-KNW-01.ts's own header comment
// has documented as this agent_id's interim behavior since it was built.
//
// Division of labor with BEN-KNW-03 (important -- do not re-derive):
// BEN-KNW-03 (Evidence & Provenance Verification) already does contradiction
// *detection* -- same claim_type/entity, divergent values -- via
// evidence.ts's detectContradiction()/recordContradiction(), which writes
// 'open' rows into pil_contradictions (migration 153). This agent's real job
// per its mission ("determine what should remain canonical") is to
// *investigate and resolve* those already-open rows, not to re-scan
// pil_evidence for divergent values a second time. Contradiction resolution
// below therefore starts from `pil_contradictions WHERE resolution_status =
// 'open'`, never from a fresh pairwise scan of pil_evidence.
//
// Two responsibilities, dual mode like this codebase's other batch-capable
// PIL agents:
//   (1) Contradiction resolution -- context.prospectId set: resolves that
//       prospect's open rows only. context.prospectId null: org-wide
//       periodic batch sweep, resolves every open row for context.orgId.
//   (2) Claim-type-scoped staleness sweep -- a second, independent notion of
//       "outdated" from BEN-KNW-03's own per-source_type TTL sweep (which
//       writes pil_evidence.freshness_status). This one asks "how fast does
//       this KIND of fact change" (a job title vs. a college degree),
//       regardless of which source produced it, and never writes
//       freshness_status -- that column is BEN-KNW-03's write surface;
//       having two agents write competing semantics to the same column
//       would make it meaningless. Results surface only in this agent's own
//       report (claimTypeStaleFlagged).
//
// Delegation wiring (PIL_AGENT_DEPENDENCIES.yaml: depends_on [BEN-KNW-02,
// BEN-KNW-03, BEN-SUP-05, BEN-SUP-06]; feeds [BEN-KNW-01, BEN-KNW-02,
// BEN-QLF-05]):
//   - BEN-KNW-02 (Entity Resolution): fired when a processed contradiction's
//     claim_type is identity-adjacent (employment/board_membership/
//     biography) and the two evidence rows' values name radically different
//     entities -- a possible mis-attribution (evidence about two different
//     people/orgs got attached to the same prospect) rather than a genuine
//     fact conflict, which needs identity re-verification, not a value
//     pick. This is the confirmed BEN-KNW-02<->BEN-KNW-04 mutual-delegation
//     cycle (BEN-KNW-02 already delegates here on every auto-merge, see that
//     file's header) -- AgentRunner's own context.depth<=0 => 'escalated'
//     backstop (agent-runner.ts) is the sole guard, no new cycle-guard code
//     is added here.
//   - BEN-SUP-05 (critic): fired alongside (never instead of) the
//     createReviewItem() call below, on every tier-impacting
//     canonical-designation change -- the established pattern of pairing an
//     independent critic delegation with a human-review item for the same
//     high-impact event (see BEN-QLF-04.ts's own Tier 1/2 delegation).
//   - BEN-SUP-06 (Research Recovery Investigator): the one deliberate
//     exception to the KNW-family convention of never delegating to SUP-06 --
//     fired when a single batch-sweep run finds more than 25 open
//     contradictions for one organization, since that volume looks less like
//     isolated per-prospect discrepancies and more like a systemic
//     data-quality/ingestion-failure anomaly worth SUP-06's own recovery
//     investigation.
//   Forward-delegating to siblings before they're necessarily registered in
//   AGENT_FACTORIES is safe: unregistered agent_ids resolve gracefully to
//   NotImplementedAgent (agents/index.ts).
//
// Schema/scope notes:
//   - Evidence rows referenced by an open contradiction are loaded via a
//     direct `client.from('pil_evidence').select('*').in('id', [...])`
//     query, NOT evidence.ts's getEvidence() -- getEvidence() takes a
//     prospectId and returns *all* of that prospect's evidence, which is
//     both the wrong shape (this needs exactly two specific rows by id) and,
//     in org-wide batch mode, not scoped to a single prospect at all.
//   - The org-wide staleness sweep (context.prospectId === null) similarly
//     cannot use getEvidence() (it requires a prospectId) -- it duplicates
//     that helper's own `entity_table = 'pil_prospects'` filter directly,
//     scoped to organization_id instead of a single entity_id.
//   - No AutoApply/PortalSemanticDriftDetected event handling is implemented
//     here. PROSPECT_INTELLIGENCE_AGENTS.md's AutoApply extension section
//     describes this agent eventually consuming a PortalSemanticDriftDetected
//     event from a PIL-SVC-41 service, but no BEN-APP-0N agents, PIL-SVC-3x
//     service registry, or that event type exist anywhere in this codebase's
//     src/ tree today (only in PIL_SPEC_WORKING_DIR planning docs) -- that
//     layer is out of scope until it actually lands.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Margin a canonicalWeight side must exceed the other by before this agent
// commits to a winner, rather than admitting a close call it can't
// confidently resolve.
const CANONICAL_WEIGHT_MARGIN = 0.1;
// Below this, a side's evidence is weak enough (poorly verified, low
// confidence, and/or stale) that even "winning" the comparison isn't a
// meaningful canonical designation -- both sides this low means neither is
// trustworthy, not that one beat the other.
const BOTH_STALE_WEIGHT_THRESHOLD = 0.35;
// More open contradictions resolved/found in one batch-sweep run for a
// single org than this looks like a systemic data-quality or ingestion
// problem, not isolated per-prospect discrepancies -- triggers the one
// deliberate BEN-SUP-06 exception documented in the header comment above.
const BATCH_SWEEP_ANOMALY_THRESHOLD = 25;
// token-overlap nameSimilarity() (BEN-KNW-02) below this is treated as
// "radically different" for the identity-adjacent mis-attribution check --
// two employer/org names sharing no meaningful tokens, not just minor
// spelling or formatting variance.
const IDENTITY_MISMATCH_SIMILARITY_THRESHOLD = 0.2;

const FRESHNESS_MULTIPLIER: Record<EvidenceFreshnessStatus, number> = {
  fresh: 1,
  aging: 0.7,
  stale: 0.4,
};

// Per-claim_type staleness windows (days) -- deliberately distinct from
// BEN-KNW-03's own per-source_type TTL_HOURS_BY_SOURCE_TYPE sweep, which
// asks "how long is this kind of *source* trustworthy" and writes
// pil_evidence.freshness_status. This table asks a different question --
// "how fast does this KIND of real-world fact actually change" -- regardless
// of which source produced it, and is never written back to freshness_status
// (see the "claim-type-scoped staleness sweep" header note above for why
// that would create two competing writers with different semantics).
const CLAIM_TYPE_STALENESS_DAYS: Record<string, number> = {
  // A person's job changes on the order of a few years at most; 180 days
  // (~6 months) is conservative enough to catch a mid-tenure move without
  // constantly re-flagging a genuinely still-current role.
  employment: 180,
  // Board seats rotate on a similar cadence to job changes (annual/biennial
  // terms, turnover throughout the year) -- same window as employment.
  board_membership: 180,
  // Wealth and giving signals move on a slower, roughly-annual cadence --
  // filings, disclosures, and major-gift announcements are dated events, not
  // continuously updated -- so a full year is the trust window before
  // re-verification.
  wealth_capacity: 365,
  capacity_signal: 365,
  giving_history: 365,
  documented_major_gift: 365,
  // A degree, once earned, does not become less true. 3650 days (10 years)
  // is a functionally-permanent window rather than a literal "never," so an
  // extremely stale record can still eventually surface for a sanity check.
  education: 3650,
};
// Any claim_type not explicitly listed above defaults to the same
// roughly-annual window as the wealth/giving claim types -- a reasonable
// middle ground between employment's fast-moving window and education's
// near-permanence for claim types this sweep has no specific domain
// knowledge about.
const DEFAULT_CLAIM_TYPE_STALENESS_DAYS = 365;

function claimTypeStalenessWindowDays(claimType: string): number {
  return CLAIM_TYPE_STALENESS_DAYS[claimType] ?? DEFAULT_CLAIM_TYPE_STALENESS_DAYS;
}

// Union of BEN-QLF-04's own givingCapacity/philanthropicPropensity claim
// types -- imported rather than hand-typed, per the task's own instruction
// not to define a fourth independent copy of this exact vocabulary
// (wealth_capacity, capacity_signal, hidden_capacity_signal_flag,
// high_compensation_officer_signal, giving_history, documented_major_gift).
// A contradiction whose claim_type is in this set can shift a prospect's
// qualification tier if the resolution changes which value is canonical.
const TIER_IMPACTING_CLAIM_TYPES = new Set<string>([
  ...CLAIM_TYPES_BY_DIMENSION.givingCapacity,
  ...CLAIM_TYPES_BY_DIMENSION.philanthropicPropensity,
]);

// claim_types where a value disagreement is more likely to signal that two
// *different* entities' evidence got attached to the same prospect (a
// mis-attribution) than a genuine one-entity fact conflict.
const IDENTITY_ADJACENT_CLAIM_TYPES = new Set<string>(["employment", "board_membership", "biography"]);

function canonicalWeight(item: EvidenceItem): number {
  const confidence = Math.max(0, Math.min(1, item.confidence));
  return VERIFICATION_WEIGHT[item.verification_status] * confidence * FRESHNESS_MULTIPLIER[item.freshness_status];
}

// Best-effort entity-name extraction from an evidence.value jsonb blob of
// unknown shape (pil_evidence.value has no fixed schema across claim_types).
// Checks a handful of key names this codebase's own Discovery/Intelligence
// agents commonly write for employer/organization facts; falls back to a
// bare string value; returns null when nothing name-shaped is found rather
// than guessing.
function extractNameCandidate(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ["name", "entityName", "employer", "employerName", "organization", "organizationName", "company", "companyName"]) {
      const candidate = obj[key];
      if (typeof candidate === "string" && candidate.trim().length > 0) return candidate;
    }
  }
  return null;
}

export interface ContradictionFreshnessReport {
  orgId: string;
  prospectId: string | null;
  contradictionsProcessed: number;
  resolvedA: number;
  resolvedB: number;
  resolvedBothStale: number;
  unresolved: number;
  claimTypeStaleFlagged: string[];
  tierImpactingCanonicalChanges: number;
  humanReviewCreated: number;
}

export class ContradictionFreshnessInvestigatorAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    const client = getPilClient();
    const isBatchSweep = context.prospectId === null;

    const [openContradictions, evidenceForStalenessSweep] = await Promise.all([
      this.loadOpenContradictions(client, context.orgId, context.prospectId),
      context.prospectId
        ? getEvidence(context.prospectId, context.orgId)
        : this.loadEvidenceForOrg(client, context.orgId),
    ]);

    const claimTypeStaleFlagged = this.findClaimTypeStale(evidenceForStalenessSweep);

    if (context.prospectId && openContradictions.length === 0 && claimTypeStaleFlagged.length === 0) {
      return this.completed(
        {},
        `No open contradictions and no claim-type-stale evidence for prospect ${context.prospectId}`,
      );
    }

    const delegations: DelegationRequest[] = [];
    let resolvedA = 0;
    let resolvedB = 0;
    let resolvedBothStale = 0;
    let unresolved = 0;
    let tierImpactingCanonicalChanges = 0;
    let humanReviewCreated = 0;

    for (const contradiction of openContradictions) {
      const [evidenceA, evidenceB] = await this.loadEvidencePair(
        client,
        contradiction.evidence_id_a,
        contradiction.evidence_id_b,
      );
      // Defensive only -- pil_contradictions.evidence_id_a/b are NOT NULL FKs
      // into pil_evidence with no cascading delete, so both rows should
      // always resolve. Skip rather than throw if either is somehow missing,
      // so one bad row can't fail an entire batch sweep.
      if (!evidenceA || !evidenceB) continue;

      const weightA = canonicalWeight(evidenceA);
      const weightB = canonicalWeight(evidenceB);

      let resolutionStatus: ContradictionResolutionStatus;
      let resolvedValue: unknown = null;
      if (weightA - weightB > CANONICAL_WEIGHT_MARGIN) {
        resolutionStatus = "resolved_a";
        resolvedValue = evidenceA.value;
        resolvedA++;
      } else if (weightB - weightA > CANONICAL_WEIGHT_MARGIN) {
        resolutionStatus = "resolved_b";
        resolvedValue = evidenceB.value;
        resolvedB++;
      } else if (weightA < BOTH_STALE_WEIGHT_THRESHOLD && weightB < BOTH_STALE_WEIGHT_THRESHOLD) {
        resolutionStatus = "resolved_both_stale";
        resolvedBothStale++;
      } else {
        // Close call within the margin -- investigated, but no confident
        // winner. Per the CHECK constraint's own 5-way distinction,
        // 'unresolved' means "investigated, no confident winner," not "not
        // yet looked at" (that's what 'open' already means).
        resolutionStatus = "unresolved";
        unresolved++;
      }

      const { error: updateError } = await client
        .from("pil_contradictions")
        .update({
          resolution_status: resolutionStatus,
          resolved_value: resolvedValue,
          investigated_by_agent_id: context.agentCode,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", contradiction.id);
      if (updateError) throw updateError;

      // Identity-adjacent mis-attribution check -- independent of which side
      // (if any) won the canonical-weight comparison above.
      if (IDENTITY_ADJACENT_CLAIM_TYPES.has(contradiction.claim_type)) {
        const nameA = extractNameCandidate(evidenceA.value);
        const nameB = extractNameCandidate(evidenceB.value);
        if (nameA && nameB && nameSimilarity(nameA, nameB) < IDENTITY_MISMATCH_SIMILARITY_THRESHOLD) {
          delegations.push({
            childAgentCode: "BEN-KNW-02",
            objective: `BEN-KNW-04 resolved a ${contradiction.claim_type} contradiction (${resolutionStatus}) for prospect ${contradiction.prospect_id} between evidence ${evidenceA.id} ("${nameA}") and ${evidenceB.id} ("${nameB}") -- these two evidence rows name radically different entities, a possible mis-attribution rather than a genuine fact conflict. Re-verify identity before trusting either value.`,
            maxAutonomy: "A2",
            constraints: {
              prospectId: contradiction.prospect_id,
              contradictionId: contradiction.id,
              claimType: contradiction.claim_type,
              evidenceIds: [evidenceA.id, evidenceB.id],
            },
          });
        }
      }

      // Canonical-designation impact check -- only a definite winner
      // (resolved_a/resolved_b) actually changes which value is canonical;
      // resolved_both_stale/unresolved don't designate anything new.
      if (
        TIER_IMPACTING_CLAIM_TYPES.has(contradiction.claim_type) &&
        (resolutionStatus === "resolved_a" || resolutionStatus === "resolved_b")
      ) {
        tierImpactingCanonicalChanges++;
        const winner = resolutionStatus === "resolved_a" ? evidenceA : evidenceB;
        const loser = resolutionStatus === "resolved_a" ? evidenceB : evidenceA;

        await createReviewItem({
          organization_id: context.orgId,
          review_type: "high_impact_action",
          subject_type: "pil_contradictions",
          subject_id: contradiction.id,
          requested_by_agent_id: context.agentCode,
          priority: "high",
          status: "pending",
          summary: `BEN-KNW-04 resolved a tier-impacting ${contradiction.claim_type} contradiction for prospect ${contradiction.prospect_id}: new canonical value from evidence ${winner.id} (${JSON.stringify(winner.value)}) supersedes evidence ${loser.id} (${JSON.stringify(loser.value)}). This could shift the prospect's qualification tier.`,
          evidence_refs: [evidenceA.id, evidenceB.id],
          assigned_to_user_id: null,
          resolved_at: null,
        });
        humanReviewCreated++;

        // Fires alongside (not instead of) the createReviewItem() call
        // above -- pairing an independent critic delegation with a
        // human-review item for the same high-impact event, matching
        // BEN-QLF-04's own Tier 1/2 pattern.
        delegations.push({
          childAgentCode: "BEN-SUP-05",
          objective: `Critic review requested: BEN-KNW-04 resolved a tier-impacting contradiction (${contradiction.claim_type}) for prospect ${contradiction.prospect_id} to ${resolutionStatus}, changing the canonical value -- may shift qualification tier.`,
          maxAutonomy: "A2",
          constraints: {
            prospectId: contradiction.prospect_id,
            contradictionId: contradiction.id,
            claimType: contradiction.claim_type,
            resolutionStatus,
          },
        });
      }
    }

    // The one deliberate KNW-family exception to never delegating to
    // BEN-SUP-06 -- see header comment.
    if (isBatchSweep && openContradictions.length > BATCH_SWEEP_ANOMALY_THRESHOLD) {
      delegations.push({
        childAgentCode: "BEN-SUP-06",
        objective: `BEN-KNW-04's periodic batch sweep found ${openContradictions.length} open contradictions for organization ${context.orgId} in a single run -- more than the ${BATCH_SWEEP_ANOMALY_THRESHOLD}-item threshold, a possible systemic data-quality/ingestion-failure anomaly rather than isolated per-prospect discrepancies.`,
        maxAutonomy: "A2",
        constraints: { orgId: context.orgId, openContradictionsCount: openContradictions.length },
      });
    }

    const report: ContradictionFreshnessReport = {
      orgId: context.orgId,
      prospectId: context.prospectId,
      contradictionsProcessed: openContradictions.length,
      resolvedA,
      resolvedB,
      resolvedBothStale,
      unresolved,
      claimTypeStaleFlagged,
      tierImpactingCanonicalChanges,
      humanReviewCreated,
    };

    await logAction({
      organization_id: context.orgId,
      actor_type: "agent",
      actor_id: context.agentCode,
      action: "contradiction_investigation.completed",
      resource_type: "pil_contradictions",
      resource_id: context.prospectId ?? context.orgId,
      before_state: null,
      after_state: { report },
      policy_decision: null,
      ip_address: null,
    });

    const tokensUsed = await this.tryModelTokens(context, runner, 150);

    return {
      status: "completed",
      evidence: [],
      conclusions: { report },
      delegations,
      tokensUsed,
      costUsd: 0, // AR-10.1: real cost already recorded per-call in ai_usage_log by useTool()/T-MODEL via model-pricing.ts; recording it again here would double-count the same tokens.
      error: null,
    };
  }

  private findClaimTypeStale(evidence: EvidenceItem[]): string[] {
    const now = Date.now();
    const flagged: string[] = [];
    for (const item of evidence) {
      const windowDays = claimTypeStalenessWindowDays(item.claim_type);
      const ageDays = (now - Date.parse(item.retrieved_at)) / MS_PER_DAY;
      if (ageDays > windowDays) flagged.push(item.id);
    }
    return flagged;
  }

  private async loadOpenContradictions(
    client: ReturnType<typeof getPilClient>,
    orgId: string,
    prospectId: string | null,
  ): Promise<EvidenceContradiction[]> {
    let query = client.from("pil_contradictions").select("*").eq("organization_id", orgId).eq("resolution_status", "open");
    if (prospectId) {
      query = query.eq("prospect_id", prospectId);
    }
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as EvidenceContradiction[];
  }

  // Direct lookup by specific evidence ids -- NOT evidence.ts's getEvidence(),
  // which takes a prospectId and returns all of that prospect's evidence
  // rather than looking up two specific rows by id (see header comment).
  private async loadEvidencePair(
    client: ReturnType<typeof getPilClient>,
    evidenceIdA: string,
    evidenceIdB: string,
  ): Promise<[EvidenceItem | null, EvidenceItem | null]> {
    const { data, error } = await client.from("pil_evidence").select("*").in("id", [evidenceIdA, evidenceIdB]);
    if (error) throw error;
    const rows = (data ?? []) as EvidenceItem[];
    return [rows.find((r) => r.id === evidenceIdA) ?? null, rows.find((r) => r.id === evidenceIdB) ?? null];
  }

  // Org-wide staleness-sweep evidence load -- getEvidence() (evidence.ts)
  // requires a specific prospectId, so the periodic batch sweep duplicates
  // its own entity_table filter directly, scoped to the whole organization
  // instead of one entity_id.
  private async loadEvidenceForOrg(client: ReturnType<typeof getPilClient>, orgId: string): Promise<EvidenceItem[]> {
    const { data, error } = await client
      .from("pil_evidence")
      .select("*")
      .eq("organization_id", orgId)
      .eq("entity_table", "pil_prospects");
    if (error) throw error;
    return (data ?? []) as EvidenceItem[];
  }

  private async tryModelTokens(context: AgentContext, runner: AgentRunner, units: number): Promise<number> {
    if (!context.tools.includes("T-MODEL")) return 0;
    try {
      const rate = await pilBlendedTokenRateUsd();
      await runner.useTool(context, "T-MODEL", { unitCost: rate, units, costType: "model_tokens", model: PIL_AGENT_MODEL });
      return units;
    } catch {
      return 0;
    }
  }

  private completed(conclusions: Record<string, unknown>, reason: string): AgentResult {
    return {
      status: "completed",
      evidence: [],
      conclusions: { skipped: true, reason, ...conclusions },
      delegations: [],
      tokensUsed: 0,
      costUsd: 0,
      error: null,
    };
  }
}

export default ContradictionFreshnessInvestigatorAgent;
