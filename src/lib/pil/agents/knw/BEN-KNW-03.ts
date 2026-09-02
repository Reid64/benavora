import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
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
// Upgrade (additive, BEN-KNW-04 build landing alongside this one): the spec's
// six dimensions -- Claim Support, Source Directness, Source Independence,
// Permissibility, Freshness, Lineage Completeness -- were only ever covered
// for Freshness and Lineage Completeness directly. This upgrade adds the
// other four as new report fields (claimSupportScore, sourceDirectnessScore,
// sourceIndependenceScore, permissibilityFlagged) without touching any
// existing field, DB write, or the scan loops that already existed. It also
// starts handing the contradiction-*investigation* duty forward to BEN-KNW-04
// once it exists: this file keeps doing its own detection/recording (that's
// what populates the pil_contradictions queue BEN-KNW-04 will consume -- it
// investigates and resolves already-open rows, it does not re-detect them),
// and additionally fires a delegation to BEN-KNW-04 whenever it records a new
// contradiction this run. A second new delegation notifies BEN-SUP-05
// whenever this run flags provenance tampering or a prohibited-source claim
// -- exactly the class of event that critic exists to independently review.
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
//   - pil_evidence has no direct foreign key to a specific pil_source_registry
//     row (migration 157) -- permissibilityFlagged below is therefore
//     necessarily a best-effort source_type-level check (does ANY
//     pil_source_registry row sharing this evidence item's source_type have
//     permissibility_status='prohibited'), not a per-row check tied to the
//     exact source that produced this evidence item. An evidence item whose
//     source_type has zero matching pil_source_registry rows at all is NOT
//     flagged -- unknown permissibility is intentionally not treated the same
//     as prohibited.

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

// Directness tier map for sourceDirectnessScore, reusing exactly the
// source_type vocabulary already enumerated in TTL_HOURS_BY_SOURCE_TYPE
// above (no new source_type values invented). Tier labels per the spec's own
// dimension description:
//   100 -- "primary/official filing"  (irs_form_990, sec_edgar, nonprofit_filing)
//   70  -- "secondary official"       (foundation_information, corporate_information, public_records)
//   50  -- "secondary reported"       (news)
//   40  -- "first-party unverified"   (crm, internal)
//   30  -- "tertiary/unverified web"  (open_web) -- also the default for any
//                                      source_type not present in this map.
const SOURCE_TYPE_DIRECTNESS_SCORE: Record<string, number> = {
  irs_form_990: 100,
  sec_edgar: 100,
  nonprofit_filing: 100,
  foundation_information: 70,
  corporate_information: 70,
  public_records: 70,
  news: 50,
  crm: 40,
  internal: 40,
  open_web: 30,
};
const DEFAULT_SOURCE_DIRECTNESS_SCORE = 30;

function sourceDirectnessFor(sourceType: string): number {
  return SOURCE_TYPE_DIRECTNESS_SCORE[sourceType] ?? DEFAULT_SOURCE_DIRECTNESS_SCORE;
}

// claimSupportScore: percentage of scanned evidence with a non-null,
// non-empty evidence_excerpt. Deliberately a conservative presence-based
// heuristic -- evidence with no excerpt at all cannot be said to directly
// support its own claim -- not full NLP entailment checking (an excerpt that
// exists but doesn't actually substantiate the claim text isn't caught here;
// that's out of scope for this file's existing deterministic-scoring
// architecture).
function scoreClaimSupport(evidence: EvidenceItem[]): number {
  if (evidence.length === 0) return 0;
  const supported = evidence.filter((e) => e.evidence_excerpt != null && e.evidence_excerpt.trim().length > 0).length;
  return Math.round((supported / evidence.length) * 100);
}

function scoreSourceDirectness(evidence: EvidenceItem[]): number {
  if (evidence.length === 0) return 0;
  const total = evidence.reduce((sum, e) => sum + sourceDirectnessFor(e.source_type), 0);
  return Math.round(total / evidence.length);
}

