// Shared client-side helper — fire-and-forget enrollment of newly-created
// funders into reputation monitoring (FEATURE_REGISTRY_v2.md #151). Never
// awaited by callers and never throws into the caller's own success path: a
// failed enrollment call must not undo or block a funder creation that
// already succeeded, it's just a missed background check the nightly sweep
// will eventually still catch.

export function enrollInReputationMonitoring(funderIds: string[]): void {
  if (funderIds.length === 0) return;
  void fetch("/api/funders/enroll-monitoring", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ funderIds }),
  }).catch(() => {
    // Best-effort — the nightly reputation sweep will still reach this
    // funder eventually even if immediate enrollment failed.
  });
}
