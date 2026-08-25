import type { Agent, AgentContext, AgentResult, AgentRunner } from "@/lib/pil/agent-runner";
import { getPilClient } from "@/lib/pil/db";
import { getEvidence } from "@/lib/pil/evidence";
import { getNodesByProspect } from "@/lib/pil/graph";
import { createReviewItem } from "@/lib/pil/human-review";
import { logAction } from "@/lib/pil/audit";
import type { GraphNode, Prospect, ProspectAlias, ResolutionCandidateStatus } from "@/lib/pil/types";

// BEN-KNW-02 -- Entity Resolution Agent
// (PROSPECT_INTELLIGENCE_AGENTS.md line ~966, FAMILY 7 -- KNOWLEDGE
// INTEGRITY). "Reason through ambiguous identities and determine whether
// records refer to the same entity."
//
// The task spec that commissioned this batch numbered this mission
// BEN-KNW-01 and described it as the "Entity Resolution and Graph Agent."
// The registry's real BEN-KNW-01 is the Prospect Digital Twin Agent (a
// continuous aggregator, out of scope for this batch); the entity-resolution
// mission the task actually describes -- fuzzy name/EIN/email/affiliation
// comparison, confidence-tiered auto-merge/human-review/distinct-entity
// outcomes -- is BEN-KNW-02 verbatim, including its exact 0.95/0.70
// confidence thresholds. This file implements the real BEN-KNW-02.
//
// H1 human boundary (spec): "Any merge that would materially change a
// prospect's giving-history attribution or capacity classification ->
// pil_human_review_queue (review_type='identity_linkage') before executing,
// even at A3." A >=0.95 match on either prospect with giving_history or
// wealth_capacity evidence on file is therefore routed to human review
// instead of auto-merged, regardless of match confidence.
//
// Schema note: pil_entity_aliases has no 'phone' alias_type (migration 151's
// CHECK only allows name_variant/email/org_name/ein/crm_id/external_id), so
// phone matching from the task's step description is not implemented --
// there is no column to read it from.

const MODEL_TOKEN_UNIT_COST_USD = 0.00002;
const AUTO_MERGE_THRESHOLD = 0.95;
const HUMAN_REVIEW_THRESHOLD = 0.7;
const SENSITIVE_CLAIM_TYPES = new Set(["giving_history", "wealth_capacity"]);

export interface EntityResolutionPairResult {
  prospectIdA: string;
  prospectIdB: string;
  matchScore: number;
  status: ResolutionCandidateStatus;
  signals: Record<string, unknown>;
  merged: boolean;
  survivingProspectId: string | null;
  requiresHumanReview: boolean;
  candidateId: string;
}

function normalizeName(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function nameSimilarity(a: string, b: string): number {
  const tokensA = new Set(normalizeName(a));
  const tokensB = new Set(normalizeName(b));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  const intersection = [...tokensA].filter((t) => tokensB.has(t)).length;
  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : intersection / union;
}

function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  return at === -1 ? null : email.slice(at + 1).toLowerCase();
}

