import type { Agent, AgentContext, AgentResult, AgentRunner } from "@/lib/pil/agent-runner";
import {
  callTool,
  getProspectById,
  hostnameOf,
  MODEL_TOKEN_UNIT_COST_USD,
  recordIntelligenceEvidence,
  tryModelTokens,
  upsertCounterpartyNode,
  upsertProspectNode,
} from "@/lib/pil/agents/int/shared";
import { upsertEdge } from "@/lib/pil/graph";
import type { EvidenceItem, ProspectEntityType } from "@/lib/pil/types";

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
      }
    }

    const tokensUsed = await tryModelTokens(context, runner, 500);

    return {
      status: "completed",
      evidence: evidenceCreated,
      conclusions: { prospectId: prospect.id, ein },
      delegations: [],
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
