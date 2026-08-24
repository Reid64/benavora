import { createHash } from "crypto";

import { getPilClient } from "@/lib/pil/db";
import type { EvidenceItem } from "@/lib/pil/types";

export async function recordEvidence(item: Omit<EvidenceItem, "id">): Promise<EvidenceItem> {
  const { data, error } = await getPilClient()
    .from("pil_evidence")
    .insert(item)
    .select("*")
    .single();
  if (error) throw error;
  return data as EvidenceItem;
}

// pil_evidence has no direct prospect_id column -- it's keyed generically by
// (entity_table, entity_id) so the same table can carry evidence for
// prospects, graph nodes, or graph edges (migration 153). This filters to
// the prospect entity_table.
export async function getEvidence(prospectId: string, orgId: string): Promise<EvidenceItem[]> {
  const { data, error } = await getPilClient()
    .from("pil_evidence")
    .select("*")
    .eq("organization_id", orgId)
    .eq("entity_table", "pil_prospects")
    .eq("entity_id", prospectId);
  if (error) throw error;
  return (data ?? []) as EvidenceItem[];
}

export async function detectContradiction(
  itemA: EvidenceItem,
  itemB: EvidenceItem,
): Promise<boolean> {
  if (itemA.id === itemB.id) return false;
  if (itemA.entity_id !== itemB.entity_id || itemA.claim_type !== itemB.claim_type) return false;
  return JSON.stringify(itemA.value) !== JSON.stringify(itemB.value);
}

export async function recordContradiction(
  itemAId: string,
  itemBId: string,
  orgId: string,
): Promise<void> {
  const client = getPilClient();
  const { data: rows, error: fetchError } = await client
    .from("pil_evidence")
    .select("*")
    .in("id", [itemAId, itemBId]);
  if (fetchError) throw fetchError;

  const evidenceRows = (rows ?? []) as EvidenceItem[];
  const itemA = evidenceRows.find((r) => r.id === itemAId);
  const itemB = evidenceRows.find((r) => r.id === itemBId);
  if (!itemA || !itemB) {
    throw new Error(`recordContradiction: evidence row(s) not found for ${itemAId}/${itemBId}`);
  }
  if (itemA.entity_table !== "pil_prospects") {
    throw new Error(
      `recordContradiction: evidence ${itemAId} is not attached to a prospect (entity_table=${itemA.entity_table})`,
    );
  }

  const { error: insertError } = await client.from("pil_contradictions").insert({
    organization_id: orgId,
    prospect_id: itemA.entity_id,
    claim_type: itemA.claim_type,
    evidence_id_a: itemAId,
    evidence_id_b: itemBId,
    resolution_status: "open",
    resolved_value: null,
    investigated_by_agent_id: null,
    resolved_at: null,
  });
  if (insertError) throw insertError;
}

// SHA-256 of the caller-supplied content. Per PIL-02's provenance
// requirement (spec: "SHA-256 of content+sourceId+retrievedAt"), callers
// should pass the concatenated `${content}${sourceId}${retrievedAt}` string
// -- the deferred-FK/task-spec review for this batch found no PIL table
// carries a bare (content, sourceId, retrievedAt) tuple this could hash
// server-side, so composing the input string is the caller's
// responsibility, matching the single-argument signature this function
// exposes.
export function getProvenanceHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
