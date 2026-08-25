import type { Agent, AgentContext, AgentResult, AgentRunner } from "@/lib/pil/agent-runner";
import { getPilClient } from "@/lib/pil/db";
import { getEvidence, detectContradiction, recordContradiction, getProvenanceHash } from "@/lib/pil/evidence";
import { getNodesByProspect } from "@/lib/pil/graph";
import { logAction } from "@/lib/pil/audit";
import type { EvidenceFreshnessStatus, EvidenceItem, EvidenceVerificationStatus } from "@/lib/pil/types";

// BEN-KNW-03 -- Evidence & Provenance Verification Agent
// (PROSPECT_INTELLIGENCE_AGENTS.md line ~987, FAMILY 7 -- KNOWLEDGE
// INTEGRITY). "Verify that consequential claims are supported by
// permissible, traceable evidence."
//
// The task spec that commissioned this batch numbered this mission
// BEN-KNW-02 ("Evidence and Provenance Agent") and asked for one file
// covering staleness scanning, contradiction detection, provenance-hash
// verification, evidence-quality scoring, and orphan-claim flagging. In the
// real registry that combined mission spans two agents: BEN-KNW-03 (this
// file -- permissibility/citation/excerpt/circularity verification and
// freshness) and BEN-KNW-04 Contradiction & Freshness Investigator
// (contradiction detection/resolution). Since the task requested exactly one
// combined file and BEN-KNW-01/BEN-KNW-04 are out of scope for this batch,
// this agent implements BEN-KNW-03's real mission plus BEN-KNW-04's
// contradiction-detection duty (using evidence.ts's existing
// detectContradiction/recordContradiction, which already write to the real
// pil_contradictions table) rather than leaving contradiction detection
// unbuilt. A standalone BEN-KNW-04 (temporal-truth resolution of already-
// flagged contradictions) remains unimplemented.
//
// Schema notes (checked against the applied migrations, not the task's
// prose):
//   - pil_source_registry has no freshness_ttl_hours column (migration 157)
//     -- src/lib/pil/sources.ts's own checkFreshness() takes ttlHours as a
//     caller-supplied parameter for the same reason. This agent uses a
//     source_type -> TTL table below, the same pattern.
//   - pil_evidence has no provenance_hash column. This agent stores/reads
//     the hash as a `{type: "provenance_hash", hash, computedAt}` entry
//     inside pil_evidence.lineage (jsonb array, migration 153) -- the
//     schema's only extensible per-row metadata field.
//   - There is no pil_evidence_contradictions table; pil_contradictions
//     (migration 153) is the real table, and evidence.ts.recordContradiction
//     already writes to it. This agent additionally sets both evidence rows'
//     contradiction_status='contradicted' (recordContradiction does not).
//   - No table has a generic prospect-level confidence_score column. This
//     agent writes the computed evidence-quality score into
//     pil_prospect_opportunities.confidence when an opportunity row already
//     exists for the prospect (best-effort); it is always returned in the
//     report regardless.
//   - "Claims with no supporting evidence": interpreted against the graph,
//     since every pil_evidence row IS itself support for its own claim --
//     the real analog is a pil_graph_edge touching this prospect with zero
//     pil_graph_edge_evidence rows (an asserted relationship with no cited
//     backing).

const MODEL_TOKEN_UNIT_COST_USD = 0.00002;

const DEFAULT_TTL_HOURS = 24 * 30; // 30 days
const TTL_HOURS_BY_SOURCE_TYPE: Record<string, number> = {
  irs_form_990: 24 * 365, // filings are annual, slow to go stale
  sec_edgar: 24 * 365,
  nonprofit_filing: 24 * 365,
  foundation_information: 24 * 180,
  corporate_information: 24 * 180,
  public_records: 24 * 180,
  news: 24 * 30,
  open_web: 24 * 14,
  crm: 24 * 7,
  internal: 24 * 7,
};

function ttlHoursFor(sourceType: string): number {
  return TTL_HOURS_BY_SOURCE_TYPE[sourceType] ?? DEFAULT_TTL_HOURS;
}

const VERIFICATION_WEIGHT: Record<EvidenceVerificationStatus, number> = {
  verified_fact: 1,
  corroborated_fact: 0.9,
  single_source_fact: 0.7,
  reasoned_inference: 0.55,
  estimate: 0.5,
  unverified: 0.3,
  contradicted: 0,
  stale: 0.2,
};

