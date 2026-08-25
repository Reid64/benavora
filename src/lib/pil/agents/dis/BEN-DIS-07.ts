import type { Agent, AgentContext, AgentResult, AgentRunner } from "@/lib/pil/agent-runner";
import {
  callTool,
  findOrCreateProspect,
  hostnameOf,
  MODEL_TOKEN_UNIT_COST_USD,
  parseGoalCriteria,
  recordDiscoveryEvidence,
  recordProspectClassification,
  tryModelTokens,
} from "@/lib/pil/agents/dis/shared";
import type { EvidenceItem, EvidenceVerificationStatus, ProspectEntityType } from "@/lib/pil/types";

// BEN-DIS-07 -- Cause-Aligned Prospect Discovery Agent
// (PROSPECT_INTELLIGENCE_AGENTS.md "FAMILY 2 -- DISCOVERY"). Discovers
// prospects whose documented charitable interests align with the tenant's
// mission -- news-sourced giving announcements plus open-web statement/board
// signals, each written as a pil_prospect_classifications (dimension='cause')
// row per spec's explicit output requirement.
//
// The task spec that commissioned this batch numbered this mission "STEP 3"
// under the code BEN-DIS-08. The live registry
// (supabase/migrations/155_pil_agent_registry.sql) and
// PROSPECT_INTELLIGENCE_AGENTS.md both assign "Cause-Aligned Prospect
// Discovery Agent" to BEN-DIS-07 -- see BEN-DIS-06.ts's file header for the
// full reconciliation. This file implements BEN-DIS-07 per the live
// registry.
//
// Permitted tools per spec: T-WEB, T-990, T-NEWS, T-GRAPH (write),
// T-EVIDENCE (write). Notably NOT T-PUBREC -- entity_lookup (the only
// name-to-EIN resolver this codebase has, tools/entity-lookup.ts) is
// unavailable to this agent, so T-990 usage is limited to EINs a caller
// supplies directly via context.plan.foundationEins (matching the
// established convention of a delegating parent handing down structured
// plan data, e.g. BEN-DIS-05's context.plan.companyProspectIds) -- there is
// no standalone name-to-EIN path available under this agent's own granted
// tools.
//
// Mission rule (spec): "Requires at least one documented giving/board/
// statement signal per cause tag -- never tags a prospect to a cause on
// inferred affinity alone at discovery stage." Every classification row
// written here is backed by a concrete evidence row from an actual search
// result, never asserted from criteria alone. A cause tag is only written
// when a concrete cause string is resolved; if none is resolvable, this
// agent still returns discovered candidates as ordinary discovery evidence
// but omits the classification write (a dimension='cause' row requires a
// non-null value).

const STALE_SIGNAL_YEARS = 5;
const STALE_SIGNAL_CONFIDENCE = 0.3;
const FRESH_SIGNAL_CONFIDENCE = 0.5;

function isStaleSignal(publishedAt: string | null): boolean {
  if (!publishedAt) return false;
  const published = new Date(publishedAt);
  if (Number.isNaN(published.getTime())) return false;
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - STALE_SIGNAL_YEARS);
  return published < cutoff;
}

function inferCauseCandidateEntityType(name: string): ProspectEntityType {
  const lower = name.toLowerCase();
  if (lower.includes("foundation")) return "private_foundation";
  if (/\b(corp|corporation|company|inc)\b/.test(lower)) return "corporation";
  return "individual";
}

interface CauseDiscovery {
  prospectId: string;
  displayName: string;
  confidence: number;
  created: boolean;
  stale: boolean;
}

export class CauseAlignedProspectDiscoveryAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    const criteria = parseGoalCriteria(context.goal);
    const planCause = (context.plan as { cause?: string } | null)?.cause;
    const cause = criteria.cause ?? (typeof planCause === "string" ? planCause : null);

    const evidenceCreated: EvidenceItem[] = [];
    const discoveries: CauseDiscovery[] = [];
    const staleSignalOnly: string[] = [];

    // 1. News-sourced cause-aligned giving announcements.
    const newsResult = await callTool(context, runner, "news_search", {
      query: `${cause ?? ""} donation OR gift OR grant announcement`.trim(),
      limit: 10,
    });
    if (newsResult.success) {
      const results = ((newsResult.data as { results?: Array<{ title: string; url: string; publishedAt: string | null; source: string }> } | null)?.results ?? []);
      for (const item of results) {
        await this.recordCauseSignal(context, {
          displayName: item.title,
          claim: `Cause-aligned giving announcement${cause ? ` (${cause})` : ""}: ${item.title}`,
          claimType: "cause_aligned_giving_announcement",
          sourceUrl: item.url,
          sourceTitle: item.title,
          sourceType: "news",
          publisher: item.source || hostnameOf(item.url),
          publishedAt: item.publishedAt,
          cause,
          evidenceCreated,
          discoveries,
          staleSignalOnly,
        });
      }
    }

    // 2. Open-web cause statements / board involvement mentions.
    const webResult = await callTool(context, runner, "web_search", {
      query: `"${cause ?? ""}" board member OR trustee OR statement philanthropy`.trim(),
      limit: 10,
    });
    if (webResult.success) {
      const results = ((webResult.data as { results?: Array<{ title: string; url: string }> } | null)?.results ?? []);
      for (const item of results) {
        await this.recordCauseSignal(context, {
          displayName: item.title,
          claim: `Cause-aligned statement or board involvement${cause ? ` (${cause})` : ""}: ${item.title}`,
          claimType: "cause_statement_or_board_signal",
          sourceUrl: item.url,
          sourceTitle: item.title,
          sourceType: "open_web",
          publisher: hostnameOf(item.url),
          publishedAt: null,
          cause,
          evidenceCreated,
          discoveries,
          staleSignalOnly,
        });
      }
    }

    // 3. 990 mission-alignment confirmation, only when a caller supplied
    // known EINs (see file header -- no name-to-EIN path is available
    // under this agent's own granted tool set).
    const planEins = (context.plan as { foundationEins?: string[] } | null)?.foundationEins;
    if (Array.isArray(planEins) && cause) {
      for (const ein of planEins) {
        const nineNinety = await callTool(context, runner, "irs_990_lookup", { ein });
        if (!nineNinety.success) continue;
        const data = nineNinety.data as { org_name: string | null; mission: string | null };
        if (!data.mission || !data.mission.toLowerCase().includes(cause.toLowerCase())) continue;
        await this.recordCauseSignal(context, {
          displayName: data.org_name ?? ein,
          claim: `990 mission statement confirms cause alignment (${cause}): ${data.mission}`,
          claimType: "990_mission_cause_alignment",
          sourceUrl: null,
          sourceTitle: data.org_name,
          sourceType: "irs_form_990",
          publisher: "IRS Form 990",
          publishedAt: null,
          cause,
          evidenceCreated,
          discoveries,
          staleSignalOnly,
        });
      }
    }

    const tokensUsed = await tryModelTokens(context, runner, 500);

    return {
      status: "completed",
      evidence: evidenceCreated,
      conclusions: {
        criteria,
        cause,
        discoveredProspectIds: discoveries.map((d) => d.prospectId),
        discoveries,
        staleSignalOnly,
      },
      delegations: [],
      tokensUsed,
      costUsd: tokensUsed * MODEL_TOKEN_UNIT_COST_USD,
      error: null,
    };
  }

  private async recordCauseSignal(
    context: AgentContext,
    params: {
      displayName: string;
      claim: string;
      claimType: string;
      sourceUrl: string | null;
      sourceTitle: string | null;
      sourceType: string;
      publisher: string | null;
      publishedAt: string | null;
      cause: string | null;
      evidenceCreated: EvidenceItem[];
      discoveries: CauseDiscovery[];
      staleSignalOnly: string[];
    },
  ): Promise<void> {
    const stale = isStaleSignal(params.publishedAt);
    const confidence = stale ? STALE_SIGNAL_CONFIDENCE : FRESH_SIGNAL_CONFIDENCE;
    const verificationStatus: EvidenceVerificationStatus = "single_source_fact";

    const { prospect, created } = await findOrCreateProspect({
      orgId: context.orgId,
      displayName: params.displayName,
      entityType: inferCauseCandidateEntityType(params.displayName),
      agentCode: context.agentCode,
    });

    const evidence = await recordDiscoveryEvidence({
      orgId: context.orgId,
      prospectId: prospect.id,
      claim: params.claim,
      value: { displayName: params.displayName, cause: params.cause, publishedAt: params.publishedAt, stale },
      claimType: params.claimType,
      sourceUrl: params.sourceUrl,
      sourceTitle: params.sourceTitle,
      sourceType: params.sourceType,
      publisher: params.publisher,
      evidenceExcerpt: null,
      agentCode: context.agentCode,
      researchRunId: context.runId,
      confidence,
      verificationStatus,
    });
    params.evidenceCreated.push(evidence);

    if (params.cause) {
      await recordProspectClassification({
        orgId: context.orgId,
        prospectId: prospect.id,
        dimension: "cause",
        value: params.cause,
        confidence,
        evidenceId: evidence.id,
      });
    }

    if (stale) params.staleSignalOnly.push(prospect.id);

    params.discoveries.push({
      prospectId: prospect.id,
      displayName: prospect.display_name,
      confidence,
      created,
      stale,
    });
  }
}

export default CauseAlignedProspectDiscoveryAgent;