// Distinct-publisher key for sourceIndependenceScore: publisher when set,
// else the source_url's hostname (documented fallback -- "distinct source_url
// domain when publisher is null"). When neither exists, each such item is
// treated as its own unique source (there is no identifier to prove it
// shares a publisher with anything else).
function independenceKey(item: EvidenceItem): string {
  if (item.publisher) return `publisher:${item.publisher}`;
  if (item.source_url) {
    try {
      return `domain:${new URL(item.source_url).hostname}`;
    } catch {
      return `url:${item.source_url}`;
    }
  }
  return `unknown:${item.id}`;
}

// sourceIndependenceScore: for each claim_type group with 2+ evidence items,
// the fraction with a distinct publisher/domain, averaged across those
// groups. Groups with exactly 1 item are excluded entirely -- "independence
// undefined for single-source claims" -- rather than scored as 0, since
// single-source evidence is already penalized via VERIFICATION_WEIGHT and
// double-penalizing here would distort evidenceQualityScore. If no claim_type
// group in this scan has 2+ items, there is nothing to average over; this
// defaults to 0 (nothing yet demonstrates independence) rather than a
// placeholder high score.
function scoreSourceIndependence(evidence: EvidenceItem[]): number {
  const byClaimType = new Map<string, EvidenceItem[]>();
  for (const item of evidence) {
    const list = byClaimType.get(item.claim_type) ?? [];
    list.push(item);
    byClaimType.set(item.claim_type, list);
  }
  const groupScores: number[] = [];
  for (const group of byClaimType.values()) {
    if (group.length < 2) continue;
    const distinctSources = new Set(group.map(independenceKey));
    groupScores.push((distinctSources.size / group.length) * 100);
  }
  if (groupScores.length === 0) return 0;
  return Math.round(groupScores.reduce((a, b) => a + b, 0) / groupScores.length);
}

