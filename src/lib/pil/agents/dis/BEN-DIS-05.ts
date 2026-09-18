import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import {
  callTool,
  findOrCreateProspect,
  hostnameOf,
  parseGoalCriteria,
  recordDiscoveryEvidence,
  tryModelTokens,
} from "@/lib/pil/agents/dis/shared";
import { logAction } from "@/lib/pil/audit";
import { getPilClient } from "@/lib/pil/db";
import { upsertEdge, upsertNode } from "@/lib/pil/graph";
import type { EvidenceItem } from "@/lib/pil/types";
import { serializePilError } from "@/lib/pil/serialize-error";

// Shared Discovery-family delegation cap (PIL_AGENT_COMPLETE_ROSTER.md's
// max_delegation_depth/budget-bounded language, A2 default autonomy):
// canonicalization/relationship-strength follow-on delegations below are
// bounded to the top-N discoveries by this run's own ranking rather than
// one delegation per discovery, which could be unbounded.
const MAX_DELEGATION_CANDIDATES = 5;

// BEN-DIS-05 -- Executive Prospect Discovery Agent
// (PROSPECT_INTELLIGENCE_AGENTS.md "FAMILY 2 -- DISCOVERY"). Identifies
// executives, founders, owners, and senior decision-makers who may have
// philanthropic relevance, linked to their companies via
// pil_graph_edges(edge_type='employed_by'). See BEN-DIS-03.ts's file
// header for why this agent code carries the executive-discovery mission
// (the task spec that commissioned this batch mislabeled it under
// BEN-DIS-04) rather than "Family Foundation Discovery" -- there is no
// such agent code in the live registry.
//
// Inputs (spec): "Corporate candidates from BEN-DIS-04, geographic/cause
// strategy." AgentRunner.delegate() does not currently forward a parent's
// DelegationRequest.constraints into the child AgentContext.plan (it hands
// the child a fresh `plan: {}` -- agent-runner.ts's own delegate() method),
// so a direct BEN-DIS-04 -> BEN-DIS-05 delegation carries only the
// objective string, not structured company IDs. This agent reads
// context.plan.companyProspectIds when a caller supplies it directly
// (matching BEN-SUP-05's context.plan.targetAgentRunId convention) but
// always falls back to discovering target companies itself from
// geography/cause so it functions standalone, matching its own spec cadence
// ("Continuous / on demand").
//
// Permitted tools per spec: T-WEB, T-CRAWL, T-GRAPH (read/write),
// T-EVIDENCE (write).

interface ExecutiveDiscovery {
  prospectId: string;
  displayName: string;
  confidence: number;
  created: boolean;
  boardInvolvementFlagged: boolean;
}

export class ExecutiveProspectDiscoveryAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    if (context.goal.trim().length === 0) {
      return {
        status: "completed",
        evidence: [],
        conclusions: { skipped: true, reason: "BEN-DIS-05 requires a non-empty goal" },
        delegations: [],
        tokensUsed: 0,
        costUsd: 0,
        error: null,
      };
    }

    const criteria = parseGoalCriteria(context.goal);
    const evidenceCreated: EvidenceItem[] = [];
    const discoveries: ExecutiveDiscovery[] = [];

    const targetCompanies = await this.resolveTargetCompanies(context, runner);

    for (const company of targetCompanies) {
      try {
        // Prioritize executives with a documented external nonprofit-board
        // seat -- search for that signal alongside the base leadership search
        // rather than as an afterthought (spec's own planning behavior).
        const execSearch = await callTool(context, runner, "web_search", {
          query: `"${company.name}" CEO OR founder OR president OR chairman`,
          limit: 5,
        });
        if (!execSearch.success) continue;

        const execResults = ((execSearch.data as { results?: Array<{ title: string; url: string }> } | null)?.results ?? []);

        const companyNode = await upsertNode({
          organization_id: context.orgId,
          node_type: "company",
          prospect_id: company.prospectId,
          label: company.name,
          properties: {},
        });

        for (const item of execResults) {
          const { prospect: execProspect, created } = await findOrCreateProspect({
            orgId: context.orgId,
            displayName: item.title,
            entityType: "executive",
            agentCode: context.agentCode,
          });

          evidenceCreated.push(
            await recordDiscoveryEvidence({
              orgId: context.orgId,
              prospectId: execProspect.id,
              claim: `Current leadership role at ${company.name}: ${item.title}`,
              value: { title: item.title, url: item.url, company: company.name },
              claimType: "executive_role_mention",
              sourceUrl: item.url,
              sourceTitle: item.title,
              sourceType: "corporate_information",
              publisher: hostnameOf(item.url),
              evidenceExcerpt: null,
              agentCode: context.agentCode,
              researchRunId: context.runId,
              confidence: 0.45,
              verificationStatus: "single_source_fact",
            }),
          );

          const execNode = await upsertNode({
            organization_id: context.orgId,
            node_type: "person",
            prospect_id: execProspect.id,
            label: execProspect.display_name,
            properties: {},
          });
          await upsertEdge({
            organization_id: context.orgId,
            source_node_id: execNode.id,
            target_node_id: companyNode.id,
            edge_type: "employed_by",
            relationship_strength: "strong",
            confidence: 0.45,
            temporal_validity_start: null,
            temporal_validity_end: null,
            is_current: true,
            superseded_by_edge_id: null,
            properties: { company: company.name },
          });

          // Nonprofit-board involvement flag -- the strongest early
          // philanthropic-relevance signal available at discovery stage.
          const boardSearch = await callTool(context, runner, "web_search", {
            query: `"${item.title}" nonprofit board OR trustee`,
            limit: 3,
          });
          let boardInvolvementFlagged = false;
          if (boardSearch.success) {
            const boardResults = ((boardSearch.data as { results?: Array<{ title: string; url: string }> } | null)?.results ?? []);
            if (boardResults.length > 0) {
              boardInvolvementFlagged = true;
              evidenceCreated.push(
                await recordDiscoveryEvidence({
                  orgId: context.orgId,
                  prospectId: execProspect.id,
                  claim: `Nonprofit board/trustee involvement flagged: ${boardResults[0]?.title}`,
                  value: { results: boardResults },
                  claimType: "nonprofit_board_involvement_flag",
                  sourceUrl: boardResults[0]?.url ?? null,
                  sourceTitle: boardResults[0]?.title ?? null,
                  sourceType: "open_web",
                  publisher: boardResults[0] ? hostnameOf(boardResults[0].url) : null,
                  evidenceExcerpt: null,
                  agentCode: context.agentCode,
                  researchRunId: context.runId,
                  confidence: 0.35,
                  verificationStatus: "unverified",
                }),
              );
            }
          }

          discoveries.push({
            prospectId: execProspect.id,
            displayName: execProspect.display_name,
            confidence: boardInvolvementFlagged ? 0.6 : 0.45,
            created,
            boardInvolvementFlagged,
          });
        }
      } catch (err) {
        // Recovery protocol: one company's search/write failure must not
        // discard every executive already discovered from other companies
        // in this same run.
        const message = serializePilError(err);
        await logAction({
          organization_id: context.orgId,
          actor_type: "agent",
          actor_id: context.agentCode,
          action: "discovery.company_processing_failed",
          resource_type: "pil_agent_runs",
          resource_id: context.runId,
          before_state: null,
          after_state: { company: company.name, message },
          policy_decision: null,
          ip_address: null,
        });
        continue;
      }
    }

    // Rank by board-involvement priority, then confidence only -- this
    // ranking deliberately excludes company/title/any other prohibited
    // feature (title prestige, employer size, inferred protected traits,
    // name origin, age/neighborhood proxy, presumed gender) per the spec's
    // fairness/privacy gate. Do not "improve" this comparator with a
    // company-size or title-prestige weight.
    discoveries.sort((a, b) => (Number(b.boardInvolvementFlagged) - Number(a.boardInvolvementFlagged)) || b.confidence - a.confidence);

    // Delegation chaining, budget-bounded to the top N discoveries by this
    // run's own ranking (see MAX_DELEGATION_CANDIDATES) rather than one
    // delegation per discovery, which could be unbounded:
    //  - BEN-INT-01 canonicalization, only for genuinely new prospects this
    //    run (created === true) -- an already-known person is not
    //    re-triggered every run.
    //  - BEN-REL-01 relationship-strength resolution, for entries whose
    //    nonprofit board/trustee involvement was flagged -- relationship
    //    strength remains UNKNOWN until BEN-REL-01 resolves it.
    const delegations: DelegationRequest[] = [];
    const delegationCandidates = discoveries.slice(0, MAX_DELEGATION_CANDIDATES);
    for (const d of delegationCandidates) {
      if (d.created) {
        delegations.push({
          childAgentCode: "BEN-INT-01",
          objective: `Approve canonicalization and build a verified individual dossier for executive prospect ${d.prospectId} (${d.displayName})`,
          maxAutonomy: "A2" as const,
          constraints: { prospectId: d.prospectId },
        });
      }
      if (d.boardInvolvementFlagged) {
        delegations.push({
          childAgentCode: "BEN-REL-01",
          objective: `Resolve relationship strength for the nonprofit board/trustee involvement flagged on prospect ${d.prospectId}`,
          maxAutonomy: "A2" as const,
          constraints: { prospectId: d.prospectId },
        });
      }
    }

    const tokensUsed = await tryModelTokens(context, runner, 500);

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
      costUsd: 0, // AR-10.1: real cost already recorded per-call in ai_usage_log by useTool()/T-MODEL via model-pricing.ts (called inside tryModelTokens); recording it again here would double-count the same tokens.
      error: null,
    };
  }

  private async resolveTargetCompanies(
    context: AgentContext,
    runner: AgentRunner,
  ): Promise<Array<{ name: string; prospectId: string | null }>> {
    const planCompanyIds = (context.plan as { companyProspectIds?: string[] } | null)?.companyProspectIds;
    if (Array.isArray(planCompanyIds) && planCompanyIds.length > 0) {
      const { data, error } = await getPilClient()
        .from("pil_prospects")
        .select("*")
        .eq("organization_id", context.orgId)
        .in("id", planCompanyIds);
      if (error) throw error;
      return ((data ?? []) as Array<{ id: string; display_name: string }>).map((row) => ({ name: row.display_name, prospectId: row.id }));
    }

    // Standalone fallback (no delegated company list available -- see file
    // header): discover target companies directly from geography/cause
    // strategy. These companies aren't yet pil_prospects rows -- this
    // agent's mission is executives, not corporations (that's BEN-DIS-04) --
    // so prospectId stays null; the graph node below is still valid with a
    // null prospect_id (same pattern as BEN-DIS-03's cause/geography nodes).
    const criteria = parseGoalCriteria(context.goal);
    const locationPhrase = [criteria.geography, criteria.cause].filter(Boolean).join(" ");
    const companySearch = await callTool(context, runner, "web_search", {
      query: `companies ${locationPhrase}`.trim(),
      limit: 5,
    });
    if (!companySearch.success) return [];
    const results = ((companySearch.data as { results?: Array<{ title: string }> } | null)?.results ?? []);
    return results.map((r) => ({ name: r.title, prospectId: null }));
  }
}

export default ExecutiveProspectDiscoveryAgent;