interface ProvenanceLineageEntry {
  type: "provenance_hash";
  hash: string;
  computedAt: string;
}

function findProvenanceEntry(lineage: unknown[]): ProvenanceLineageEntry | null {
  const entry = lineage.find(
    (e): e is ProvenanceLineageEntry => typeof e === "object" && e !== null && (e as { type?: unknown }).type === "provenance_hash",
  );
  return entry ?? null;
}

function provenanceInput(item: EvidenceItem): string {
  return `${item.evidence_excerpt ?? item.claim}${item.source_url ?? ""}${item.retrieved_at}`;
}

export interface EvidenceProvenanceReport {
  prospectId: string;
  evidenceScanned: number;
  staleFlagged: string[];
  agingFlagged: string[];
  contradictionsFound: number;
  contradictionsRecorded: number;
  tamperingFlagged: string[];
  unsupportedClaims: string[];
  evidenceQualityScore: number;
}

export class EvidenceProvenanceAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    if (!context.prospectId) {
      return this.completedEmpty("BEN-KNW-03 requires an existing prospectId");
    }

    const evidence = await getEvidence(context.prospectId, context.orgId);
    if (evidence.length === 0) {
      return this.completedEmpty(`No evidence on file yet for prospect ${context.prospectId}`);
    }

    const client = getPilClient();
    const now = Date.now();

    // 1/2. Staleness scan.
    const staleFlagged: string[] = [];
    const agingFlagged: string[] = [];
    for (const item of evidence) {
      const ttlHours = ttlHoursFor(item.source_type);
      const ageHours = (now - Date.parse(item.retrieved_at)) / (1000 * 60 * 60);
      const computed: EvidenceFreshnessStatus = ageHours > ttlHours ? "stale" : ageHours > ttlHours * 0.5 ? "aging" : "fresh";
      if (computed === "stale") staleFlagged.push(item.id);
      if (computed === "aging") agingFlagged.push(item.id);
      if (computed !== item.freshness_status) {
        const { error } = await client.from("pil_evidence").update({ freshness_status: computed }).eq("id", item.id);
        if (error) throw error;
      }
    }

    // 3. Contradiction detection -- same claim_type, same entity, divergent values.
    const byClaimType = new Map<string, EvidenceItem[]>();
    for (const item of evidence) {
      const list = byClaimType.get(item.claim_type) ?? [];
      list.push(item);
      byClaimType.set(item.claim_type, list);
    }
    let contradictionsFound = 0;
    let contradictionsRecorded = 0;
    const contradictedEvidenceIds = new Set<string>();
    for (const group of byClaimType.values()) {
      if (group.length < 2) continue;
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const itemA = group[i]!;
          const itemB = group[j]!;
          const isContradiction = await detectContradiction(itemA, itemB);
          if (!isContradiction) continue;
          contradictionsFound++;
          const alreadyRecorded = await this.contradictionAlreadyRecorded(itemA.id, itemB.id);
          if (!alreadyRecorded) {
            await recordContradiction(itemA.id, itemB.id, context.orgId);
            contradictionsRecorded++;
          }
          contradictedEvidenceIds.add(itemA.id);
          contradictedEvidenceIds.add(itemB.id);
        }
      }
    }
    if (contradictedEvidenceIds.size > 0) {
      const { error } = await client
        .from("pil_evidence")
        .update({ contradiction_status: "contradicted" })
        .in("id", [...contradictedEvidenceIds]);
      if (error) throw error;
    }

    // 4. Provenance hash verification.
    const tamperingFlagged: string[] = [];
    for (const item of evidence) {
      const computedHash = getProvenanceHash(provenanceInput(item));
      const existingEntry = findProvenanceEntry(item.lineage ?? []);
      if (!existingEntry) {
        const newLineage: ProvenanceLineageEntry[] = [
          ...((item.lineage ?? []) as ProvenanceLineageEntry[]),
          { type: "provenance_hash", hash: computedHash, computedAt: new Date().toISOString() },
        ];
        const { error } = await client.from("pil_evidence").update({ lineage: newLineage }).eq("id", item.id);
        if (error) throw error;
      } else if (existingEntry.hash !== computedHash) {
        tamperingFlagged.push(item.id);
      }
    }

    // 5. Evidence quality score for the prospect.
    const evidenceQualityScore = this.scoreEvidenceQuality(evidence, staleFlagged.length, contradictedEvidenceIds.size);
    await this.tryUpdateOpportunityConfidence(context.orgId, context.prospectId, evidenceQualityScore);

    // 6. Claims with no supporting evidence -- graph edges with zero pil_graph_edge_evidence rows.
    const unsupportedClaims = await this.findUnsupportedEdgeClaims(context.orgId, context.prospectId);

    const report: EvidenceProvenanceReport = {
      prospectId: context.prospectId,
      evidenceScanned: evidence.length,
      staleFlagged,
      agingFlagged,
      contradictionsFound,
      contradictionsRecorded,
      tamperingFlagged,
      unsupportedClaims,
      evidenceQualityScore,
    };

    await logAction({
      organization_id: context.orgId,
      actor_type: "agent",
      actor_id: context.agentCode,
      action: "evidence_provenance.scan_completed",
      resource_type: "pil_prospects",
      resource_id: context.prospectId,
      before_state: null,
      after_state: { report },
      policy_decision: null,
      ip_address: null,
    });

    const tokensUsed = await this.tryModelTokens(context, runner, 200);

    return {
      status: "completed",
      evidence: [],
      conclusions: { report },
      delegations: [],
      tokensUsed,
      costUsd: tokensUsed * MODEL_TOKEN_UNIT_COST_USD,
      error: null,
    };
  }

  private scoreEvidenceQuality(evidence: EvidenceItem[], staleCount: number, contradictedCount: number): number {
    const weighted = evidence.map((e) => Math.max(0, Math.min(1, e.confidence)) * VERIFICATION_WEIGHT[e.verification_status]);
    const avg = weighted.reduce((a, b) => a + b, 0) / weighted.length;
    const stalePenalty = staleCount / evidence.length;
    const contradictionPenalty = contradictedCount / evidence.length;
    const score = avg * (1 - 0.5 * stalePenalty) * (1 - 0.5 * contradictionPenalty);
    return Math.round(Math.max(0, Math.min(1, score)) * 100);
  }

  private async contradictionAlreadyRecorded(evidenceIdA: string, evidenceIdB: string): Promise<boolean> {
    const { data, error } = await getPilClient()
      .from("pil_contradictions")
      .select("id")
      .or(
        `and(evidence_id_a.eq.${evidenceIdA},evidence_id_b.eq.${evidenceIdB}),and(evidence_id_a.eq.${evidenceIdB},evidence_id_b.eq.${evidenceIdA})`,
      )
      .maybeSingle();
    if (error) throw error;
    return Boolean(data);
  }

  private async tryUpdateOpportunityConfidence(orgId: string, prospectId: string, score: number): Promise<void> {
    const { data, error } = await getPilClient()
      .from("pil_prospect_opportunities")
      .select("id")
      .eq("organization_id", orgId)
      .eq("prospect_id", prospectId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return;
    const { error: updateError } = await getPilClient()
      .from("pil_prospect_opportunities")
      .update({ confidence: score / 100, updated_at: new Date().toISOString() })
      .eq("id", (data as { id: string }).id);
    if (updateError) throw updateError;
  }

  private async findUnsupportedEdgeClaims(orgId: string, prospectId: string): Promise<string[]> {
    const nodes = await getNodesByProspect(prospectId, orgId);
    if (nodes.length === 0) return [];
    const nodeIds = nodes.map((n) => n.id);
    const client = getPilClient();
    const { data: edges, error: edgesError } = await client
      .from("pil_graph_edges")
      .select("id")
      .eq("organization_id", orgId)
      .eq("is_current", true)
      .in("source_node_id", nodeIds);
    if (edgesError) throw edgesError;
    const edgeIds = ((edges ?? []) as Array<{ id: string }>).map((e) => e.id);
    if (edgeIds.length === 0) return [];

    const { data: links, error: linksError } = await client.from("pil_graph_edge_evidence").select("edge_id").in("edge_id", edgeIds);
    if (linksError) throw linksError;
    const linkedEdgeIds = new Set(((links ?? []) as Array<{ edge_id: string }>).map((l) => l.edge_id));
    return edgeIds.filter((id) => !linkedEdgeIds.has(id));
  }

  private async tryModelTokens(context: AgentContext, runner: AgentRunner, units: number): Promise<number> {
    if (!context.tools.includes("T-MODEL")) return 0;
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

export default EvidenceProvenanceAgent;
