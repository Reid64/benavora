// WGR-111 complement: with src/middleware.ts now exempting secret-gated
// cron/webhook paths (so requests actually reach the route handler), this
// confirms each route's own CRON_SECRET check still does the real work -
// no secret returns a real 401 JSON body (never a redirect), and a valid
// secret reaches and returns 200. Uses the real, unmodified GET handler
// from src/app/api/cron/follow-ups/route.ts - only its downstream service
// call is mocked, so the auth check itself is exercised unmocked.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/autoapply/follow-up-scheduler", () => ({
  processFollowUps: vi.fn().mockResolvedValue({ sent: 0, skipped: 0 }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({})),
}));

import { GET } from "@/app/api/cron/follow-ups/route";

function makeRequest(headers?: Record<string, string>) {
  return new Request("https://www.benavora.com/api/cron/follow-ups", { headers });
}

describe("cron route CRON_SECRET auth (WGR-111)", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "test-cron-secret-value");
  });

  it("returns 401 JSON, not a redirect, when no secret is supplied", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(res.headers.get("location")).toBeNull();
    const body = await res.json();
    expect(body.code).toBe("unauthorized");
  });

  it("returns 401 JSON when the wrong secret is supplied", async () => {
    const res = await GET(makeRequest({ authorization: "Bearer wrong-secret" }));
    expect(res.status).toBe(401);
  });

  it("returns 200 when the correct CRON_SECRET bearer token is supplied", async () => {
    const res = await GET(makeRequest({ authorization: "Bearer test-cron-secret-value" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
