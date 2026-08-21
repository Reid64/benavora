// WGR-111: src/middleware.ts requires a valid Supabase session for every
// path not explicitly exempted. Real external callers (Vercel Cron,
// Stripe/Resend webhooks) never carry a session cookie, so before the fix
// every one of these routes was 307-redirected to /login before its own
// CRON_SECRET/signature check ever ran. These tests exercise the real,
// unmocked middleware() function end to end - only @supabase/ssr's
// createServerClient is mocked (via tests/setup.ts, the same global mock
// every other test in this suite relies on), returning a client whose
// auth.getUser() resolves to { user: null } - i.e. an unauthenticated
// caller, exactly the shape a real cron/webhook request has.
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";

import { middleware } from "@/middleware";

function makeRequest(pathname: string, init?: RequestInit) {
  return new NextRequest(new URL(`https://www.benavora.com${pathname}`), init);
}

describe("middleware (WGR-111 secret-gated route exemptions)", () => {
  it("does not redirect a secret-gated cron route (no session cookie)", async () => {
    const res = await middleware(makeRequest("/api/cron/reminders"));
    expect(res.status).not.toBe(307);
    expect(res.headers.get("location")).toBeNull();
  });

  it("does not redirect a secret-gated source-poll route (no session cookie)", async () => {
    const res = await middleware(makeRequest("/api/sources/samgov"));
    expect(res.status).not.toBe(307);
    expect(res.headers.get("location")).toBeNull();
  });

  it("does not redirect a signature-gated webhook route (no session cookie)", async () => {
    const res = await middleware(makeRequest("/api/webhooks/stripe", { method: "POST" }));
    expect(res.status).not.toBe(307);
    expect(res.headers.get("location")).toBeNull();
  });

  it("still redirects a normal protected page route to /login when unauthenticated (unchanged behavior)", async () => {
    const res = await middleware(makeRequest("/dashboard"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("still redirects a non-exempted sibling source route (state-portals, WGR-154) to /login when unauthenticated", async () => {
    // Confirms the exemption is an exact-path allowlist, not a /api/sources/*
    // prefix - this route deliberately has no CRON_SECRET check of its own
    // (WGR-154) and must keep relying on the session gate.
    const res = await middleware(makeRequest("/api/sources/state-portals"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });
});
