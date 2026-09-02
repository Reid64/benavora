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
import type { EvidenceItem, ProspectEntityType } from "@/lib/pil/types";

// Six domain dimensions this agent's report scores coverage across, per
// PIL_AGENT_COMPLETE_ROSTER.md's "Core Intelligence" BEN_INT_06Decision.v1
// contract. Coverage is computed from persisted pil_evidence state
// (getEvidence), not just evidence created this run, matching BEN-INT-05/08's
// own established getEvidence(prospect.id, context.orgId) pattern for
// reading the full existing dossier.
const FOUNDATION_DIMENSIONS = [
  "Foundation Legal Identity",
  "Foundation Type",
  "Trustees/Officers",
  "Assets And Filing Periods",
  "Grant History",
  "Application Access And Restrictions",
] as const;

export interface FoundationIntelligenceReport {
  prospectId: string;
  ein: string | null;
  dimensionCoverage: Record<string, boolean>;
  evidenceCreatedThisRun: number;
  delegationsIssued: string[];
}

// BEN-INT-06 -- Foundation Intelligence Agent
// (PROSPECT_INTELLIGENCE_AGENTS.md "FAMILY 3"). Develops detailed
// intelligence on a foundation prospect: assets, officers/trustees, grant
// totals, mission/priorities, application practices.
//
// The task spec labeled this code "Nonprofit Board Intelligence" and put
// "Foundation Intelligence" at BEN-INT-07 -- the live registry has the
// reverse (BEN-INT-06 = Foundation, BEN-INT-07 = Giving History;
// PROSPECT_INTELLIGENCE_AGENTS.md line ~497). Per this codebase's
// established registry-wins pattern, this file implements the real
// BEN-INT-06.
//
// Permitted tools per spec: T-990, T-WEB, T-EVIDENCE (write), T-GRAPH
// (write). irs_990_lookup (tools/irs-990-tool.ts) exposes aggregate
// total_grants_paid/officers/mission from ProPublica's org-detail endpoint,
// not a line-item recipient table (that requires parsing full 990 XML,
// explicitly out of scope per that tool's own header) -- so recipient-level
// "GrantRecipient" nodes are not created; this agent records the aggregate
// figures it can source and links officers/trustees via graph edges, which
// the schema and data both support. It also never asserts a giving *trend*
// (spec's explicit failure criteria) since only one filing is fetched.

const FOUNDATION_TYPES: ProspectEntityType[] = [
  "family_foundation",
  "private_foundation",
  "community_foundation",
  "corporate_foundation",
];

