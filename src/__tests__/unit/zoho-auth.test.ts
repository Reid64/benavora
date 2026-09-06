// Token refresh logic for src/lib/zoho/zoho-auth.ts — the Faith Foundation
// Zoho Mail confirmation-monitor path. Every Supabase call is mocked; no
// network or database is touched. fetch is mocked directly since zoho-auth.ts
// talks to Zoho's token endpoint with the global fetch, not a client library.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockUpsert = vi.fn();
const mockMaybeSingle = vi.fn();
const mockNotIsNull = vi.fn();

function buildSupabaseMock() {
  const from = vi.fn((table: string) => {
    if (table === "integrations") {
      return {
        upsert: mockUpsert,
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: mockMaybeSingle,
              not: mockNotIsNull,
            }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  });
  return { from } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => buildSupabaseMock()),
}));

import {
  getAuthUrl,
  refreshAccessToken,
  getAuthorizedAccessToken,
  verifyState,
} from "@/lib/zoho/zoho-auth";

const ORG_ID = "org-faith-foundation";

describe("zoho-auth: state signing", () => {
  beforeEach(() => {
    process.env.ZOHO_CLIENT_SECRET = "test-client-secret";
    process.env.ZOHO_CLIENT_ID = "test-client-id";
    process.env.ZOHO_REDIRECT_URI = "https://benavora.com/api/zoho/callback";
  });

  it("getAuthUrl produces a Zoho consent URL whose state round-trips to the organizationId", () => {
    const url = new URL(getAuthUrl(ORG_ID));
    expect(url.origin + url.pathname).toBe("https://accounts.zoho.com/oauth/v2/auth");
    expect(url.searchParams.get("scope")).toBe(
      "ZohoMail.messages.READ,ZohoMail.accounts.READ,ZohoMail.folders.READ",
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");

    const state = url.searchParams.get("state");
    expect(state).toBeTruthy();
    expect(verifyState(state as string)).toBe(ORG_ID);
  });

  it("verifyState rejects a tampered state token", () => {
    const url = new URL(getAuthUrl(ORG_ID));
    const state = url.searchParams.get("state") as string;
    const [payload] = state.split(".");
    const forged = `${payload}.not-the-real-mac`;
    expect(verifyState(forged)).toBeNull();
  });
});

describe("zoho-auth: token refresh", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.ZOHO_CLIENT_ID = "test-client-id";
    process.env.ZOHO_CLIENT_SECRET = "test-client-secret";
    process.env.ZOHO_REDIRECT_URI = "https://benavora.com/api/zoho/callback";
    process.env.INTEGRATION_ENCRYPTION_KEY = "test-encryption-key-32-bytes!!";
    mockUpsert.mockReset().mockResolvedValue({ error: null });
    mockMaybeSingle.mockReset();
    mockNotIsNull.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("refreshAccessToken exchanges the stored refresh token via grant_type=refresh_token and persists the new access token", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        access_token: null,
        refresh_token: encryptForTest("1000.stored-refresh-token"),
        token_expires_at: null,
        connected_email: "info@faithfoundationsf.org",
        is_active: true,
      },
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "1000.new-access-token",
        api_domain: "https://www.zohoapis.com",
        token_type: "Bearer",
        expires_in: 3600,
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const token = await refreshAccessToken(ORG_ID, buildSupabaseMock());

    expect(token).toBe("1000.new-access-token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toBe("https://accounts.zoho.com/oauth/v2/token");
    const body = new URLSearchParams(init.body);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("1000.stored-refresh-token");
    expect(body.get("client_id")).toBe("test-client-id");
    expect(body.get("client_secret")).toBe("test-client-secret");

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const [upsertRow] = mockUpsert.mock.calls[0] as [Record<string, unknown>];
    expect(upsertRow.organization_id).toBe(ORG_ID);
    expect(upsertRow.provider).toBe("zoho");
    // Zoho did not return a refresh_token on this refresh — the row must not
    // carry a refresh_token key at all, so persistTokens' upsert never
    // clobbers the one already on file.
    expect(upsertRow).not.toHaveProperty("refresh_token");
  });

  it("throws when the organization has no refresh token on file, without calling fetch", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null });
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(refreshAccessToken(ORG_ID, buildSupabaseMock())).rejects.toThrow(
      /not connected/i,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("classifies an invalid_grant refresh failure with a .response shape the retry/backoff layer expects", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        access_token: null,
        refresh_token: encryptForTest("1000.revoked-refresh-token"),
        token_expires_at: null,
        connected_email: "info@faithfoundationsf.org",
        is_active: true,
      },
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "invalid_grant" }),
    }) as unknown as typeof fetch;

    try {
      await refreshAccessToken(ORG_ID, buildSupabaseMock());
      throw new Error("expected refreshAccessToken to throw");
    } catch (err) {
      const typed = err as Error & { response?: { status: number; data: { error?: string } } };
      expect(typed.response?.status).toBe(400);
      expect(typed.response?.data.error).toBe("invalid_grant");
    }
  });

  it("getAuthorizedAccessToken returns the cached access token without refreshing when it is not near expiry", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        access_token: encryptForTest("1000.still-fresh"),
        refresh_token: encryptForTest("1000.stored-refresh-token"),
        token_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        connected_email: "info@faithfoundationsf.org",
        is_active: true,
      },
    });
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const token = await getAuthorizedAccessToken(ORG_ID, buildSupabaseMock());
    expect(token).toBe("1000.still-fresh");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("getAuthorizedAccessToken refreshes when the stored access token is past its expiry skew", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        access_token: encryptForTest("1000.stale"),
        refresh_token: encryptForTest("1000.stored-refresh-token"),
        token_expires_at: new Date(Date.now() - 1000).toISOString(),
        connected_email: "info@faithfoundationsf.org",
        is_active: true,
      },
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: "1000.refreshed", expires_in: 3600 }),
    }) as unknown as typeof fetch;

    const token = await getAuthorizedAccessToken(ORG_ID, buildSupabaseMock());
    expect(token).toBe("1000.refreshed");
  });
});

// Mirrors zoho-auth.ts's own AES-256-GCM encrypt() so tests can produce
// values its decrypt() will accept, without importing a private function.
function encryptForTest(plaintext: string): string {
  const crypto = require("crypto") as typeof import("crypto");
  const key = crypto.scryptSync(
    process.env.INTEGRATION_ENCRYPTION_KEY as string,
    "benavora.integration.v1",
    32,
  );
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}
