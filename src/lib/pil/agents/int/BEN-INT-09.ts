import type { Agent, AgentContext, AgentResult, AgentRunner } from "@/lib/pil/agent-runner";
import {
  callTool,
  getProspectById,
  hostnameOf,
  looksLikeRoundEstimate,
  MODEL_TOKEN_UNIT_COST_USD,
  recordIntelligenceEvidence,
  tryModelTokens,
} from "@/lib/pil/agents/int/shared";
import { getNodesByProspect, traverseGraph } from "@/lib/pil/graph";
import type { EvidenceItem, GraphNode } from "@/lib/pil/types";

// BEN-INT-09 -- Wealth Origin & Liquidity Event Agent
// (PROSPECT_INTELLIGENCE_AGENTS.md line ~560). Explains, with citations, the
// documented mechanisms through which substantial wealth or liquidity
// appears to have arisen -- a causal chain (ownership stake -> company sale
// / acquisition / IPO), each link labeled VERIFIED/INFERRED/UNKNOWN, never
// silently filled in.
//
// The task spec that commissioned this batch called this code "Giving
// History Intelligence" -- the live registry has no such content at
// BEN-INT-09; that code is "Wealth Origin & Liquidity Event Agent", and
// giving history is already implemented at BEN-INT-07. The task also asked
// for BEN-INT-10 through BEN-INT-15 as five further agents (Wealth
// Indicator, Liquidity Event, Geographic, Contact, Cause Interest, News and
// Trigger). PROSPECT_INTELLIGENCE_AGENTS.md's "Core Prospect Intelligence"
// family is fixed at 10 agents (BEN-INT-01..BEN-INT-10; Fleet Summary table,
// line ~1062) and migration 155_pil_agent_registry.sql's INSERT list jumps
// directly from BEN-INT-10 to BEN-REL-01 -- there is no BEN-INT-11 through
// BEN-INT-15 anywhere in the spec, architecture doc, or registry. Per this
// codebase's established registry-wins pattern, this file implements the
// real BEN-INT-09; BEN-INT-10 is implemented separately as the real Contact
// Intelligence Agent, and BEN-INT-11..15 are not built since they do not
// exist in the 44-agent fleet.
//
// Permitted tools per spec: T-WEB, T-EDGAR, T-NEWS, T-EVIDENCE (write). No
// T-GRAPH -- this agent only ever writes evidence, matching spec exactly.
// No T-EDGAR tool is registered in tools/index.ts (same gap noted in
// BEN-INT-03's header), so the EDGAR-scoped step below is a web_search query
// scoped toward SEC filing language rather than a parsed filing.

type ChainLabel = "VERIFIED" | "INFERRED" | "UNKNOWN";

interface ChainLink {
  step: string;
  label: ChainLabel;
  description: string;
  sourceUrl: string | null;
  sourceTitle: string | null;
}

function classifyEventStep(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("ipo") || lower.includes("initial public offering")) return "ipo";
  if (lower.includes("acqui")) return "acquisition";
  if (lower.includes("sold") || lower.includes("sale")) return "company_sale";
  return "liquidity_event";
}

export class WealthOriginLiquidityEventAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    if (!context.prospectId) {
      return this.completedEmpty("BEN-INT-09 requires an existing prospectId");
    }
    const prospect = await getProspectById(context.orgId, context.prospectId);
    if (!prospect) {
      return this.completedEmpty(`Prospect ${context.prospectId} not found`);
    }

    const evidenceCreated: EvidenceItem[] = [];

    // Chain root: this prospect's documented ownership stakes, per spec's
    // input "Business ownership history (BEN-INT-03)" -- read from the graph
    // BEN-INT-03 already wrote rather than re-searched here.
    const personNodes = await getNodesByProspect(prospect.id, context.orgId);
    const personNode = personNodes.find((n) => n.node_type === "person");

    let ownedCompanies: GraphNode[] = [];
    if (personNode) {
      const { nodes, edges } = await traverseGraph(personNode.id, 1, context.orgId);
      const ownsEdges = edges.filter((e) => e.source_node_id === personNode.id && e.edge_type === "owns");
      ownedCompanies = ownsEdges
        .map((e) => nodes.find((n) => n.id === e.target_node_id))
        .filter((n): n is GraphNode => Boolean(n));
    }

    const chainTargets = ownedCompanies.length > 0 ? ownedCompanies : [null];

    for (const company of chainTargets) {
      const chain: ChainLink[] = [];

      if (company) {
        chain.push({
          step: "ownership_stake",
          label: "INFERRED",
          description: `${prospect.display_name} held a documented ownership/founder stake in ${company.label} (per BEN-INT-03)`,
          sourceUrl: null,
          sourceTitle: null,
        });
      } else {
        chain.push({
          step: "ownership_stake",
          label: "UNKNOWN",
          description: "No documented ownership stake on file for this prospect (BEN-INT-03 has not linked an owned company)",
          sourceUrl: null,
          sourceTitle: null,
        });
      }

      const subjectPhrase = company ? `"${company.label}"` : `"${prospect.display_name}"`;
      const newsResult = await callTool(context, runner, "news_search", {
        query: `${subjectPhrase} acquired OR acquisition OR "sold to" OR IPO OR "initial public offering" OR "company sale"`,
        limit: 3,
      });
      const newsResults = newsResult.success
        ? ((newsResult.data as { results?: Array<{ title: string; url: string; source: string }> } | null)?.results ?? [])
        : [];

      // T-EDGAR substitution (no T-EDGAR tool registered -- see file header).
      const edgarResult = await callTool(context, runner, "web_search", {
        query: `${subjectPhrase} SEC EDGAR "Schedule 13D" OR "Form 4" OR "S-1" acquisition OR merger`,
        limit: 3,
      });
      const edgarResults = edgarResult.success
        ? ((edgarResult.data as { results?: Array<{ title: string; url: string }> } | null)?.results ?? [])
        : [];

      const found = newsResults[0] ?? edgarResults[0] ?? null;
      if (found) {
        const isRoundEstimate = looksLikeRoundEstimate(found.title);
        chain.push({
          step: classifyEventStep(found.title),
          // Neither a parsed filing nor a confirmed sale price is available
          // (no T-EDGAR/T-990 parse here) -- a news/search mention never
          // earns VERIFIED, per spec's distinction between a documented and
          // a rumored/estimated figure.
          label: "INFERRED",
          description: isRoundEstimate
            ? `Liquidity event reported (round/estimated figure, unconfirmed by filing): ${found.title}`
            : `Liquidity event reported: ${found.title}`,
          sourceUrl: found.url,
          sourceTitle: found.title,
        });
      } else {
        chain.push({
          step: "liquidity_event",
          label: "UNKNOWN",
          description: company
            ? `No documented liquidity event found for the ${company.label} ownership stake -- chain stops here rather than assuming one`
            : "No documented liquidity event found -- chain stops here rather than assuming one",
          sourceUrl: null,
          sourceTitle: null,
        });
      }

      const lastCitedLink = [...chain].reverse().find((l) => l.sourceUrl);
      const confidence = found ? 0.4 : 0.15;

      evidenceCreated.push(
        await recordIntelligenceEvidence({
          orgId: context.orgId,
          prospectId: prospect.id,
          claim: `Wealth origin chain${company ? ` via ${company.label}` : ""}: ${chain.map((l) => `${l.step}[${l.label}]`).join(" -> ")}`,
          value: { chain },
          claimType: "liquidity_event",
          sourceUrl: lastCitedLink?.sourceUrl ?? null,
          sourceTitle: lastCitedLink?.sourceTitle ?? null,
          sourceType: found ? (newsResults[0] ? "news" : "open_web") : "internal",
          publisher: lastCitedLink?.sourceUrl ? hostnameOf(lastCitedLink.sourceUrl) : null,
          evidenceExcerpt: null,
          agentCode: context.agentCode,
          researchRunId: context.runId,
          confidence,
          verificationStatus: found ? "reasoned_inference" : "unverified",
        }),
      );
    }

    const tokensUsed = await tryModelTokens(context, runner, 500);

    return {
      status: "completed",
      evidence: evidenceCreated,
      conclusions: { prospectId: prospect.id, chainsBuilt: evidenceCreated.length, ownedCompaniesFound: ownedCompanies.length },
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

export default WealthOriginLiquidityEventAgent;
