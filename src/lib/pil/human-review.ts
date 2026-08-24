import { getPilClient } from "@/lib/pil/db";
import { logAction } from "@/lib/pil/audit";
import type { HumanReviewItem, HumanReviewStatus } from "@/lib/pil/types";

// Human Review Lifecycle (PROSPECT_INTELLIGENCE_ARCHITECTURE.md Section 1.5):
//   pending -> in_review -> { approved | rejected | changes_requested }
//   changes_requested -> pending
//   pending|in_review -> expired
//
// The architecture doc calls for every terminal decision to write an
// append-only decision record. The applied schema (src/lib/pil/types.ts) has
// no `pil_human_review_decisions` table, so that append-only record is
// pil_audit_log (which is itself append-only, migration 159) rather than a
// table that does not exist yet -- submitReviewDecision below logs the full
// decision payload there.

export class HumanReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HumanReviewError";
  }
}

export async function createReviewItem(
  item: Omit<HumanReviewItem, "id" | "created_at">,
): Promise<HumanReviewItem> {
  const { data, error } = await getPilClient()
    .from("pil_human_review_queue")
    .insert({ ...item, status: "pending" as HumanReviewStatus })
    .select("*")
    .single();
  if (error) throw error;
  return data as HumanReviewItem;
}

export async function getReviewQueue(
  orgId: string,
  status?: HumanReviewStatus,
): Promise<HumanReviewItem[]> {
  let query = getPilClient().from("pil_human_review_queue").select("*").eq("organization_id", orgId);
  if (status) {
    query = query.eq("status", status);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as HumanReviewItem[];
}

async function getReviewItem(itemId: string): Promise<HumanReviewItem> {
  const { data, error } = await getPilClient()
    .from("pil_human_review_queue")
    .select("*")
    .eq("id", itemId)
    .single();
  if (error) throw error;
  return data as HumanReviewItem;
}

export async function assignReviewItem(itemId: string, userId: string): Promise<void> {
  const item = await getReviewItem(itemId);
  if (item.status !== "pending" && item.status !== "changes_requested") {
    throw new HumanReviewError(
      `Cannot assign review item ${itemId}: status is ${item.status}, expected pending or changes_requested`,
    );
  }
  const { error } = await getPilClient()
    .from("pil_human_review_queue")
    .update({ assigned_to_user_id: userId, status: "in_review" as HumanReviewStatus })
    .eq("id", itemId);
  if (error) throw error;
}

export interface ReviewDecision {
  approved: boolean;
  notes: string;
  outcome: unknown;
}

export async function submitReviewDecision(
  itemId: string,
  decision: ReviewDecision,
  decidedByUserId: string,
): Promise<void> {
  const item = await getReviewItem(itemId);
  if (item.status !== "in_review" && item.status !== "pending") {
    throw new HumanReviewError(
      `Cannot decide review item ${itemId}: status is ${item.status}, expected pending or in_review`,
    );
  }
  const newStatus: HumanReviewStatus = decision.approved ? "approved" : "rejected";

  const { error } = await getPilClient()
    .from("pil_human_review_queue")
    .update({ status: newStatus, resolved_at: new Date().toISOString() })
    .eq("id", itemId);
  if (error) throw error;

  await logAction({
    organization_id: item.organization_id,
    actor_type: "human",
    actor_id: decidedByUserId,
    action: "human_review.decided",
    resource_type: "pil_human_review_queue",
    resource_id: itemId,
    before_state: { status: item.status },
    after_state: { status: newStatus, notes: decision.notes, outcome: decision.outcome },
    policy_decision: null,
    ip_address: null,
  });
}
