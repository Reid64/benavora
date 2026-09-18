import type { Agent, AgentContext, AgentResult, AgentRunner } from "@/lib/pil/agent-runner";
import { getPilClient } from "@/lib/pil/db";
import { getEvidence } from "@/lib/pil/evidence";
import { getNodesByProspect, getEdges } from "@/lib/pil/graph";
import { logAction } from "@/lib/pil/audit";
import { createReviewItem } from "@/lib/pil/human-review";
import type { AgentRun, EvidenceItem, PolicyDecisionOutcome, ProspectIdentity } from "@/lib/pil/types";
import { pilBlendedTokenRateUsd, PIL_AGENT_MODEL } from "@/lib/pil/model-pricing";

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

const MIN_CONFIDENCE = 0.3;
const SPECULATIVE_CONFIDENCE_CEILING = 0.4;

export type CriticVerdict =
  | "PASS"
  | "PASS_WITH_CAVEATS"
  | "RESEARCH_MORE"
  | "BLOCK_INSUFFICIENT_EVIDENCE"
  | "BLOCK_ENTITY_AMBIGUITY"
  | "BLOCK_POLICY"
  | "BLOCK_INDEPENDENCE"
  | "BLOCK_EVIDENCE_INTEGRITY"
  | "QUARANTINE_SECURITY";

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

    // Constitutional invariant (spec §3.1 / PIL_SPEC_WORKING_DIR BEN-SUP-05
    // doc "a research-producing agent cannot certify its own consequential
    // output"): refuse outright rather than scoring a run this same agent
    // code produced.
    if (targetRun && targetRun.agent_id === context.agentCode) {
      return {
        status: "failed",
        evidence: [],
        conclusions: {},
        delegations: [],
        tokensUsed: 0,
        costUsd: 0,
        error: "BEN-SUP-05 cannot review its own prior output (self-certification is constitutionally prohibited)",
      };
    }

    const assertedFacts = (targetRun?.output as { assertedFacts?: FactClaim[] } | null)?.assertedFacts ?? [];

    const evidence = context.prospectId ? await getEvidence(context.prospectId, context.orgId) : [];

    // 2/3. Independently evaluate evidence quality for each claim, then a
    // second pass for source independence (claims backed only by repeated
    // reports from one underlying source are not independently corroborated).
    let claims = evidence.map((item) => this.evaluateClaim(item, assertedFacts));
    claims = this.applySourceIndependence(evidence, claims);

    const relationshipIssues = context.prospectId ? await this.checkRelationships(context.prospectId, context.orgId) : [];
    const duplicateIdentityRisk = context.prospectId ? await this.checkDuplicateIdentity(context.orgId, context.prospectId) : false;

    // Cross-tenant signal: the producing run belongs to a different
    // organization than this review is scoped to. Never treated as an
    // ordinary evidence-quality issue.
    const crossTenant = targetRun !== null && targetRun.organization_id !== context.orgId;

    // Evidence integrity: the producing run asserted a fact backed by an
    // evidenceId that doesn't resolve to anything in this cycle's loaded
    // evidence. Never guess or substitute a replacement -- quarantine it.
    const evidenceIds = new Set(evidence.map((item) => item.id));
    const unresolvedEvidenceIds = [...new Set(assertedFacts.filter((f) => !evidenceIds.has(f.evidenceId)).map((f) => f.evidenceId))];
    if (unresolvedEvidenceIds.length > 0) {
      await logAction({
        organization_id: context.orgId,
        actor_type: "agent",
        actor_id: context.agentCode,
        action: "critic.evidence_quarantined",
        resource_type: "pil_agent_runs",
        resource_id: targetAgentRunId,
        before_state: null,
        after_state: { unresolvedEvidenceIds },
        policy_decision: null,
        ip_address: null,
      });
    }

    const tokensUsed = await this.tryUseTool(context, runner, "T-MODEL", 120);
    // T-MODEL was permitted but the call still returned 0 tokens -- the
    // underlying call threw and tryUseTool swallowed it. Never let a
    // degraded review silently pass.
    const modelUnavailable = context.tools.includes("T-MODEL") && tokensUsed === 0;

    let verdict = this.decideVerdict(claims, relationshipIssues, duplicateIdentityRisk, evidence.length, crossTenant, unresolvedEvidenceIds);
    if (modelUnavailable && verdict === "PASS") {
      verdict = "PASS_WITH_CAVEATS";
    }

    let summary = this.summarize(verdict, claims, relationshipIssues, duplicateIdentityRisk);
    if (modelUnavailable) {
      summary += " Model-assisted review was unavailable this cycle.";
    }

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
      after_state: { report, modelUnavailable },
      policy_decision: null,
      ip_address: null,
    });

    // 6. Record the critic decision to pil_policy_decisions.
    await this.recordDecision(context, targetAgentRunId, verdict, summary);

    // 5. On any BLOCK_*/QUARANTINE_SECURITY verdict, create a HumanReviewItem with the specific failures.
    if (verdict.startsWith("BLOCK_") || verdict === "QUARANTINE_SECURITY") {
      await createReviewItem({
        organization_id: context.orgId,
        review_type: "critic_block",
        subject_type: "pil_agent_runs",
        subject_id: targetAgentRunId,
        requested_by_agent_id: context.agentCode,
        priority: verdict === "BLOCK_POLICY" || verdict === "QUARANTINE_SECURITY" ? "urgent" : "high",
        status: "pending",
        summary,
        evidence_refs: claims.filter((c) => !c.pass).map((c) => c.evidenceId),
        assigned_to_user_id: null,
        resolved_at: null,
      });
    }

    return {
      status: verdict.startsWith("BLOCK_") || verdict === "QUARANTINE_SECURITY" ? "escalated" : "completed",
      evidence: [],
      conclusions: { report },
      delegations: [],
      tokensUsed,
      costUsd: 0, // AR-10.1: real cost already recorded per-call in ai_usage_log by useTool()/T-MODEL via model-pricing.ts; recording it again here would double-count the same tokens.
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

  // Source independence, distinct from weak_source_quality: two or more
  // items backing the SAME claim_type that all share the identical
  // source_url are one independence group (spec §5 IndependenceProof.v2 /
  // constitutional invariant "repeated reports from one underlying source
  // form one independence group"), not independent corroboration.
  private applySourceIndependence(evidence: EvidenceItem[], claims: ClaimEvaluation[]): ClaimEvaluation[] {
    const byClaimType = new Map<string, EvidenceItem[]>();
    for (const item of evidence) {
      const list = byClaimType.get(item.claim_type) ?? [];
      list.push(item);
      byClaimType.set(item.claim_type, list);
    }

    const failedIndependenceIds = new Set<string>();
    for (const items of byClaimType.values()) {
      const bySource = new Map<string, EvidenceItem[]>();
      for (const item of items) {
        if (!item.source_url) continue;
        const list = bySource.get(item.source_url) ?? [];
        list.push(item);
        bySource.set(item.source_url, list);
      }
      for (const sourceItems of bySource.values()) {
        if (sourceItems.length < 2) continue;
        for (const item of sourceItems) failedIndependenceIds.add(item.id);
      }
    }

    if (failedIndependenceIds.size === 0) return claims;
    return claims.map((c) =>
      failedIndependenceIds.has(c.evidenceId)
        ? { ...c, failedChecks: [...c.failedChecks, "source_independence_failure"], pass: false }
        : c,
    );
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
    crossTenant: boolean,
    unresolvedEvidenceIds: string[],
  ): CriticVerdict {
    // Checked FIRST, ahead of every other verdict branch: a cross-tenant
    // signal is a security incident, never an ordinary evidence-quality issue.
    if (crossTenant) return "QUARANTINE_SECURITY";

    if (duplicateIdentityRisk) return "BLOCK_ENTITY_AMBIGUITY";

    // Ahead of the hardFail check, mirroring duplicateIdentityRisk: if
    // EVERY claim in this review fails source independence, that's a
    // systemic failure of the review itself, not a per-claim caveat.
    const allClaimsFailIndependence = claims.length > 0 && claims.every((c) => c.failedChecks.includes("source_independence_failure"));
    if (allClaimsFailIndependence) return "BLOCK_INDEPENDENCE";

    // After duplicateIdentityRisk and BLOCK_INDEPENDENCE, ahead of the
    // RESEARCH_MORE/PASS branches: the producing run asserted a fact backed
    // by evidence that no longer resolves.
    if (unresolvedEvidenceIds.length > 0) return "BLOCK_EVIDENCE_INTEGRITY";

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
      const rate = await pilBlendedTokenRateUsd();
      await runner.useTool(context, tool, { unitCost: rate, units, costType: "model_tokens", model: PIL_AGENT_MODEL });
      return units;
    } catch {
      return 0;
    }
  }
}

export default ProspectResearchCriticAgent;
