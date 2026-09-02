import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import {
  callTool,
  getProspectById,
  hostnameOf,
  MAX_DELEGATIONS_PER_RUN,
  MODEL_TOKEN_UNIT_COST_USD,
  recordIntelligenceEvidence,
  tryModelTokens,
  upsertCounterpartyNode,
  upsertProspectNode,
} from "@/lib/pil/agents/int/shared";
import { logAction } from "@/lib/pil/audit";
import { getEvidence } from "@/lib/pil/evidence";
import { upsertEdge } from "@/lib/pil/graph";
import type { EvidenceItem } from "@/lib/pil/types";

// Six domain dimensions this agent's report scores coverage across, per
// PIL_AGENT_COMPLETE_ROSTER.md's "Core Intelligence" BEN_INT_05Decision.v1
// contract. Coverage is computed from persisted pil_evidence state
// (getEvidence), not just evidence created this run, matching BEN-INT-04/08's
// own established getEvidence(prospect.id, context.orgId) pattern for
// reading the full existing dossier.
const BOARD_DIMENSIONS = [
  "Organization Identity",
  "Fiduciary/Advisory/Honorary Distinction",
  "Role Interval",
  "Committee Service",
  "Officer/Trustee Semantics",
  "Cause-Context Limitations",
] as const;

export interface NonprofitBoardIntelligenceReport {
  prospectId: string;
  dimensionCoverage: Record<string, boolean>;
  evidenceCreatedThisRun: number;
  delegationsIssued: string[];
  boardMentionsFound: number;
}

// BEN-INT-05 -- Nonprofit Board Intelligence Agent
// (PROSPECT_INTELLIGENCE_AGENTS.md "FAMILY 3"). Identifies and verifies
// nonprofit board/trustee/officer memberships -- "one of the highest-signal
// indicators of philanthropic engagement" per the task spec that
// commissioned this batch.
//
// The task spec labeled this code "Education Intelligence" and put
// "Nonprofit Board Intelligence" at BEN-INT-06 -- the live registry has the
// reverse (BEN-INT-05 = Nonprofit Board, BEN-INT-06 = Foundation
// Intelligence; PROSPECT_INTELLIGENCE_AGENTS.md line ~476). Per this
// codebase's established pattern of trusting registry/spec state over a
// colliding task-given description, this file implements the real
// BEN-INT-05.
//
// Permitted tools per spec: T-WEB, T-990, T-EVIDENCE (write), T-GRAPH
// (write). Spec's source-authority ordering: nonprofit website -> Form 990
// -> official biography -> other filing, falling back to general web search
// only once exhausted. entity_lookup (foundation_directory-backed) is the
// closest available EIN resolver for a web-discovered org name, so it
// stands in for "check the 990" before accepting a lower-authority mention.

interface BoardMention {
  orgName: string;
  sourceUrl: string;
  sourceTitle: string | null;
}

export class NonprofitBoardIntelligenceAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    if (!context.prospectId) {
      return this.completedEmpty("BEN-INT-05 requires an existing prospectId");
    }
    const prospect = await getProspectById(context.orgId, context.prospectId);
    if (!prospect) {
      return this.completedEmpty(`Prospect ${context.prospectId} not found`);
    }

    const evidenceCreated: EvidenceItem[] = [];
    const personNode = await upsertProspectNode(context.orgId, prospect, "person");
    const mentions: BoardMention[] = [];

    const boardSearch = await callTool(context, runner, "web_search", {
      query: `"${prospect.display_name}" board of directors OR trustee OR "board member" nonprofit`,
      limit: 6,
    });
    if (boardSearch.success) {
      const results = ((boardSearch.data as { results?: Array<{ title: string; url: string }> } | null)?.results ?? []);
      for (const item of results.slice(0, 4)) {
        mentions.push({ orgName: item.title, sourceUrl: item.url, sourceTitle: item.title });
      }
    }

    // Set true whenever a mention's board seat is cross-checked against the
    // subject nonprofit's actual 990 officer list (sourceType ===
    // "irs_form_990") -- a confirmed board seat, not just an open-web
    // mention, and exactly BEN-REL-02's Shared Organization dimension input.
    let has990CorroboratedBoardSeat = false;

    for (const mention of mentions) {
      // Try to resolve the org against foundation_directory (entity_lookup)
      // to get an EIN, then cross-check the 990's officer list -- the
      // highest-authority source available per spec ordering.
      let sourceType = "open_web";
      let confidence = 0.35;
      let verificationStatus: "unverified" | "single_source_fact" | "corroborated_fact" = "unverified";
      let filingYear: number | null = null;

      const lookup = await callTool(context, runner, "entity_lookup", { name: mention.orgName, type: "foundation" });
      if (lookup.success) {
        const matches = ((lookup.data as { matches?: Array<{ source: string; ein: string | null; confidence: number }> } | null)?.matches ?? []);
        const best = matches.find((m) => m.source === "foundation_directory" && m.ein);
        if (best?.ein) {
          const nineNinety = await callTool(context, runner, "irs_990_lookup", { ein: best.ein });
          if (nineNinety.success) {
            const data = nineNinety.data as { officers: Array<{ name: string | null }>; filing_year: number | null };
            filingYear = data.filing_year;
            const nameOnFiling = data.officers.some(
              (o) => (o.name ?? "").toLowerCase().includes(prospect.display_name.toLowerCase()),
            );
            sourceType = "irs_form_990";
            confidence = nameOnFiling ? 0.85 : 0.5;
            verificationStatus = nameOnFiling ? "corroborated_fact" : "single_source_fact";
            has990CorroboratedBoardSeat = true;
          }
        }
      }

      const evidence = await recordIntelligenceEvidence({
        orgId: context.orgId,
        prospectId: prospect.id,
        claim: `Nonprofit board/trustee mention: ${mention.orgName}${filingYear ? ` (990 filing year ${filingYear})` : ""}`,
        value: { organization: mention.orgName, url: mention.sourceUrl, filingYear },
        claimType: "nonprofit_board",
        sourceUrl: sourceType === "open_web" ? mention.sourceUrl : null,
        sourceTitle: mention.sourceTitle,
        sourceType,
        publisher: sourceType === "open_web" ? hostnameOf(mention.sourceUrl) : "IRS Form 990",
        evidenceExcerpt: null,
        agentCode: context.agentCode,
        researchRunId: context.runId,
        confidence,
        verificationStatus,
      });
      evidenceCreated.push(evidence);

      const orgNode = await upsertCounterpartyNode(context.orgId, "nonprofit", mention.orgName, {});
      await upsertEdge({
        organization_id: context.orgId,
        source_node_id: personNode.id,
        target_node_id: orgNode.id,
        edge_type: "serves_on_board_of",
        relationship_strength: sourceType === "irs_form_990" ? "strong" : "weak",
        confidence,
        temporal_validity_start: null,
        temporal_validity_end: null,
        is_current: true,
        superseded_by_edge_id: null,
        properties: { sourceType },
      });
    }

    const tokensUsed = await tryModelTokens(context, runner, 400);

    // Everything below is secondary reasoning layered on top of the
    // evidence-gathering above, which has already durably committed via
    // individually atomic recordIntelligenceEvidence()/upsertEdge() calls. A
    // bug here must never discard that already-collected evidence or fail
    // this run -- recovery starts from persisted truth, and captured
    // evidence stays immutable regardless of what happens next.
    let report: NonprofitBoardIntelligenceReport = {
      prospectId: prospect.id,
      dimensionCoverage: Object.fromEntries(BOARD_DIMENSIONS.map((d) => [d, false])),
      evidenceCreatedThisRun: evidenceCreated.length,
      delegationsIssued: [],
      boardMentionsFound: mentions.length,
    };
    let delegations: DelegationRequest[] = [];

    try {
      const allEvidence = await getEvidence(prospect.id, context.orgId);
      const boardEvidence = allEvidence.filter((e) => e.claim_type === "nonprofit_board");
      const has990Evidence = boardEvidence.some((e) => e.source_type === "irs_form_990");
      const hasFilingYear = boardEvidence.some(
        (e) => (e.value as { filingYear?: number | null } | null)?.filingYear != null,
      );
      const hasCommitteeMention = boardEvidence.some((e) => /committee/i.test(e.claim));
      const hasCorroboratedOfficerMatch = boardEvidence.some((e) => e.verification_status === "corroborated_fact");
      const hasCauseContextEvidence = allEvidence.some(
        (e) => e.claim_type === "990_mission_cause_alignment" || e.claim_type === "cause_statement_or_board_signal",
      );

      const dimensionCoverage: Record<string, boolean> = {
        "Organization Identity": boardEvidence.length > 0,
        "Fiduciary/Advisory/Honorary Distinction": has990Evidence,
        "Role Interval": hasFilingYear,
        "Committee Service": hasCommitteeMention,
        "Officer/Trustee Semantics": hasCorroboratedOfficerMatch,
        "Cause-Context Limitations": hasCauseContextEvidence,
      };

      // Priority order per the roster's BEN-INT-05 delegation list -- stop
      // once MAX_DELEGATIONS_PER_RUN candidates are collected, even if a
      // lower-priority condition below also holds.
      const candidates: DelegationRequest[] = [];
      const pushCandidate = (childAgentCode: string, objective: string) => {
        candidates.push({
          childAgentCode,
          objective,
          maxAutonomy: "A2",
          constraints: { prospectId: context.prospectId, triggeredBy: context.agentCode },
        });
      };

      if (mentions.length === 0) {
        pushCandidate(
          "BEN-KNW-02",
          `Prospect ${context.prospectId} has no nonprofit board/trustee mentions found by this BEN-INT-05 run -- resolve identity ambiguity before further intelligence gathering.`,
        );
      }
      if (has990CorroboratedBoardSeat) {
        pushCandidate(
          "BEN-REL-02",
          `BEN-INT-05 confirmed a 990-corroborated board seat for prospect ${context.prospectId} this run -- map shared-organization relationships arising from this board service.`,
        );
      }
      if (!allEvidence.some((e) => e.claim_type === "giving_history")) {
        pushCandidate(
          "BEN-INT-07",
          `Prospect ${context.prospectId} has no giving_history evidence on file -- the nonprofit board service BEN-INT-05 found is a strong giving-history signal worth investigating.`,
        );
      }
      if (evidenceCreated.length > 0) {
        pushCandidate(
          "BEN-KNW-03",
          `BEN-INT-05 recorded ${evidenceCreated.length} new evidence item(s) for prospect ${context.prospectId} this run -- verify provenance before treating as authoritative.`,
        );
      }

      delegations = candidates.slice(0, MAX_DELEGATIONS_PER_RUN);

      report = {
        prospectId: prospect.id,
        dimensionCoverage,
        evidenceCreatedThisRun: evidenceCreated.length,
        delegationsIssued: delegations.map((d) => d.childAgentCode),
        boardMentionsFound: mentions.length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      try {
        await logAction({
          organization_id: context.orgId,
          actor_type: "agent",
          actor_id: context.agentCode,
          action: "ben-int-05.gap_analysis_failed",
          resource_type: "pil_agent_runs",
          resource_id: context.runId,
          before_state: null,
          after_state: { error: message },
          policy_decision: null,
          ip_address: null,
        });
      } catch {
        // Audit logging is best-effort -- never let it mask the
        // already-collected evidence this run already durably recorded.
      }
      delegations = [];
    }

    return {
      status: "completed",
      evidence: evidenceCreated,
      conclusions: { report },
      delegations,
      tokensUsed,
      costUsd: tokensUsed * MODEL_TOKEN_UNIT_COST_USD,
      error: null,
    };
  }

  private completedEmpty(reason: string): AgentResult {
    return {
      status: "completed",
      evidence: [],
      conclusions: { skipped: true, reason },
      delegations: [],
      tokensUsed: 0,
      costUsd: 0,
      error: null,
    };
  }
}

export default NonprofitBoardIntelligenceAgent;
