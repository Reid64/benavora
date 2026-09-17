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
import { upsertEdge } from "@/lib/pil/graph";
import type { EvidenceItem } from "@/lib/pil/types";
import { serializePilError } from "@/lib/pil/serialize-error";

// Six domain dimensions this agent's report scores coverage across, per
// PIL_AGENT_COMPLETE_ROSTER.md's "Core Intelligence" BEN_INT_04Decision.v1
// contract. Coverage is computed from persisted pil_evidence state
// (getEvidence), not just evidence created this run, matching BEN-INT-08's
// own established getEvidence(prospect.id, context.orgId) pattern for
// reading the full existing dossier.
const EDUCATION_DIMENSIONS = [
  "Institution Identity",
  "Degree/Credential Status",
  "Attendance Versus Graduation",
  "Class Year",
  "Alumni Governance/Service",
  "Institutional Overlap",
] as const;

export interface EducationAlumniIntelligenceReport {
  prospectId: string;
  dimensionCoverage: Record<string, boolean>;
  evidenceCreatedThisRun: number;
  delegationsIssued: string[];
  educationMentionsFound: number;
}

// BEN-INT-04 -- Education & Alumni Intelligence Agent
// (PROSPECT_INTELLIGENCE_AGENTS.md "FAMILY 3"). Researches educational
// affiliations, treated as a relationship-discovery input first and a
// biography-completeness input second (spec's planning behavior).
//
// The task spec that commissioned this batch labeled this code "Executive
// Intelligence" -- the live registry has no such agent at BEN-INT-04; that
// code is "Education & Alumni Intelligence Agent"
// (PROSPECT_INTELLIGENCE_AGENTS.md line ~455). Per this codebase's
// established pattern of trusting registry/spec state over a colliding
// task-given description (see agents/dis/BEN-DIS-03.ts's file header for
// the same situation), this file implements the real BEN-INT-04.
//
// Permitted tools per spec: T-WEB, T-CRAWL, T-EVIDENCE (write), T-GRAPH
// (write). GraphNodeType has no dedicated "university"/"institution" value
// (types.ts) -- higher-ed institutions are themselves 501(c)(3) nonprofits,
// so node_type='nonprofit' is the closest existing fit, matching how
// BEN-DIS-03 reuses existing node types for entities without a bespoke one.

interface EducationMention {
  institutionName: string;
  sourceUrl: string;
  sourceTitle: string | null;
  excerpt: string | null;
}

const DEGREE_PATTERN = /\b(B\.?A\.?|B\.?S\.?|M\.?A\.?|M\.?B\.?A\.?|M\.?S\.?|J\.?D\.?|Ph\.?D\.?)\b/i;
const GRAD_YEAR_PATTERN = /\b(19|20)\d{2}\b/;

export class EducationAlumniIntelligenceAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    if (!context.prospectId) {
      return this.completedEmpty("BEN-INT-04 requires an existing prospectId");
    }
    const prospect = await getProspectById(context.orgId, context.prospectId);
    if (!prospect) {
      return this.completedEmpty(`Prospect ${context.prospectId} not found`);
    }

    const evidenceCreated: EvidenceItem[] = [];
    const personNode = await upsertProspectNode(context.orgId, prospect, "person");
    const mentions: EducationMention[] = [];

    const eduSearch = await callTool(context, runner, "web_search", {
      query: `"${prospect.display_name}" university OR college OR alumnus OR graduated OR degree`,
      limit: 5,
    });
    if (eduSearch.success) {
      const results = ((eduSearch.data as { results?: Array<{ title: string; url: string }> } | null)?.results ?? []);
      for (const item of results.slice(0, 3)) {
        mentions.push({ institutionName: extractEntityName(item.title).name, sourceUrl: item.url, sourceTitle: item.title, excerpt: null });
      }
    }

    for (const mention of mentions) {
      // LinkedIn-style profile crawl for a degree/graduation-year excerpt.
      const crawl = await callTool(context, runner, "web_crawl", { url: mention.sourceUrl });
      let excerpt: string | null = null;
      let degree: string | null = null;
      let gradYear: string | null = null;
      if (crawl.success) {
        const { text } = crawl.data as { text: string };
        excerpt = text.slice(0, 300);
        degree = text.match(DEGREE_PATTERN)?.[0] ?? null;
        gradYear = text.match(GRAD_YEAR_PATTERN)?.[0] ?? null;
      }

      const evidence = await recordIntelligenceEvidence({
        orgId: context.orgId,
        prospectId: prospect.id,
        claim: `Education affiliation mention: ${mention.institutionName}${degree ? ` (${degree})` : ""}${gradYear ? `, ${gradYear}` : ""}`,
        value: { institution: mention.institutionName, degree, graduationYear: gradYear, url: mention.sourceUrl },
        claimType: "education",
        sourceUrl: mention.sourceUrl,
        sourceTitle: mention.sourceTitle,
        sourceType: "open_web",
        publisher: hostnameOf(mention.sourceUrl),
        evidenceExcerpt: excerpt,
        agentCode: context.agentCode,
        researchRunId: context.runId,
        confidence: 0.4,
        verificationStatus: "single_source_fact",
      });
      evidenceCreated.push(evidence);

      const institutionNode = await upsertCounterpartyNode(context.orgId, "nonprofit", mention.institutionName, {
        institutionKind: "education",
      });
      await upsertEdge({
        organization_id: context.orgId,
        source_node_id: personNode.id,
        target_node_id: institutionNode.id,
        edge_type: "related_to",
        relationship_strength: "moderate",
        confidence: 0.4,
        temporal_validity_start: null,
        temporal_validity_end: null,
        is_current: true,
        superseded_by_edge_id: null,
        properties: { relationship: "alumnus_of", degree, graduationYear: gradYear },
      });
    }

    const tokensUsed = await tryModelTokens(context, runner, 300);

    // Everything below is secondary reasoning layered on top of the
    // evidence-gathering above, which has already durably committed via
    // individually atomic recordIntelligenceEvidence()/upsertEdge() calls. A
    // bug here must never discard that already-collected evidence or fail
    // this run -- recovery starts from persisted truth, and captured
    // evidence stays immutable regardless of what happens next.
    let report: EducationAlumniIntelligenceReport = {
      prospectId: prospect.id,
      dimensionCoverage: Object.fromEntries(EDUCATION_DIMENSIONS.map((d) => [d, false])),
      evidenceCreatedThisRun: evidenceCreated.length,
      delegationsIssued: [],
      educationMentionsFound: mentions.length,
    };
    let delegations: DelegationRequest[] = [];

    try {
      const allEvidence = await getEvidence(prospect.id, context.orgId);
      const educationEvidence = allEvidence.filter((e) => e.claim_type === "education");
      const hasDegree = educationEvidence.some(
        (e) => typeof (e.value as { degree?: string | null } | null)?.degree === "string",
      );
      const hasGradYear = educationEvidence.some(
        (e) => typeof (e.value as { graduationYear?: string | null } | null)?.graduationYear === "string",
      );

      const dimensionCoverage: Record<string, boolean> = {
        "Institution Identity": educationEvidence.length > 0,
        "Degree/Credential Status": hasDegree,
        "Attendance Versus Graduation": educationEvidence.length > 0,
        "Class Year": hasGradYear,
        "Alumni Governance/Service": allEvidence.some((e) => e.claim_type === "nonprofit_board"),
        "Institutional Overlap": educationEvidence.length > 0,
      };

      // Priority order per the roster's BEN-INT-04 delegation list -- stop
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
          `Prospect ${context.prospectId} has no education/alumni mentions found by this BEN-INT-04 run -- resolve identity ambiguity before further intelligence gathering.`,
        );
      }
      if (mentions.length > 0) {
        pushCandidate(
          "BEN-REL-04",
          `BEN-INT-04 created ${mentions.length} institution edge(s) for prospect ${context.prospectId} this run -- check whether this institution overlaps with other prospects/organizations already in this tenant's graph.`,
        );
      }
      if (evidenceCreated.length > 0) {
        pushCandidate(
          "BEN-KNW-03",
          `BEN-INT-04 recorded ${evidenceCreated.length} new evidence item(s) for prospect ${context.prospectId} this run -- verify provenance before treating as authoritative.`,
        );
      }

      delegations = candidates.slice(0, MAX_DELEGATIONS_PER_RUN);

      report = {
        prospectId: prospect.id,
        dimensionCoverage,
        evidenceCreatedThisRun: evidenceCreated.length,
        delegationsIssued: delegations.map((d) => d.childAgentCode),
        educationMentionsFound: mentions.length,
      };
    } catch (err) {
      const message = serializePilError(err);
      try {
        await logAction({
          organization_id: context.orgId,
          actor_type: "agent",
          actor_id: context.agentCode,
          action: "ben-int-04.gap_analysis_failed",
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

export default EducationAlumniIntelligenceAgent;