export class EntityResolutionAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    const prospectIds = (context.plan as { prospectIds?: string[] } | null)?.prospectIds ?? (context.prospectId ? [context.prospectId] : []);
    if (prospectIds.length < 2) {
      return this.completedEmpty("BEN-KNW-02 requires context.plan.prospectIds with at least 2 candidate prospect ids");
    }

    const [prospects, aliasesByProspect, nodesByProspect] = await Promise.all([
      this.loadProspects(context.orgId, prospectIds),
      this.loadAliases(context.orgId, prospectIds),
      this.loadNodes(context.orgId, prospectIds),
    ]);

    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < prospectIds.length; i++) {
      for (let j = i + 1; j < prospectIds.length; j++) {
        pairs.push([prospectIds[i]!, prospectIds[j]!]);
      }
    }

    const results: EntityResolutionPairResult[] = [];
    for (const [idA, idB] of pairs) {
      const prospectA = prospects.get(idA);
      const prospectB = prospects.get(idB);
      if (!prospectA || !prospectB) continue;
      results.push(
        await this.resolvePair(context, prospectA, prospectB, aliasesByProspect, nodesByProspect),
      );
    }

    await logAction({
      organization_id: context.orgId,
      actor_type: "agent",
      actor_id: context.agentCode,
      action: "entity_resolution.batch_completed",
      resource_type: "pil_prospects",
      resource_id: prospectIds[0]!,
      before_state: null,
      after_state: { pairsEvaluated: results.length },
      policy_decision: null,
      ip_address: null,
    });

    const tokensUsed = await this.tryModelTokens(context, runner, 250 * pairs.length);

    return {
      status: "completed",
      evidence: [],
      conclusions: { results },
      delegations: [],
      tokensUsed,
      costUsd: tokensUsed * MODEL_TOKEN_UNIT_COST_USD,
      error: null,
    };
  }

  private async resolvePair(
    context: AgentContext,
    prospectA: Prospect,
    prospectB: Prospect,
    aliasesByProspect: Map<string, ProspectAlias[]>,
    nodesByProspect: Map<string, GraphNode[]>,
  ): Promise<EntityResolutionPairResult> {
    const aliasesA = aliasesByProspect.get(prospectA.id) ?? [];
    const aliasesB = aliasesByProspect.get(prospectB.id) ?? [];

    const einA = aliasesA.find((a) => a.alias_type === "ein")?.alias_value;
    const einB = aliasesB.find((a) => a.alias_type === "ein")?.alias_value;
    const einMatch = Boolean(einA && einB && einA.trim() === einB.trim());

    const nameSim = nameSimilarity(prospectA.canonical_name, prospectB.canonical_name);

    const emailsA = aliasesA.filter((a) => a.alias_type === "email").map((a) => emailDomain(a.alias_value)).filter(Boolean);
    const emailsB = aliasesB.filter((a) => a.alias_type === "email").map((a) => emailDomain(a.alias_value)).filter(Boolean);
    const emailDomainMatch = emailsA.some((d) => emailsB.includes(d));

    const crmMatch = aliasesA.some(
      (a) => (a.alias_type === "crm_id" || a.alias_type === "external_id") &&
        aliasesB.some((b) => b.alias_type === a.alias_type && b.alias_value === a.alias_value),
    );

    const orgLabelsA = new Set((nodesByProspect.get(prospectA.id) ?? []).filter((n) => n.node_type !== "person").map((n) => n.label));
    const orgLabelsB = new Set((nodesByProspect.get(prospectB.id) ?? []).filter((n) => n.node_type !== "person").map((n) => n.label));
    const sharedOrgs = [...orgLabelsA].filter((l) => orgLabelsB.has(l));
    const orgOverlapRatio = orgLabelsA.size === 0 || orgLabelsB.size === 0 ? 0 : sharedOrgs.length / Math.min(orgLabelsA.size, orgLabelsB.size);

    let matchScore: number;
    if (einMatch) {
      matchScore = 0.97;
    } else {
      matchScore = nameSim * 0.3 + (emailDomainMatch ? 0.15 : 0) + orgOverlapRatio * 0.25 + (crmMatch ? 0.15 : 0);
      matchScore = Math.min(1, matchScore);
    }

    const signals = { einMatch, nameSim, emailDomainMatch, orgOverlapRatio, sharedOrgs, crmMatch };

    const evidenceA = await getEvidence(prospectA.id, context.orgId);
    const evidenceB = await getEvidence(prospectB.id, context.orgId);
    const touchesSensitiveAttribution = [...evidenceA, ...evidenceB].some((e) => SENSITIVE_CLAIM_TYPES.has(e.claim_type));

    let status: ResolutionCandidateStatus;
    let merged = false;
    let survivingProspectId: string | null = null;
    let requiresHumanReview = false;

    if (matchScore >= AUTO_MERGE_THRESHOLD && !touchesSensitiveAttribution) {
      status = "match";
      const survivor = Date.parse(prospectA.created_at) <= Date.parse(prospectB.created_at) ? prospectA : prospectB;
      const absorbed = survivor.id === prospectA.id ? prospectB : prospectA;
      await this.executeMerge(context, survivor, absorbed, signals);
      merged = true;
      survivingProspectId = survivor.id;
    } else if (matchScore >= AUTO_MERGE_THRESHOLD && touchesSensitiveAttribution) {
      status = "probable_match";
      requiresHumanReview = true;
    } else if (matchScore >= HUMAN_REVIEW_THRESHOLD) {
      status = "probable_match";
      requiresHumanReview = true;
    } else {
      status = "not_match";
    }

    const candidate = await this.upsertCandidate(context, prospectA.id, prospectB.id, matchScore, status, signals);

    if (requiresHumanReview) {
      await createReviewItem({
        organization_id: context.orgId,
        review_type: "identity_linkage",
        subject_type: "pil_entity_resolution_candidates",
        subject_id: candidate.id,
        requested_by_agent_id: context.agentCode,
        priority: touchesSensitiveAttribution ? "urgent" : "high",
        status: "pending",
        summary: touchesSensitiveAttribution
          ? `Prospects ${prospectA.id}/${prospectB.id} scored ${matchScore.toFixed(2)} but touch giving-history/capacity evidence -- merge requires human sign-off before executing (H1 boundary).`
          : `Prospects ${prospectA.id}/${prospectB.id} scored ${matchScore.toFixed(2)} (probable match) -- human merge decision required.`,
        evidence_refs: [],
        assigned_to_user_id: null,
        resolved_at: null,
      });
    }

    return {
      prospectIdA: prospectA.id,
      prospectIdB: prospectB.id,
      matchScore,
      status,
      signals,
      merged,
      survivingProspectId,
      requiresHumanReview,
      candidateId: candidate.id,
    };
  }

  private async executeMerge(
    context: AgentContext,
    survivor: Prospect,
    absorbed: Prospect,
    signals: Record<string, unknown>,
  ): Promise<void> {
    const client = getPilClient();

    const { error: mergeError } = await client
      .from("pil_prospects")
      .update({ merged_into_prospect_id: survivor.id, status: "merged", updated_at: new Date().toISOString() })
      .eq("id", absorbed.id)
      .eq("organization_id", context.orgId);
    if (mergeError) throw mergeError;

    // Consolidate graph nodes to the surviving entity -- edges reference
    // node ids, not prospect ids, so reassigning node.prospect_id carries
    // every edge touching that node along with it automatically.
    const { error: nodesError } = await client
      .from("pil_graph_nodes")
      .update({ prospect_id: survivor.id, updated_at: new Date().toISOString() })
      .eq("prospect_id", absorbed.id)
      .eq("organization_id", context.orgId);
    if (nodesError) throw nodesError;

    const { error: logError } = await client.from("pil_identity_resolution_log").insert({
      organization_id: context.orgId,
      action: "merge",
      primary_prospect_id: survivor.id,
      secondary_prospect_id: absorbed.id,
      agent_id: context.agentCode,
      rationale: `Auto-merged at BEN-KNW-02: ${JSON.stringify(signals)}`,
    });
    if (logError) throw logError;
  }

  private async upsertCandidate(
    context: AgentContext,
    prospectIdA: string,
    prospectIdB: string,
    matchScore: number,
    status: ResolutionCandidateStatus,
    evidence: Record<string, unknown>,
  ): Promise<{ id: string }> {
    const client = getPilClient();
    const [idLow, idHigh] = [prospectIdA, prospectIdB].sort();
    const { data: existing, error: findError } = await client
      .from("pil_entity_resolution_candidates")
      .select("*")
      .eq("organization_id", context.orgId)
      .or(
        `and(prospect_id_a.eq.${idLow},prospect_id_b.eq.${idHigh}),and(prospect_id_a.eq.${idHigh},prospect_id_b.eq.${idLow})`,
      )
      .maybeSingle();
    if (findError) throw findError;

    const payload = {
      match_score: matchScore,
      status,
      evidence,
      resolved_by_agent_id: context.agentCode,
      resolved_at: new Date().toISOString(),
    };

    if (existing) {
      const { data, error } = await client
        .from("pil_entity_resolution_candidates")
        .update(payload)
        .eq("id", (existing as { id: string }).id)
        .select("*")
        .single();
      if (error) throw error;
      return data as { id: string };
    }

    const { data, error } = await client
      .from("pil_entity_resolution_candidates")
      .insert({ organization_id: context.orgId, prospect_id_a: idLow, prospect_id_b: idHigh, ...payload })
      .select("*")
      .single();
    if (error) throw error;
    return data as { id: string };
  }

  private async loadProspects(orgId: string, ids: string[]): Promise<Map<string, Prospect>> {
    const { data, error } = await getPilClient().from("pil_prospects").select("*").eq("organization_id", orgId).in("id", ids);
    if (error) throw error;
    return new Map(((data ?? []) as Prospect[]).map((p) => [p.id, p]));
  }

  private async loadAliases(orgId: string, ids: string[]): Promise<Map<string, ProspectAlias[]>> {
    const { data, error } = await getPilClient().from("pil_entity_aliases").select("*").eq("organization_id", orgId).in("prospect_id", ids);
    if (error) throw error;
    const map = new Map<string, ProspectAlias[]>();
    for (const alias of (data ?? []) as ProspectAlias[]) {
      const list = map.get(alias.prospect_id) ?? [];
      list.push(alias);
      map.set(alias.prospect_id, list);
    }
    return map;
  }

  private async loadNodes(orgId: string, ids: string[]): Promise<Map<string, GraphNode[]>> {
    const map = new Map<string, GraphNode[]>();
    for (const id of ids) {
      map.set(id, await getNodesByProspect(id, orgId));
    }
    return map;
  }

  private async tryModelTokens(context: AgentContext, runner: AgentRunner, units: number): Promise<number> {
    if (units <= 0 || !context.tools.includes("T-MODEL")) return 0;
    try {
      await runner.useTool(context, "T-MODEL", { unitCost: MODEL_TOKEN_UNIT_COST_USD, units, costType: "model_tokens" });
      return units;
    } catch {
      return 0;
    }
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

export default EntityResolutionAgent;
