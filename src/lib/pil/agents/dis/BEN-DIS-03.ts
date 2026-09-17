import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import { logAction } from "@/lib/pil/audit";
import {
  callTool,
  findOrCreateProspect,
  hostnameOf,
  MODEL_TOKEN_UNIT_COST_USD,
  parseGoalCriteria,
  recordDiscoveryEvidence,
  tryModelTokens,
} from "@/lib/pil/agents/dis/shared";
import { upsertEdge, upsertNode } from "@/lib/pil/graph";
import type { EvidenceItem, GraphNode, ProspectEntityType } from "@/lib/pil/types";
import { serializePilError } from "@/lib/pil/serialize-error";

// Foundation identity/lifecycle keyword signal (FoundationIdentityHypothesis.v2,
// PIL_AGENT_COMPLETE_ROSTER.md "Discovery" section): a 990 mission statement
// itself asserting a rename/merger/dissolution/conversion event is a stronger
// and more direct identity signal than the filing-year recency heuristic
// alone can detect, so it always overrides that heuristic's verdict.
const LIFECYCLE_CONFLICT_PATTERN = /\b(formerly known as|merged with|successor to|dissolved|terminated|converted to)\b/i;

// BEN-DIS-03 -- Foundation Discovery Agent
// (PROSPECT_INTELLIGENCE_AGENTS.md "FAMILY 2 -- DISCOVERY"). Discovers
// private, family, corporate, and community foundations aligned with the
// tenant's programs. This is the primary path for the existing TX
// discovery data (foundation_directory, migration 044+/IRS BMF import).
//
// The task spec that commissioned this batch described a separate
// "BEN-DIS-04 Family Foundation Discovery" agent (family-name web search +
// family members linked as individual prospects). That agent code does not
// exist in the applied registry (supabase/migrations/155_pil_agent_registry.sql)
// or in PROSPECT_INTELLIGENCE_AGENTS.md -- BEN-DIS-04 there is "Corporate
// Giving Discovery Agent" and BEN-DIS-05 is "Executive Prospect Discovery
// Agent" (see BEN-DIS-04.ts/BEN-DIS-05.ts, which implement those). Per this
// codebase's own established pattern of trusting live registry/spec state
// over a task-given description when they collide, the family-foundation
// behavior is folded into *this* agent instead: BEN-DIS-03's own mission
// already explicitly covers "family ... foundations", and 'family_foundation'
// is a first-class pil_prospects.entity_type value (PROSPECT_INTELLIGENCE_SCHEMA.md
// section 1.1).
//
// Permitted tools per spec: T-WEB, T-990, T-PUBREC, T-GRAPH (write),
// T-EVIDENCE (write). The task spec names concrete registry tool keys:
// entity_lookup (T-PUBREC-equivalent internal lookup against
// foundation_directory) and irs_990_lookup (T-990).

function inferFoundationEntityType(name: string): ProspectEntityType {
  const lower = name.toLowerCase();
  if (lower.includes("family")) return "family_foundation";
  if (lower.includes("community")) return "community_foundation";
  if (/\b(corp|corporation|company|inc)\b/.test(lower)) return "corporate_foundation";
  return "private_foundation";
}

interface FoundationDiscovery {
  prospectId: string;
  displayName: string;
  confidence: number;
  created: boolean;
  lifecycleStatus: string;
}

