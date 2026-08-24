import type { Agent, AgentContext, AgentResult, AgentRunner } from "@/lib/pil/agent-runner";
import { getPilClient } from "@/lib/pil/db";
import { getEvidence } from "@/lib/pil/evidence";
import { getNodesByProspect, getEdges } from "@/lib/pil/graph";
import { logAction } from "@/lib/pil/audit";
import { createReviewItem } from "@/lib/pil/human-review";
import type { AgentRun, EvidenceItem, PolicyDecisionOutcome, ProspectIdentity } from "@/lib/pil/types";

// BEN-SUP-05 -- Prospect Research Critic & Red-Team Agent
// (PROSPECT_INTELLIGENCE_AGENTS.md "FAMILY 1 -- SUPERVISORY & ORCHESTRATION").
// Independently challenges a producing agent's consequential findings before
// they become trusted intelligence (spec §12: a research-producing agent
// cannot certify its own high-impact conclusions). This agent's memory scope
// is deliberately "run" -- fresh context per review, no memory of the
// producing agent's reasoning by design. In practice that separation is
// structural, not a discipline this code has to enforce: pil_agent_runs.output
// IS the producing agent's conclusions (there is no separate reasoning-trace
// column anywhere in the schema), so reading that column can only ever surface
// conclusions and evidence, never the producing agent's internal reasoning.
//
// Invocation contract: context.plan.targetAgentRunId identifies the completed
// pil_agent_runs row under review; context.prospectId identifies the prospect
// whose pil_evidence/pil_graph_* the review is scored against.

const MODEL_TOKEN_UNIT_COST_USD = 0.00002;
const MIN_CONFIDENCE = 0.3;
const SPECULATIVE_CONFIDENCE_CEILING = 0.4;

export type CriticVerdict =
  | "PASS"
  | "PASS_WITH_CAVEATS"
  | "RESEARCH_MORE"
  | "BLOCK_INSUFFICIENT_EVIDENCE"
  | "BLOCK_ENTITY_AMBIGUITY"
  | "BLOCK_POLICY";

export interface FactClaim {
  claimType: string;
  evidenceId: string;
}

export interface ClaimEvaluation {
  evidenceId: string;
  claimType: string;
  failedChecks: string[];
  pass: boolean;
}

export interface CriticReport {
  targetAgentRunId: string;
  prospectId: string | null;
  claims: ClaimEvaluation[];
  duplicateIdentityRisk: boolean;
  relationshipIssues: string[];
  verdict: CriticVerdict;
  summary: string;
}