export class FoundationIntelligenceAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    if (!context.prospectId) {
      return this.completedEmpty("BEN-INT-06 requires an existing prospectId");
    }
    const prospect = await getProspectById(context.orgId, context.prospectId);
    if (!prospect) {
      return this.completedEmpty(`Prospect ${context.prospectId} not found`);
    }
    if (!FOUNDATION_TYPES.includes(prospect.entity_type)) {
      return this.completedEmpty(`Prospect ${prospect.id} is entity_type=${prospect.entity_type}, not a foundation type -- skipping`);
    }

    const evidenceCreated: EvidenceItem[] = [];
    const foundationNode = await upsertProspectNode(context.orgId, prospect, "foundation");
    // Tracked for the delegation-gap analysis below -- only incremented
    // inside the officer loop, which is only reached when ein and the 990
    // lookup both succeeded.
    let officersFound = 0;
    let applicationEvidenceRecorded = false;

    const lookup = await callTool(context, runner, "entity_lookup", { name: prospect.display_name, type: "foundation" });
    const ein = lookup.success
      ? ((lookup.data as { matches?: Array<{ source: string; ein: string | null }> } | null)?.matches ?? []).find(
          (m) => m.source === "foundation_directory" && m.ein,
        )?.ein ?? null
      : null;

    if (ein) {
      // Persist the resolved EIN onto the foundation's own graph node so
      // BEN-INT-07 (Giving History) can chain a trustee's 990 lookup back to
      // this foundation without re-resolving it.
      await upsertProspectNode(context.orgId, prospect, "foundation", { ein });

      const nineNinety = await callTool(context, runner, "irs_990_lookup", { ein });
      if (nineNinety.success) {
        const data = nineNinety.data as {
          total_assets: number | null;
          total_grants_paid: number | null;
          mission: string | null;
          officers: Array<{ name: string | null; title: string | null; compensation: number | null }>;
          filing_year: number | null;
          address: { city: string | null; state: string | null };
        };
        const sourceType = "irs_form_990";

        evidenceCreated.push(
          await recordIntelligenceEvidence({
            orgId: context.orgId,
            prospectId: prospect.id,
            claim: `Assets and grants paid per most recent 990 filing (${data.filing_year ?? "unknown year"}): assets=${data.total_assets ?? "unknown"}, grantsPaid=${data.total_grants_paid ?? "unknown"}`,
            value: { totalAssets: data.total_assets, totalGrantsPaid: data.total_grants_paid, filingYear: data.filing_year },
            claimType: "foundation_financials",
            sourceUrl: null,
            sourceTitle: prospect.display_name,
            sourceType,
            publisher: "IRS Form 990",
            evidenceExcerpt: null,
            agentCode: context.agentCode,
            researchRunId: context.runId,
            confidence: 0.8,
            verificationStatus: "corroborated_fact",
          }),
        );

        if (data.mission) {
          evidenceCreated.push(
            await recordIntelligenceEvidence({
              orgId: context.orgId,
              prospectId: prospect.id,
              claim: `Stated mission/priorities: ${data.mission}`,
              value: { mission: data.mission },
              claimType: "foundation_mission_priorities",
              sourceUrl: null,
              sourceTitle: prospect.display_name,
              sourceType,
              publisher: "IRS Form 990",
              evidenceExcerpt: data.mission,
              agentCode: context.agentCode,
              researchRunId: context.runId,
              confidence: 0.7,
              verificationStatus: "corroborated_fact",
            }),
          );
        }

        for (const officer of data.officers) {
          if (!officer.name) continue;
          officersFound += 1;
          evidenceCreated.push(
            await recordIntelligenceEvidence({
              orgId: context.orgId,
              prospectId: prospect.id,
              claim: `Officer/trustee per most recent 990 filing: ${officer.name}${officer.title ? ` (${officer.title})` : ""}`,
              value: { name: officer.name, title: officer.title, compensation: officer.compensation },
              claimType: "foundation_officers",
              sourceUrl: null,
              sourceTitle: prospect.display_name,
              sourceType,
              publisher: "IRS Form 990",
              evidenceExcerpt: null,
              agentCode: context.agentCode,
              researchRunId: context.runId,
              confidence: 0.75,
              verificationStatus: "corroborated_fact",
            }),
          );

          const officerNode = await upsertCounterpartyNode(context.orgId, "person", officer.name, {});
          await upsertEdge({
            organization_id: context.orgId,
            source_node_id: officerNode.id,
            target_node_id: foundationNode.id,
            edge_type: "trustee_of",
            relationship_strength: "strong",
            confidence: 0.75,
            temporal_validity_start: null,
            temporal_validity_end: null,
            is_current: true,
            superseded_by_edge_id: null,
            properties: { title: officer.title, filingYear: data.filing_year },
          });
        }
      }
    }

    // Application procedures / contact info -- not carried by irs_990_lookup,
    // so sourced from the foundation's own web presence.
    const applySearch = await callTool(context, runner, "web_search", {
      query: `"${prospect.display_name}" grant application OR "how to apply" contact`,
      limit: 3,
    });
    if (applySearch.success) {
      const results = ((applySearch.data as { results?: Array<{ title: string; url: string }> } | null)?.results ?? []);
      const top = results[0];
      if (top) {
        const crawl = await callTool(context, runner, "web_crawl", { url: top.url });
        const excerpt = crawl.success ? (crawl.data as { text: string }).text.slice(0, 400) : null;
        evidenceCreated.push(
          await recordIntelligenceEvidence({
            orgId: context.orgId,
            prospectId: prospect.id,
            claim: `Application procedures / contact info page: ${top.title || top.url}`,
            value: { url: top.url, title: top.title },
            claimType: "foundation_application_procedures",
            sourceUrl: top.url,
            sourceTitle: top.title || null,
            sourceType: "open_web",
            publisher: hostnameOf(top.url),
            evidenceExcerpt: excerpt,
            agentCode: context.agentCode,
            researchRunId: context.runId,
            confidence: 0.4,
            verificationStatus: "single_source_fact",
          }),
        );
        applicationEvidenceRecorded = true;
      }
    }

    const tokensUsed = await tryModelTokens(context, runner, 500);

    // Everything below is secondary reasoning layered on top of the
    // evidence-gathering above, which has already durably committed via
    // individually atomic recordIntelligenceEvidence()/upsertEdge() calls. A
    // bug here must never discard that already-collected evidence or fail
    // this run -- recovery starts from persisted truth, and captured
    // evidence stays immutable regardless of what happens next.
    let report: FoundationIntelligenceReport = {
      prospectId: prospect.id,
      ein,
      dimensionCoverage: Object.fromEntries(FOUNDATION_DIMENSIONS.map((d) => [d, false])),
      evidenceCreatedThisRun: evidenceCreated.length,
      delegationsIssued: [],
    };
    let delegations: DelegationRequest[] = [];

    try {
      const allEvidence = await getEvidence(prospect.id, context.orgId);
      const financialEvidence = allEvidence.filter((e) => e.claim_type === "foundation_financials");
      const has990IdentityEvidence = allEvidence.some((e) => e.source_type === "irs_form_990");
      const hasOfficerEvidence = allEvidence.some((e) => e.claim_type === "foundation_officers");
      const hasGrantHistory = financialEvidence.some(
        (e) => (e.value as { totalGrantsPaid?: number | null } | null)?.totalGrantsPaid != null,
      );
      const hasApplicationEvidence = allEvidence.some((e) => e.claim_type === "foundation_application_procedures");

      const dimensionCoverage: Record<string, boolean> = {
        "Foundation Legal Identity": has990IdentityEvidence,
        "Foundation Type": true,
        "Trustees/Officers": hasOfficerEvidence,
        "Assets And Filing Periods": financialEvidence.length > 0,
        "Grant History": hasGrantHistory,
        "Application Access And Restrictions": hasApplicationEvidence,
      };

      // Priority order per the roster's BEN-INT-06 delegation list -- stop
      // once MAX_DELEGATIONS_PER_RUN candidates are collected, even if a
      // lower-priority condition below also holds. BEN-KNW-03 is
      // deliberately the lowest-priority of the five and is the one
      // expected to get dropped by the cap, since this agent has the
      // largest target list of the BEN-INT-06..10 family.
      const candidates: DelegationRequest[] = [];
      const pushCandidate = (childAgentCode: string, objective: string) => {
        candidates.push({
          childAgentCode,
          objective,
          maxAutonomy: "A2",
          constraints: { prospectId: context.prospectId, triggeredBy: context.agentCode },
        });
      };

      if (!ein) {
        pushCandidate(
          "BEN-KNW-02",
          `Prospect ${context.prospectId} has no EIN resolved by this BEN-INT-06 run -- the foundation's own legal identity is unconfirmed, blocking downstream research.`,
        );
      }
      if (ein) {
        pushCandidate(
          "BEN-INT-07",
          `BEN-INT-06 resolved EIN ${ein} for prospect ${context.prospectId}'s foundation this run -- cross-reference giving history for any donor/trustee linked to this foundation.`,
        );
      }
      if (officersFound > 0) {
        pushCandidate(
          "BEN-REL-02",
          `BEN-INT-06 discovered ${officersFound} officer/trustee relationship(s) for prospect ${context.prospectId}'s foundation this run -- map cross-prospect board overlap.`,
        );
      }
      if (applicationEvidenceRecorded) {
        pushCandidate(
          "BEN-QLF-02",
          `BEN-INT-06 recorded a fresh grant-application-access page for prospect ${context.prospectId}'s foundation this run -- assess Applicant Class/Program Restrictions/Deadline funding eligibility.`,
        );
      }
      if (evidenceCreated.length > 0) {
        pushCandidate(
          "BEN-KNW-03",
          `BEN-INT-06 recorded ${evidenceCreated.length} new evidence item(s) for prospect ${context.prospectId} this run -- verify provenance before treating as authoritative.`,
        );
      }

      delegations = candidates.slice(0, MAX_DELEGATIONS_PER_RUN);

      report = {
        prospectId: prospect.id,
        ein,
        dimensionCoverage,
        evidenceCreatedThisRun: evidenceCreated.length,
        delegationsIssued: delegations.map((d) => d.childAgentCode),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      try {
        await logAction({
          organization_id: context.orgId,
          actor_type: "agent",
          actor_id: context.agentCode,
          action: "ben-int-06.gap_analysis_failed",
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

export default FoundationIntelligenceAgent;
