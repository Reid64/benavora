// AR-11.3 - six call sites (base-agent.ts, autonomous-base.ts,
// deadline-prediction-agent.ts x2, notify.ts, worker/autonomous-orchestrator.ts)
// used to append crypto.randomUUID() to their dedup_key, which made every key
// unique so uq_alerts_org_dedup (migration 013) never fired. This guards the
// replacement keys: the same logical event produces a byte-identical key
// twice, genuinely different events never collide, and a period-scoped key
// (dateKey) rolls over to a new key in a new period instead of dedup-ing
// forever.

import { describe, expect, it } from "vitest";
import { contentFingerprint, dedupKeys } from "@/lib/alerts/alerts-service";

describe("AR-11.3 deterministic dedup keys", () => {
  it("contentFingerprint is deterministic and content-sensitive", () => {
    expect(contentFingerprint("same input")).toBe(contentFingerprint("same input"));
    expect(contentFingerprint("input a")).not.toBe(contentFingerprint("input b"));
    // No randomness anywhere in the implementation - calling it many times
    // with the same input must never drift.
    const values = new Set(Array.from({ length: 20 }, () => contentFingerprint("stable")));
    expect(values.size).toBe(1);
  });

  it("agentSilentFailure: same agent + same day is one event; a new day is a new one", () => {
    const a = dedupKeys.agentSilentFailure("ag-29-knowledge-indexer", "2026-09-18");
    const b = dedupKeys.agentSilentFailure("ag-29-knowledge-indexer", "2026-09-18");
    expect(a).toBe(b);

    // A different agent on the same day must not collide.
    expect(dedupKeys.agentSilentFailure("ag-17-opportunity-discovery", "2026-09-18")).not.toBe(a);

    // The same agent the next day is a new event (cadence via the period
    // component, not randomness).
    expect(dedupKeys.agentSilentFailure("ag-29-knowledge-indexer", "2026-09-19")).not.toBe(a);
  });

  it("deadlinePredictionTier: same opportunity + same tier is one event; tier and opportunity both distinguish", () => {
    const oppA = "11111111-1111-1111-1111-111111111111";
    const oppB = "22222222-2222-2222-2222-222222222222";

    expect(dedupKeys.deadlinePredictionTier("red", oppA)).toBe(
      dedupKeys.deadlinePredictionTier("red", oppA),
    );
    // Same opportunity, different tier -> different event (the deadline
    // moved bands).
    expect(dedupKeys.deadlinePredictionTier("red", oppA)).not.toBe(
      dedupKeys.deadlinePredictionTier("amber", oppA),
    );
    // Same tier, different opportunity -> different event.
    expect(dedupKeys.deadlinePredictionTier("red", oppA)).not.toBe(
      dedupKeys.deadlinePredictionTier("red", oppB),
    );
  });

  it("autonomousNotification: same agent+type+day+content is one event; content and day both distinguish", () => {
    const contentA = contentFingerprint("Document expiring soon\nfile-a.pdf expires on 2026-10-01.");
    const contentB = contentFingerprint("Document expiring soon\nfile-b.pdf expires on 2026-10-01.");

    const a = dedupKeys.autonomousNotification(
      "ag-10-document-expiry",
      "document_expiring",
      "2026-09-18",
      contentA,
    );
    expect(a).toBe(
      dedupKeys.autonomousNotification(
        "ag-10-document-expiry",
        "document_expiring",
        "2026-09-18",
        contentA,
      ),
    );

    // Two different documents flagged the same day must not collide.
    expect(
      dedupKeys.autonomousNotification(
        "ag-10-document-expiry",
        "document_expiring",
        "2026-09-18",
        contentB,
      ),
    ).not.toBe(a);

    // Same document, a later re-notification (new period) is a new event.
    expect(
      dedupKeys.autonomousNotification(
        "ag-10-document-expiry",
        "document_expiring",
        "2026-09-25",
        contentA,
      ),
    ).not.toBe(a);
  });

  it("userNotification: same eventType+user+day+content is one event", () => {
    const userId = "33333333-3333-3333-3333-333333333333";
    const content = contentFingerprint("Draft ready\nYour draft for Opportunity X is ready.");

    const a = dedupKeys.userNotification("draft_ready", userId, "2026-09-18", content);
    expect(a).toBe(dedupKeys.userNotification("draft_ready", userId, "2026-09-18", content));

    // A different user must not collide even with identical content/day.
    expect(
      dedupKeys.userNotification(
        "draft_ready",
        "44444444-4444-4444-4444-444444444444",
        "2026-09-18",
        content,
      ),
    ).not.toBe(a);
  });

  it("autonomousOrchestratorEntityAlert: same type+entity is one event, no period needed", () => {
    const applicationId = "55555555-5555-5555-5555-555555555555";
    expect(dedupKeys.autonomousOrchestratorEntityAlert("draft_review", applicationId)).toBe(
      dedupKeys.autonomousOrchestratorEntityAlert("draft_review", applicationId),
    );
    expect(dedupKeys.autonomousOrchestratorEntityAlert("draft_review", applicationId)).not.toBe(
      dedupKeys.autonomousOrchestratorEntityAlert(
        "draft_review",
        "66666666-6666-6666-6666-666666666666",
      ),
    );
  });

  it("autonomousOrchestratorContentAlert: same type+day+content is one event; a new day is a new one", () => {
    const content = contentFingerprint('Reputation risk detected for funder "Acme Foundation".');
    const a = dedupKeys.autonomousOrchestratorContentAlert("system", "2026-09-18", content);
    expect(a).toBe(dedupKeys.autonomousOrchestratorContentAlert("system", "2026-09-18", content));
    expect(dedupKeys.autonomousOrchestratorContentAlert("system", "2026-09-19", content)).not.toBe(
      a,
    );
  });
});