export class ProspectResearchCriticAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    const targetAgentRunId = (context.plan as { targetAgentRunId?: string } | null)?.targetAgentRunId ?? null;
    if (!targetAgentRunId) {
      return {
        status: "failed",
        evidence: [],
        conclusions: {},
        delegations: [],
        tokensUsed: 0,
        costUsd: 0,
        error: "BEN-SUP-05 requires context.plan.targetAgentRunId identifying the run under review",
      };
    }

    // 1. Receive the completed producing run -- conclusions and evidence only.
    const targetRun = await this.loadAgentRun(targetAgentRunId);
    const assertedFacts = (targetRun?.output as { assertedFacts?: FactClaim[] } | null)?.assertedFacts ?? [];

    const evidence = context.prospectId ? await getEvidence(context.prospectId, context.orgId) : [];

    // 2/3. Independently evaluate evidence quality for each claim.
    const claims = evidence.map((item) => this.evaluateClaim(item, assertedFacts));

    const relationshipIssues = context.prospectId ? await this.checkRelationships(context.prospectId, context.orgId) : [];
    const duplicateIdentityRisk = context.prospectId ? await this.checkDuplicateIdentity(context.orgId, context.prospectId) : false;

    const tokensUsed = await this.tryUseTool(context, runner, "T-MODEL", 120);

    const verdict = this.decideVerdict(claims, relationshipIssues, duplicateIdentityRisk, evidence.length);
    const summary = this.summarize(verdict, claims, relationshipIssues, duplicateIdentityRisk);

    const report: CriticReport = {
      targetAgentRunId,
      prospectId: context.prospectId,
      claims,
      duplicateIdentityRisk,
      relationshipIssues,
      verdict,
      summary,
    };

    await logAction({
      organization_id: context.orgId,
      actor_type: "agent",
      actor_id: context.agentCode,
      action: "critic.verdict_issued",
      resource_type: "pil_agent_runs",
      resource_id: targetAgentRunId,
      before_state: null,
      after_state: { report },
      policy_decision: null,
      ip_address: null,
    });

    // 6. Record the critic decision to pil_policy_decisions.
    await this.recordDecision(context, targetAgentRunId, verdict, summary);

    // 5. On any BLOCK_* verdict, create a HumanReviewItem with the specific failures.
    if (verdict.startsWith("BLOCK_")) {
      await createReviewItem({
        organization_id: context.orgId,
        review_type: "critic_block",
        subject_type: "pil_agent_runs",
        subject_id: targetAgentRunId,
        requested_by_agent_id: context.agentCode,
        priority: verdict === "BLOCK_POLICY" ? "urgent" : "high",
        status: "pending",
        summary,
        evidence_refs: claims.filter((c) => !c.pass).map((c) => c.evidenceId),
        assigned_to_user_id: null,
        resolved_at: null,
      });
    }

    return {
      status: verdict.startsWith("BLOCK_") ? "escalated" : "completed",
      evidence: [],
      conclusions: { report },
      delegations: [],
      tokensUsed,
      costUsd: tokensUsed * MODEL_TOKEN_UNIT_COST_USD,
      error: null,
    };
  }

  private evaluateClaim(item: EvidenceItem, assertedFacts: FactClaim[]): ClaimEvaluation {
    const failedChecks: string[] = [];

    // Insufficient evidence.
    if (item.confidence < MIN_CONFIDENCE) failedChecks.push("insufficient_evidence");

    // Stale evidence. pil_source_registry (migration 157) has no
    // freshness_ttl_hours column for retrieved_at to be compared against --
    // the applied schema instead computes per-evidence staleness directly
    // onto pil_evidence.freshness_status (migration 153), which is what this
    // check reads.
    if (item.freshness_status === "stale") failedChecks.push("stale_evidence");

    // Weak source quality. pil_source_registry likewise has no
    // reliability_score column (only permissibility_status/requires_license),
    // and pil_evidence carries no source_id to join through to the registry
    // (src/lib/pil/sources.ts's own note: "evidence rows don't carry a
    // source_id"). verification_status is the applied schema's per-claim
    // proxy for source quality, so single-sourced/unverified claims are
    // treated as weak-source findings here.
    if (item.verification_status === "unverified" || item.verification_status === "single_source_fact") {
      failedChecks.push("weak_source_quality");
    }

    // Contradicted / superseded evidence.
    if (item.contradiction_status !== "none") failedChecks.push("contradicted");

    // Unsupported wealth conclusion / inference presented as fact: the
    // producing run asserted this evidence id as fact, but the evidence
    // itself is only a reasoned inference or estimate.
    const assertedAsFact = assertedFacts.some((f) => f.evidenceId === item.id);
    const isInference = item.inference_status === "inferred" || item.verification_status === "reasoned_inference" || item.verification_status === "estimate";
    if (assertedAsFact && isInference) {
      failedChecks.push("inference_presented_as_fact");
    }

    return { evidenceId: item.id, claimType: item.claim_type, failedChecks, pass: failedChecks.length === 0 };
  }

  // Incorrect relationship inference: a speculative, low-confidence edge
  // should never be relied on as a confirmed relationship pathway.
  private async checkRelationships(prospectId: string, orgId: string): Promise<string[]> {
    const nodes = await getNodesByProspect(prospectId, orgId);
    const issues: string[] = [];
    for (const node of nodes) {
      const edges = await getEdges(node.id);
      for (const edge of edges) {
        if (edge.relationship_strength === "speculative" && (edge.confidence ?? 0) < SPECULATIVE_CONFIDENCE_CEILING) {
          issues.push(`Speculative relationship edge ${edge.id} (${edge.edge_type}) has confidence ${edge.confidence ?? 0} and should not be presented as confirmed.`);
        }
      }
    }
    return issues;
  }

  // Duplicate identities: an unresolved or probable-match entity-resolution
  // candidate touching this prospect means the dossier may be conflating two
  // distinct real-world entities.
  private async checkDuplicateIdentity(orgId: string, prospectId: string): Promise<boolean> {
    const { data, error } = await getPilClient()
      .from("pil_entity_resolution_candidates")
      .select("*")
      .eq("organization_id", orgId)
      .in("status", ["probable_match", "unresolved"])
      .or(`prospect_id_a.eq.${prospectId},prospect_id_b.eq.${prospectId}`);
    if (error) throw error;
    return ((data ?? []) as ProspectIdentity[]).length > 0;
  }

  private decideVerdict(
    claims: ClaimEvaluation[],
    relationshipIssues: string[],
    duplicateIdentityRisk: boolean,
    evidenceCount: number,
  ): CriticVerdict {
    if (duplicateIdentityRisk) return "BLOCK_ENTITY_AMBIGUITY";

    const hardFail = claims.some((c) => c.failedChecks.includes("inference_presented_as_fact") || c.failedChecks.includes("contradicted"));
    if (hardFail) return "BLOCK_INSUFFICIENT_EVIDENCE";

    if (evidenceCount === 0) return "RESEARCH_MORE";

    const anyInsufficient = claims.some((c) => c.failedChecks.includes("insufficient_evidence"));
    if (anyInsufficient) return "RESEARCH_MORE";

    const anyCaveat = claims.some((c) => !c.pass) || relationshipIssues.length > 0;
    return anyCaveat ? "PASS_WITH_CAVEATS" : "PASS";
  }

  private summarize(verdict: CriticVerdict, claims: ClaimEvaluation[], relationshipIssues: string[], duplicateIdentityRisk: boolean): string {
    const failedClaims = claims.filter((c) => !c.pass);
    const parts = [`Critic verdict: ${verdict}.`, `${failedClaims.length}/${claims.length} claim(s) failed review.`];
    if (duplicateIdentityRisk) parts.push("Unresolved/probable-match entity-resolution candidates found for this prospect.");
    if (relationshipIssues.length > 0) parts.push(`${relationshipIssues.length} relationship-strength issue(s) found.`);
    for (const claim of failedClaims) {
      parts.push(`- ${claim.claimType} (${claim.evidenceId}): ${claim.failedChecks.join(", ")}`);
    }
    return parts.join(" ");
  }

  private async loadAgentRun(agentRunId: string): Promise<AgentRun | null> {
    const { data, error } = await getPilClient().from("pil_agent_runs").select("*").eq("id", agentRunId).maybeSingle();
    if (error) throw error;
    return (data as AgentRun | null) ?? null;
  }

  private async recordDecision(context: AgentContext, targetAgentRunId: string, verdict: CriticVerdict, reason: string): Promise<void> {
    const decision: PolicyDecisionOutcome = verdict === "PASS" || verdict === "PASS_WITH_CAVEATS" ? "allow" : verdict === "RESEARCH_MORE" ? "require_human" : "deny";
    const { error } = await getPilClient().from("pil_policy_decisions").insert({
      organization_id: context.orgId,
      actor_agent_id: context.agentCode,
      action_requested: `critic_review:${targetAgentRunId}`,
      policy_name: "pil_critic_verdict",
      decision,
      reason,
      related_delegated_task_id: null,
    });
    if (error) throw error;
  }

  private async tryUseTool(context: AgentContext, runner: AgentRunner, tool: string, units: number): Promise<number> {
    if (!context.tools.includes(tool)) return 0;
    try {
      await runner.useTool(context, tool, { unitCost: MODEL_TOKEN_UNIT_COST_USD, units, costType: "model_tokens" });
      return units;
    } catch {
      return 0;
    }
  }
}

export default ProspectResearchCriticAgent;
