import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import {
  callTool,
  extractEntityName,
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
import { getEdges, upsertEdge } from "@/lib/pil/graph";
import type { EvidenceItem } from "@/lib/pil/types";

// BEN-INT-02 -- Employment & Career Intelligence Agent
// (PROSPECT_INTELLIGENCE_AGENTS.md "FAMILY 3"). Reconstructs the prospect's
// relevant professional history as a time-aware chronology of
// pil_graph_edges(edge_type='employed_by'), ordered current-role-first per
// spec's planning behavior (verifies highest-value data first under any
// budget cutoff).
//
// Permitted tools per spec: T-WEB, T-CRAWL, T-EDGAR, T-EVIDENCE (write),
// T-GRAPH (write). No T-EDGAR-equivalent tool is registered in
// tools/index.ts (only web_search/web_crawl/news_search/entity_lookup/
// irs_990_lookup exist) -- this agent uses web_search/web_crawl only, same
// substitution the task spec for this batch explicitly names ("Uses
// web_search and web_crawl").

// Six domain dimensions this agent's report scores coverage across, per
// PIL_AGENT_COMPLETE_ROSTER.md's "Core Intelligence" BEN_INT_02Decision.v1
// contract. Coverage is computed from persisted pil_evidence/pil_graph_edges
// state (getEvidence/getEdges), not just evidence created this run, matching
// BEN-INT-08's own established getEvidence(prospect.id, context.orgId)
// pattern for reading the full existing dossier.
const CAREER_DIMENSIONS = [
  "Employer Legal Identity",
  "Role/Title Semantics",
  "Start/End/Effective Dates",
  "Executive Mobility",
  "Compensation Observations When Lawful",
  "Career Contradictions",
] as const;

export interface EmploymentCareerIntelligenceReport {
  prospectId: string;
  dimensionCoverage: Record<string, boolean>;
  evidenceCreatedThisRun: number;
  delegationsIssued: string[];
  employmentRecordsFound: number;
}

interface EmploymentRecord {
  title: string;
  company: string;
  sourceUrl: string;
  sourceTitle: string | null;
}

export class EmploymentCareerIntelligenceAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    if (!context.prospectId) {
      return this.completedEmpty("BEN-INT-02 requires an existing prospectId");
    }
    const prospect = await getProspectById(context.orgId, context.prospectId);
    if (!prospect) {
      return this.completedEmpty(`Prospect ${context.prospectId} not found`);
    }

    const evidenceCreated: EvidenceItem[] = [];
    const personNode = await upsertProspectNode(context.orgId, prospect, "person");

    // Current role first (spec's recency-first planning behavior).
    const currentSearch = await callTool(context, runner, "web_search", {
      query: `"${prospect.display_name}" current title OR "CEO" OR "president" OR "employed at"`,
      limit: 5,
    });
    const records: EmploymentRecord[] = [];
    if (currentSearch.success) {
      const results = ((currentSearch.data as { results?: Array<{ title: string; url: string }> } | null)?.results ?? []);
      for (const item of results.slice(0, 3)) {
        records.push({ title: item.title, company: extractEntityName(item.title).name, sourceUrl: item.url, sourceTitle: item.title });
      }
    }

    // Historical roles -- searched after current, per spec ordering.
    const historySearch = await callTool(context, runner, "web_search", {
      query: `"${prospect.display_name}" former OR previously OR "prior to" employer`,
      limit: 5,
    });
    if (historySearch.success) {
      const results = ((historySearch.data as { results?: Array<{ title: string; url: string }> } | null)?.results ?? []);
      for (const item of results.slice(0, 3)) {
        records.push({ title: item.title, company: extractEntityName(item.title).name, sourceUrl: item.url, sourceTitle: item.title });
      }
    }

    let isFirst = true;
    for (const record of records) {
      const crawl = await callTool(context, runner, "web_crawl", { url: record.sourceUrl });
      const excerpt = crawl.success ? (crawl.data as { text: string }).text.slice(0, 300) : null;

      const evidence = await recordIntelligenceEvidence({
        orgId: context.orgId,
        prospectId: prospect.id,
        claim: `Employment role mention: ${record.title}`,
        value: { title: record.title, company: record.company, isCurrent: isFirst },
        claimType: "employment",
        sourceUrl: record.sourceUrl,
        sourceTitle: record.sourceTitle,
        sourceType: "open_web",
        publisher: hostnameOf(record.sourceUrl),
        evidenceExcerpt: excerpt,
        agentCode: context.agentCode,
        researchRunId: context.runId,
        confidence: isFirst ? 0.5 : 0.35,
        verificationStatus: "single_source_fact",
      });
      evidenceCreated.push(evidence);

      const companyNode = await upsertCounterpartyNode(context.orgId, "company", record.company, {});
      await upsertEdge({
        organization_id: context.orgId,
        source_node_id: personNode.id,
        target_node_id: companyNode.id,
        edge_type: "employed_by",
        relationship_strength: isFirst ? "strong" : "moderate",
        confidence: isFirst ? 0.5 : 0.35,
        temporal_validity_start: null,
        temporal_validity_end: isFirst ? null : new Date().toISOString().slice(0, 10),
        is_current: isFirst,
        superseded_by_edge_id: null,
        properties: { title: record.title, seniority: null },
      });

      isFirst = false;
    }

    const tokensUsed = await tryModelTokens(context, runner, 400);

    // Everything below is secondary reasoning layered on top of the
    // evidence-gathering above, which has already durably committed via
    // individually atomic recordIntelligenceEvidence()/upsertEdge() calls. A
    // bug here must never discard that already-collected evidence or fail
    // this run -- recovery starts from persisted truth, and captured
    // evidence stays immutable regardless of what happens next.
    let report: EmploymentCareerIntelligenceReport = {
      prospectId: prospect.id,
      dimensionCoverage: Object.fromEntries(CAREER_DIMENSIONS.map((d) => [d, false])),
      evidenceCreatedThisRun: evidenceCreated.length,
      delegationsIssued: [],
      employmentRecordsFound: records.length,
    };
    let delegations: DelegationRequest[] = [];

    try {
      const allEvidence = await getEvidence(prospect.id, context.orgId);
      const personEdges = personNode ? await getEdges(personNode.id) : [];
      const employmentEvidence = allEvidence.filter((e) => e.claim_type === "employment");
      const employmentEdges = personEdges.filter((e) => e.edge_type === "employed_by");

      const dimensionCoverage: Record<string, boolean> = {
        "Employer Legal Identity":
          employmentEvidence.some((e) => Boolean((e.value as { company?: string } | null)?.company)) ||
          employmentEdges.length > 0,
        "Role/Title Semantics": employmentEvidence.some((e) => Boolean((e.value as { title?: string } | null)?.title)),
        "Start/End/Effective Dates": employmentEdges.some(
          (e) => e.temporal_validity_start !== null || e.temporal_validity_end !== null,
        ),
        "Executive Mobility": employmentEvidence.length > 1 || employmentEdges.length > 1,
        "Compensation Observations When Lawful": allEvidence.some(
          (e) => e.claim_type === "high_compensation_officer_signal" || (e.claim_type === "employment" && /compensation|salary/i.test(e.claim)),
        ),
        "Career Contradictions": employmentEvidence.some(
          (e) => e.verification_status === "contradicted" || e.contradiction_status !== "none",
        ),
      };

      // Ownership-signal trigger: an employment-search result whose title
      // itself reads as a founder/owner/principal mention is exactly
      // BEN-INT-03's Legal Entity Ownership dimension surfacing early.
      const hasOwnershipSignal = records.some((r) => /founder|co-founder|\bowner\b|principal/i.test(r.title));
      // Executive-mobility trigger: both a current AND a prior role were
      // found this run -- a documented career change exists that
      // BEN-INT-01's Biographical And Role Chronology dimension should
      // re-sync.
      const hasExecutiveMobility = records.length > 1;
      // Identity-ambiguity trigger: no employment record found at all this
      // run.
      const identityAmbiguous = records.length === 0;
      // Evidence-verification trigger: new evidence was recorded this run
      // and needs provenance verification.
      const needsEvidenceVerification = evidenceCreated.length > 0;

      const candidates: DelegationRequest[] = [];
      const pushCandidate = (childAgentCode: string, objective: string) => {
        candidates.push({
          childAgentCode,
          objective,
          maxAutonomy: "A2",
          constraints: { prospectId: context.prospectId, triggeredBy: context.agentCode },
        });
      };

      // Priority order per the roster's BEN-INT-02 delegation list -- stop
      // once MAX_DELEGATIONS_PER_RUN candidates are collected, even if a
      // lower-priority condition below also holds.
      if (identityAmbiguous) {
        pushCandidate(
          "BEN-KNW-02",
          `Prospect ${context.prospectId} has no employment record found by this BEN-INT-02 run -- resolve identity ambiguity before further career research.`,
        );
      }
      if (hasOwnershipSignal) {
        pushCandidate(
          "BEN-INT-03",
          `Prospect ${context.prospectId} has an employment result whose title reads as founder/owner/principal -- research legal entity ownership.`,
        );
      }
      if (hasExecutiveMobility) {
        pushCandidate(
          "BEN-INT-01",
          `Prospect ${context.prospectId} has both a current and a prior role found this run -- re-sync biographical role chronology for the documented career change.`,
        );
      }
      if (needsEvidenceVerification) {
        pushCandidate(
          "BEN-KNW-03",
          `BEN-INT-02 recorded ${evidenceCreated.length} new employment evidence item(s) for prospect ${context.prospectId} this run -- verify provenance before treating as authoritative.`,
        );
      }

      delegations = candidates.slice(0, MAX_DELEGATIONS_PER_RUN);

      report = {
        prospectId: prospect.id,
        dimensionCoverage,
        evidenceCreatedThisRun: evidenceCreated.length,
        delegationsIssued: delegations.map((d) => d.childAgentCode),
        employmentRecordsFound: records.length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      try {
        await logAction({
          organization_id: context.orgId,
          actor_type: "agent",
          actor_id: context.agentCode,
          action: "ben-int-02.gap_analysis_failed",
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

export default EmploymentCareerIntelligenceAgent;
