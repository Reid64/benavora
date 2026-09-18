import type { Agent, AgentContext, AgentResult, AgentRunner } from "@/lib/pil/agent-runner";
import { getPilClient, pilProspects } from "@/lib/pil/db";
import { getEvidence } from "@/lib/pil/evidence";
import { getNodesByProspect, getEdges } from "@/lib/pil/graph";
import { logAction } from "@/lib/pil/audit";
import type { Prospect } from "@/lib/pil/types";
import { pilBlendedTokenRateUsd, PIL_AGENT_MODEL } from "@/lib/pil/model-pricing";

// BEN-SUP-08 -- Executive Intelligence Narrative Agent
// Synthesizes a completed prospect research run's evidence and knowledge
// graph into a structured dossier, with verified facts and inferred
// conclusions kept explicitly separate. Not part of
// PROSPECT_INTELLIGENCE_AGENTS.md's documented Family 1 6-agent list -- see
// BEN-SUP-07.ts's header for why this and BEN-SUP-07 are registered as
// additions in migration 163.
//
// Deliberately does not call the Claude API (unlike the /api/pil/discover
// route) -- every other Family 1 agent in this codebase (BEN-SUP-01..04)
// synthesizes deterministically and only tracks T-MODEL token cost via
// tryUseTool, never calling out to a real model from agent code itself. This
// keeps the narrative's fact/inference separation guarantee mechanical
// (every sentence traces to a specific pil_evidence row) rather than
// dependent on an LLM call reliably following that instruction.

const INFERRED_VERIFICATION_STATUSES = new Set(["reasoned_inference", "estimate"]);
const LOW_CONFIDENCE_THRESHOLD = 0.4;
const HIGH_CONFIDENCE_THRESHOLD = 0.6;

export interface DossierFact {
  evidenceId: string;
  claim: string;
  claimType: string;
  confidence: number;
  sourceUrl: string | null;
}

export interface DossierInference extends DossierFact {
  evidenceChain: string[];
}

export interface DossierRelationship {
  edgeId: string;
  from: string;
  to: string;
  edgeType: string;
  strength: string | null;
  confidence: number | null;
}

export interface ProspectDossier {
  prospectId: string;
  researchRunId: string;
  verifiedFacts: DossierFact[];
  inferences: DossierInference[];
  relationshipPathways: DossierRelationship[];
  recommendedNextActions: string[];
  overallConfidence: number;
}

export class ExecutiveIntelligenceNarrativeAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    const prospectId = context.prospectId;
    if (!prospectId) {
      return {
        status: "failed",
        evidence: [],
        conclusions: {},
        delegations: [],
        tokensUsed: 0,
        costUsd: 0,
        error: "BEN-SUP-08 requires context.prospectId",
      };
    }

    // 1. Receive the completed research run's evidence and graph.
    const [prospect, evidence, nodes] = await Promise.all([
      this.loadProspect(context.orgId, prospectId),
      getEvidence(prospectId, context.orgId),
      getNodesByProspect(prospectId, context.orgId),
    ]);
    const edgeLists = await Promise.all(nodes.map((node) => getEdges(node.id)));
    const edges = edgeLists.flat();
    const nodeById = new Map(nodes.map((node) => [node.id, node]));

    // 2/3. Separate verified facts from inferred conclusions; every claim
    // cites its source and carries its confidence score.
    const verifiedFacts: DossierFact[] = [];
    const inferences: DossierInference[] = [];
    for (const item of evidence) {
      const fact: DossierFact = {
        evidenceId: item.id,
        claim: item.claim,
        claimType: item.claim_type,
        confidence: item.confidence,
        sourceUrl: item.source_url,
      };
      const isInference = item.inference_status === "inferred" || INFERRED_VERIFICATION_STATUSES.has(item.verification_status);
      if (isInference) {
        // Evidence chain: this row plus any prior lineage entries it
        // recorded (pil_evidence.lineage, migration 153) -- the applied
        // schema has no separate derivation-graph table, so lineage is the
        // full chain available for an inference to cite.
        const lineageIds = Array.isArray(item.lineage) ? item.lineage.map((entry) => String(entry)) : [];
        inferences.push({ ...fact, evidenceChain: [item.id, ...lineageIds] });
      } else {
        verifiedFacts.push(fact);
      }
    }

    const relationshipPathways: DossierRelationship[] = edges.map((edge) => ({
      edgeId: edge.id,
      from: nodeById.get(edge.source_node_id)?.label ?? edge.source_node_id,
      to: nodeById.get(edge.target_node_id)?.label ?? edge.target_node_id,
      edgeType: edge.edge_type,
      strength: edge.relationship_strength,
      confidence: edge.confidence,
    }));

    const overallConfidence = evidence.length > 0 ? Number((evidence.reduce((sum, item) => sum + item.confidence, 0) / evidence.length).toFixed(2)) : 0;
    const recommendedNextActions = this.recommendActions(verifiedFacts, inferences, relationshipPathways, overallConfidence);

    const dossier: ProspectDossier = {
      prospectId,
      researchRunId: context.runId,
      verifiedFacts,
      inferences,
      relationshipPathways,
      recommendedNextActions,
      overallConfidence,
    };

    const narrativeText = this.buildNarrative(prospect, dossier);

    const tokensUsed = await this.tryUseTool(context, runner, "T-MODEL", 300);

    // 4. Write the dossier to pil_prospect_dossiers.
    const saved = await this.saveDossier(context, prospectId, dossier, narrativeText);

    await logAction({
      organization_id: context.orgId,
      actor_type: "agent",
      actor_id: context.agentCode,
      action: "narrative.dossier_generated",
      resource_type: "pil_prospect_dossiers",
      resource_id: saved.id,
      before_state: null,
      after_state: { prospectId, version: saved.version, factCount: verifiedFacts.length, inferenceCount: inferences.length },
      policy_decision: null,
      ip_address: null,
    });

    // 5. Return the dossier as the agent result.
    return {
      status: "completed",
      evidence: [],
      conclusions: { dossier, narrativeText, dossierId: saved.id, version: saved.version },
      delegations: [],
      tokensUsed,
      costUsd: 0, // AR-10.1: real cost already recorded per-call in ai_usage_log by useTool()/T-MODEL via model-pricing.ts; recording it again here would double-count the same tokens.
      error: null,
    };
  }

  private recommendActions(
    verifiedFacts: DossierFact[],
    inferences: DossierInference[],
    relationshipPathways: DossierRelationship[],
    overallConfidence: number,
  ): string[] {
    const actions: string[] = [];
    if (verifiedFacts.length === 0 && inferences.length === 0) {
      actions.push("Insufficient evidence on file -- continue research before any engagement decision.");
      return actions;
    }
    if (overallConfidence < LOW_CONFIDENCE_THRESHOLD) {
      actions.push("Overall evidence confidence is low -- commission additional verification before engagement.");
    }
    if (inferences.length > 0) {
      actions.push(`Treat ${inferences.length} capacity/wealth-adjacent conclusion(s) as inference only until independently corroborated.`);
    }
    if (relationshipPathways.length > 0) {
      actions.push("Evaluate identified relationship pathways for a warm introduction before a cold approach.");
    }
    if (overallConfidence >= HIGH_CONFIDENCE_THRESHOLD && inferences.length === 0) {
      actions.push("Evidence base is strong -- proceed to qualification and engagement strategy.");
    }
    return actions;
  }

  private buildNarrative(prospect: Prospect | null, dossier: ProspectDossier): string {
    const name = prospect?.display_name ?? dossier.prospectId;
    const lines: string[] = [];
    lines.push(`Executive Intelligence Summary -- ${name}`, "");
    lines.push(`VERIFIED FACTS (${dossier.verifiedFacts.length}):`);
    for (const fact of dossier.verifiedFacts) {
      lines.push(`- ${fact.claim} [confidence ${fact.confidence.toFixed(2)}]${fact.sourceUrl ? ` (source: ${fact.sourceUrl})` : ""}`);
    }
    lines.push("", `INFERENCES -- NOT CONFIRMED FACT (${dossier.inferences.length}):`);
    for (const inference of dossier.inferences) {
      lines.push(`- [INFERENCE] ${inference.claim} [confidence ${inference.confidence.toFixed(2)}] evidence chain: ${inference.evidenceChain.join(" -> ")}`);
    }
    lines.push("", `RELATIONSHIP PATHWAYS (${dossier.relationshipPathways.length}):`);
    for (const rel of dossier.relationshipPathways) {
      lines.push(`- ${rel.from} --[${rel.edgeType}${rel.strength ? `, ${rel.strength}` : ""}]--> ${rel.to}`);
    }
    lines.push("", `OVERALL CONFIDENCE: ${dossier.overallConfidence}`, "", "RECOMMENDED NEXT ACTIONS:");
    for (const action of dossier.recommendedNextActions) lines.push(`- ${action}`);
    return lines.join("\n");
  }

  private async loadProspect(orgId: string, prospectId: string): Promise<Prospect | null> {
    const { data, error } = await pilProspects(orgId).eq("id", prospectId).maybeSingle();
    if (error) throw error;
    return (data as Prospect | null) ?? null;
  }

  private async saveDossier(
    context: AgentContext,
    prospectId: string,
    dossier: ProspectDossier,
    narrativeText: string,
  ): Promise<{ id: string; version: number }> {
    const client = getPilClient();
    const { data: existing, error: findError } = await client
      .from("pil_prospect_dossiers")
      .select("version")
      .eq("organization_id", context.orgId)
      .eq("prospect_id", prospectId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (findError) throw findError;

    const version = ((existing as { version: number } | null)?.version ?? 0) + 1;

    const { data, error } = await client
      .from("pil_prospect_dossiers")
      .insert({
        organization_id: context.orgId,
        prospect_id: prospectId,
        research_run_id: context.runId,
        dossier,
        narrative_text: narrativeText,
        generated_at: new Date().toISOString(),
        version,
      })
      .select("id, version")
      .single();
    if (error) throw error;
    return data as { id: string; version: number };
  }

  private async tryUseTool(context: AgentContext, runner: AgentRunner, tool: string, units: number): Promise<number> {
    if (!context.tools.includes(tool)) return 0;
    try {
      const rate = await pilBlendedTokenRateUsd();
      await runner.useTool(context, tool, { unitCost: rate, units, costType: "model_tokens", model: PIL_AGENT_MODEL });
      return units;
    } catch {
      return 0;
    }
  }
}

export default ExecutiveIntelligenceNarrativeAgent;