// Exported so BEN-KNW-04 (Contradiction and Freshness Investigator) can reuse
// this exact verification-status weighting for its own canonicalWeight()
// computation rather than defining a third independent copy of the same
// object literal (BEN-QLF-04.ts has its own separate copy already, out of
// scope to consolidate here).
export const VERIFICATION_WEIGHT: Record<EvidenceVerificationStatus, number> = {
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
  // Additive dimension scores (spec's Claim Support / Source Directness /
  // Source Independence / Permissibility dimensions -- see the scoring
  // helpers above and findPermissibilityFlagged() below for each one's
  // documented method and limitations).
  claimSupportScore: number;
  sourceDirectnessScore: number;
  sourceIndependenceScore: number;
  permissibilityFlagged: string[];
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
    // Tracked so a BEN-KNW-04 delegation below (fired only when this run
    // records a NEW contradiction) can name the specific claim_types that
    // just opened a pil_contradictions row, not every claim_type this
    // prospect has ever contradicted on.
    const newlyContradictedClaimTypes = new Set<string>();
    for (const [claimType, group] of byClaimType.entries()) {
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
            newlyContradictedClaimTypes.add(claimType);
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

    // 5. Permissibility cross-reference -- best-effort, source_type-level
    // only (see the "Schema notes" header comment for why there's no per-row
    // FK to check this against instead).
    const permissibilityFlagged = await this.findPermissibilityFlagged(evidence);

    // 6. Evidence quality score for the prospect.
    const evidenceQualityScore = this.scoreEvidenceQuality(
      evidence,
      staleFlagged.length,
      contradictedEvidenceIds.size,
      permissibilityFlagged.length,
    );
    await this.tryUpdateOpportunityConfidence(context.orgId, context.prospectId, evidenceQualityScore);

    // 7. Claims with no supporting evidence -- graph edges with zero pil_graph_edge_evidence rows.
    const unsupportedClaims = await this.findUnsupportedEdgeClaims(context.orgId, context.prospectId);

    // 8. Additive dimension scores -- Claim Support / Source Directness /
    // Source Independence. See the module-level scoreClaimSupport()/
    // scoreSourceDirectness()/scoreSourceIndependence() helpers above for
    // each one's documented method.
    const claimSupportScore = scoreClaimSupport(evidence);
    const sourceDirectnessScore = scoreSourceDirectness(evidence);
    const sourceIndependenceScore = scoreSourceIndependence(evidence);

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
      claimSupportScore,
      sourceDirectnessScore,
      sourceIndependenceScore,
      permissibilityFlagged,
    };

    // Forward-delegations, additive to the existing scan behavior above.
    const delegations: DelegationRequest[] = [];
    if (contradictionsRecorded > 0) {
      delegations.push({
        childAgentCode: "BEN-KNW-04",
        objective: `Prospect ${context.prospectId} has ${contradictionsRecorded} newly-recorded contradiction(s) in pil_contradictions across claim_types [${[...newlyContradictedClaimTypes].join(", ")}]; investigate and resolve.`,
        maxAutonomy: "A2",
        constraints: { prospectId: context.prospectId, claimTypes: [...newlyContradictedClaimTypes] },
      });
    }
    if (tamperingFlagged.length > 0 || permissibilityFlagged.length > 0) {
      delegations.push({
        childAgentCode: "BEN-SUP-05",
        objective: `Prospect ${context.prospectId} evidence scan flagged ${tamperingFlagged.length} provenance-tampering item(s) [${tamperingFlagged.join(", ")}] and ${permissibilityFlagged.length} prohibited-source item(s) [${permissibilityFlagged.join(", ")}] feeding canonical state; critic review requested.`,
        maxAutonomy: "A2",
        constraints: { prospectId: context.prospectId, tamperingFlagged, permissibilityFlagged },
      });
    }

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
      delegations,
      tokensUsed,
      costUsd: tokensUsed * MODEL_TOKEN_UNIT_COST_USD,
      error: null,
    };
  }

  // permissibilityPenalty is the new additive term (0.5-weight convention,
  // matching stalePenalty/contradictionPenalty exactly). With zero
  // permissibilityFlagged items it's 0, making (1 - 0.5*0) = 1 a strict
  // no-op -- the pre-upgrade formula's output is unchanged whenever nothing
  // is flagged.
  private scoreEvidenceQuality(
    evidence: EvidenceItem[],
    staleCount: number,
    contradictedCount: number,
    permissibilityFlaggedCount: number,
  ): number {
    const weighted = evidence.map((e) => Math.max(0, Math.min(1, e.confidence)) * VERIFICATION_WEIGHT[e.verification_status]);
    const avg = weighted.reduce((a, b) => a + b, 0) / weighted.length;
    const stalePenalty = staleCount / evidence.length;
    const contradictionPenalty = contradictedCount / evidence.length;
    const permissibilityPenalty = permissibilityFlaggedCount / evidence.length;
    const score = avg * (1 - 0.5 * stalePenalty) * (1 - 0.5 * contradictionPenalty) * (1 - 0.5 * permissibilityPenalty);
    return Math.round(Math.max(0, Math.min(1, score)) * 100);
  }

  // Best-effort permissibility check -- see the "Schema notes" header comment
  // for why this is source_type-level, not per-row. An evidence item's
  // source_type with zero matching pil_source_registry rows is NOT flagged
  // (unknown is not the same as prohibited, intentionally conservative).
  private async findPermissibilityFlagged(evidence: EvidenceItem[]): Promise<string[]> {
    const sourceTypes = [...new Set(evidence.map((e) => e.source_type))];
    if (sourceTypes.length === 0) return [];
    const { data, error } = await getPilClient().from("pil_source_registry").select("source_type, permissibility_status").in("source_type", sourceTypes);
    if (error) throw error;
    const prohibitedSourceTypes = new Set(
      ((data ?? []) as Array<{ source_type: string; permissibility_status: string }>)
        .filter((row) => row.permissibility_status === "prohibited")
        .map((row) => row.source_type),
    );
    return evidence.filter((e) => prohibitedSourceTypes.has(e.source_type)).map((e) => e.id);
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