export class FoundationDiscoveryAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    if (context.goal.trim().length === 0) {
      return {
        status: "completed",
        evidence: [],
        conclusions: { skipped: true, reason: "BEN-DIS-03 requires a non-empty goal" },
        delegations: [],
        tokensUsed: 0,
        costUsd: 0,
        error: null,
      };
    }

    const criteria = parseGoalCriteria(context.goal);
    const evidenceCreated: EvidenceItem[] = [];
    const discoveries: FoundationDiscovery[] = [];
    const ambiguousProspectIds: string[] = [];

    // 1. Query foundation_directory via entity_lookup for foundations
    // matching the goal criteria (state, cause-as-program-area proxy).
    const lookupResult = await callTool(context, runner, "entity_lookup", {
      name: criteria.cause ?? "foundation",
      type: "foundation",
      location: criteria.stateCode ?? undefined,
    });
    if (!lookupResult.success) {
      const tokensUsed = await tryModelTokens(context, runner, 200);
      return {
        status: "completed",
        evidence: [],
        conclusions: { criteria, discoveredProspectIds: [], discoveries: [] },
        delegations: [],
        tokensUsed,
        costUsd: tokensUsed * MODEL_TOKEN_UNIT_COST_USD,
        error: null,
      };
    }

    const matches = ((lookupResult.data as { matches?: Array<{ source: string; id: string; name: string; location: string | null; confidence: number; ein: string | null; ntee_code: string | null }> } | null)?.matches ?? []).filter(
      (m) => m.source === "foundation_directory",
    );

    for (const match of matches) {
      try {
      // 2. Create or update a pil_prospect for the foundation.
      const entityType = inferFoundationEntityType(match.name);
      const { prospect, created } = await findOrCreateProspect({
        orgId: context.orgId,
        displayName: match.name,
        entityType,
        agentCode: context.agentCode,
      });

      const foundationNode = await upsertNode({
        organization_id: context.orgId,
        node_type: "foundation",
        prospect_id: prospect.id,
        label: match.name,
        properties: { ein: match.ein, ntee_code: match.ntee_code, location: match.location },
      });

      // 3. Fetch 990 data to get grants paid, officers, mission/priorities,
      // and (FoundationIdentityHypothesis.v2) a lifecycleStatus verdict.
      // Defaults to UNKNOWN whenever no 990 data is reachable at all (no
      // EIN on the match, or the irs_990_lookup call itself reports failure).
      let lifecycleStatus = "UNKNOWN";
      if (match.ein) {
        const nineNinety = await callTool(context, runner, "irs_990_lookup", { ein: match.ein });
        if (nineNinety.success) {
          const data = nineNinety.data as {
            total_grants_paid: number | null;
            officers: Array<{ name: string | null; title: string | null; compensation: number | null }>;
            mission: string | null;
            filing_year: number | null;
          };
          const sourceType = "irs_form_990";

          const currentYear = new Date().getFullYear();
          lifecycleStatus =
            data.filing_year != null && currentYear - data.filing_year <= 3
              ? "ACTIVE_VERIFIED"
              : "ACTIVE_UNCONFIRMED";
          if (data.mission && LIFECYCLE_CONFLICT_PATTERN.test(data.mission)) {
            lifecycleStatus = "CONFLICTING";
          }

          evidenceCreated.push(
            await recordDiscoveryEvidence({
              orgId: context.orgId,
              prospectId: prospect.id,
              claim: `Total grants paid per most recent 990 filing (${data.filing_year ?? "unknown year"}): ${data.total_grants_paid ?? "unknown"}`,
              value: { totalGrantsPaid: data.total_grants_paid, filingYear: data.filing_year, lifecycleStatus },
              claimType: "foundation_grants_paid",
              sourceUrl: null,
              sourceTitle: match.name,
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
              await recordDiscoveryEvidence({
                orgId: context.orgId,
                prospectId: prospect.id,
                claim: `Stated mission/priorities: ${data.mission}`,
                value: { mission: data.mission },
                claimType: "foundation_mission_priorities",
                sourceUrl: null,
                sourceTitle: match.name,
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

          if (data.officers.length > 0) {
            evidenceCreated.push(
              await recordDiscoveryEvidence({
                orgId: context.orgId,
                prospectId: prospect.id,
                claim: `Officers/trustees per most recent 990 filing: ${data.officers.map((o) => o.name).filter(Boolean).join(", ")}`,
                value: { officers: data.officers },
                claimType: "foundation_officers",
                sourceUrl: null,
                sourceTitle: match.name,
                sourceType,
                publisher: "IRS Form 990",
                evidenceExcerpt: null,
                agentCode: context.agentCode,
                researchRunId: context.runId,
                confidence: 0.75,
                verificationStatus: "corroborated_fact",
              }),
            );
          }
        }
      }

      // 4. Graph edges: Foundation->Cause (from NTEE), Foundation->Geography.
      if (match.ntee_code) {
        const causeNode = await upsertNode({
          organization_id: context.orgId,
          node_type: "cause",
          prospect_id: null,
          label: match.ntee_code,
          properties: { source: "ntee_code" },
        });
        await upsertEdge({
          organization_id: context.orgId,
          source_node_id: foundationNode.id,
          target_node_id: causeNode.id,
          edge_type: "supports_cause",
          relationship_strength: "moderate",
          confidence: match.confidence,
          temporal_validity_start: null,
          temporal_validity_end: null,
          is_current: true,
          superseded_by_edge_id: null,
          properties: { derivedFrom: "ntee_code" },
        });
      }
      if (match.location) {
        const geoNode = await upsertNode({
          organization_id: context.orgId,
          node_type: "geography",
          prospect_id: null,
          label: match.location,
          properties: {},
        });
        await upsertEdge({
          organization_id: context.orgId,
          source_node_id: foundationNode.id,
          target_node_id: geoNode.id,
          edge_type: "operates_in",
          relationship_strength: "strong",
          confidence: match.confidence,
          temporal_validity_start: null,
          temporal_validity_end: null,
          is_current: true,
          superseded_by_edge_id: null,
          properties: {},
        });
      }

      if (lifecycleStatus === "CONFLICTING" || lifecycleStatus === "UNKNOWN") {
        ambiguousProspectIds.push(prospect.id);
      }

      // Family foundation nuance (see file header): search for family-name
      // associations and link identified family members as individual
      // prospects.
      if (entityType === "family_foundation") {
        await this.discoverFamilyMembers(context, runner, match.name, foundationNode, evidenceCreated, discoveries);
      }

      discoveries.push({ prospectId: prospect.id, displayName: prospect.display_name, confidence: match.confidence, created, lifecycleStatus });
      } catch (err) {
        // Recovery protocol: a thrown error while processing one match (e.g.
        // a Supabase write failure inside upsertNode/recordDiscoveryEvidence)
        // must not discard every already-discovered foundation in this run.
        await logAction({
          organization_id: context.orgId,
          actor_type: "agent",
          actor_id: context.agentCode,
          action: "discovery.foundation_match_failed",
          resource_type: "pil_agent_runs",
          resource_id: context.runId,
          before_state: null,
          after_state: { foundationName: match.name, ein: match.ein, message: serializePilError(err) },
          policy_decision: null,
          ip_address: null,
        });
        continue;
      }
    }

    const tokensUsed = await tryModelTokens(context, runner, 600);

    const delegations: DelegationRequest[] = [];
    if (ambiguousProspectIds.length > 0) {
      delegations.push({
        childAgentCode: "BEN-SUP-05",
        objective: `Critic review for BEN-DIS-03 foundation identity ambiguity: ${ambiguousProspectIds.join(", ")}`,
        maxAutonomy: "A2" as const,
        constraints: { ambiguousProspectIds, reason: "lifecycle_status_conflicting_or_unknown" },
      });
    }

    return {
      status: "completed",
      evidence: evidenceCreated,
      conclusions: {
        criteria,
        discoveredProspectIds: discoveries.map((d) => d.prospectId),
        discoveries,
      },
      delegations,
      tokensUsed,
      costUsd: tokensUsed * MODEL_TOKEN_UNIT_COST_USD,
      error: null,
    };
  }

  private async discoverFamilyMembers(
    context: AgentContext,
    runner: AgentRunner,
    foundationName: string,
    foundationNode: GraphNode,
    evidenceCreated: EvidenceItem[],
    discoveries: FoundationDiscovery[],
  ): Promise<void> {
    const familySearch = await callTool(context, runner, "web_search", {
      query: `"${foundationName}" family trustees members`,
      limit: 5,
    });
    if (!familySearch.success) return;

    const results = ((familySearch.data as { results?: Array<{ title: string; url: string }> } | null)?.results ?? []);
    for (const item of results) {
      const { prospect: memberProspect, created } = await findOrCreateProspect({
        orgId: context.orgId,
        displayName: item.title,
        entityType: "individual",
        agentCode: context.agentCode,
      });

      evidenceCreated.push(
        await recordDiscoveryEvidence({
          orgId: context.orgId,
          prospectId: memberProspect.id,
          claim: `Family association with ${foundationName}: ${item.title}`,
          value: { title: item.title, url: item.url, foundationName },
          claimType: "family_foundation_association",
          sourceUrl: item.url,
          sourceTitle: item.title,
          sourceType: "open_web",
          publisher: hostnameOf(item.url),
          evidenceExcerpt: null,
          agentCode: context.agentCode,
          researchRunId: context.runId,
          confidence: 0.3,
          verificationStatus: "unverified",
        }),
      );

      const memberNode = await upsertNode({
        organization_id: context.orgId,
        node_type: "person",
        prospect_id: memberProspect.id,
        label: memberProspect.display_name,
        properties: {},
      });
      await upsertEdge({
        organization_id: context.orgId,
        source_node_id: memberNode.id,
        target_node_id: foundationNode.id,
        edge_type: "related_to",
        relationship_strength: "speculative",
        confidence: 0.3,
        temporal_validity_start: null,
        temporal_validity_end: null,
        is_current: true,
        superseded_by_edge_id: null,
        properties: { relationship: "family_member_of_foundation" },
      });

      discoveries.push({ prospectId: memberProspect.id, displayName: memberProspect.display_name, confidence: 0.3, created, lifecycleStatus: "UNKNOWN" });
    }
  }
}

export default FoundationDiscoveryAgent;
