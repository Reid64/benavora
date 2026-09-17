// AR-6.1 - the eight orchestration alert types extend public.alerts'
// alert_type enum (migration 188) rather than a second orchestration_alerts
// table. This guards: the union actually has all eight, every one has a
// label (compiler would already catch a missing key, but this is a runtime
// guard too), and the new dedup key builders are deterministic - no
// crypto.randomUUID() component, unlike the pre-existing agents this task
// explicitly says not to copy.

import { describe, expect, it } from "vitest";
import { ALERT_TYPE_LABEL, dedupKeys, type AlertType } from "@/lib/alerts/alerts-service";

const ORCHESTRATION_ALERT_TYPES: AlertType[] = [
  "task_failed",
  "cost_overage",
  "schema_mismatch",
  "state_drift",
  "rate_limit",
  "timeout",
  "rollback",
  "manual_review_required",
];

describe("orchestration alert types (AR-6.1)", () => {
  it("includes all eight new types in the AlertType union", () => {
    for (const type of ORCHESTRATION_ALERT_TYPES) {
      // Assignability to AlertType is enforced at compile time by the array's
      // type above; this assertion just keeps the list from silently
      // shrinking at runtime.
      expect(typeof type).toBe("string");
    }
    expect(ORCHESTRATION_ALERT_TYPES).toHaveLength(8);
  });

  it("has a non-empty ALERT_TYPE_LABEL for each of the eight new types", () => {
    for (const type of ORCHESTRATION_ALERT_TYPES) {
      expect(ALERT_TYPE_LABEL[type]).toBeTruthy();
      expect(ALERT_TYPE_LABEL[type].length).toBeGreaterThan(0);
    }
  });

  it("produces a byte-identical dedup_key across two calls for the same orchestration event", () => {
    const orchestrationId = "11111111-1111-1111-1111-111111111111";
    const agentType = "ag-17-opportunity-discovery";

    expect(dedupKeys.orchestrationTaskFailed(orchestrationId, agentType)).toBe(
      dedupKeys.orchestrationTaskFailed(orchestrationId, agentType),
    );
    expect(dedupKeys.orchestrationCostOverage(orchestrationId)).toBe(
      dedupKeys.orchestrationCostOverage(orchestrationId),
    );
    expect(dedupKeys.orchestrationSchemaMismatch(orchestrationId, agentType)).toBe(
      dedupKeys.orchestrationSchemaMismatch(orchestrationId, agentType),
    );
    expect(dedupKeys.orchestrationStateDrift(orchestrationId)).toBe(
      dedupKeys.orchestrationStateDrift(orchestrationId),
    );
    expect(dedupKeys.orchestrationRateLimit(orchestrationId, agentType)).toBe(
      dedupKeys.orchestrationRateLimit(orchestrationId, agentType),
    );
    expect(dedupKeys.orchestrationTimeout(orchestrationId, agentType)).toBe(
      dedupKeys.orchestrationTimeout(orchestrationId, agentType),
    );
    expect(dedupKeys.orchestrationRollback(orchestrationId)).toBe(
      dedupKeys.orchestrationRollback(orchestrationId),
    );
    expect(dedupKeys.orchestrationManualReviewRequired(orchestrationId)).toBe(
      dedupKeys.orchestrationManualReviewRequired(orchestrationId),
    );

    // Distinct events must NOT collide.
    expect(dedupKeys.orchestrationTaskFailed(orchestrationId, agentType)).not.toBe(
      dedupKeys.orchestrationTaskFailed(orchestrationId, "ag-22-propensity-scoring"),
    );
  });
});
