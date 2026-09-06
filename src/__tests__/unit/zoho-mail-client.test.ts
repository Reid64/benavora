// Alias resolution + inbox listing for src/lib/zoho/zoho-mail-client.ts.
// getAuthorizedAccessToken (zoho-auth.ts) is mocked so these tests exercise
// only the Zoho Mail API surface itself, via a mocked global fetch — no
// network, no database.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/zoho/zoho-auth", () => ({
  getAuthorizedAccessToken: vi.fn().mockResolvedValue("1000.test-access-token"),
}));

import { ZohoMailClient, listAccountsRaw } from "@/lib/zoho/zoho-mail-client";

const ORG_ID = "org-faith-foundation";

function jsonResponse(data: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: async () => ({ status: { code: status, description: "success" }, data }),
  };
}

describe("ZohoMailClient: alias resolution", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  const accountsResponse = [
    {
      accountId: "111",
      primaryEmailAddress: "owner@benavora.com",
      emailAddress: [{ mailId: "owner@benavora.com", isPrimary: true, isAlias: false }],
    },
    {
      accountId: "222",
      primaryEmailAddress: "faith@example.com",
      emailAddress: [
        { mailId: "faith@example.com", isPrimary: true, isAlias: false },
        { mailId: "info@faithfoundationsf.org", isPrimary: false, isAlias: true },
      ],
    },
  ];

  it("resolves an account by its primary address", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(accountsResponse)) as unknown as typeof fetch;
    const client = new ZohoMailClient(ORG_ID);
    const accountId = await client.findAccountIdForEmail("owner@benavora.com");
    expect(accountId).toBe("111");
  });

  it("resolves an account by an alias address (info@faithfoundationsf.org), not just the primary", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(accountsResponse)) as unknown as typeof fetch;
    const client = new ZohoMailClient(ORG_ID);
    const accountId = await client.findAccountIdForEmail("info@faithfoundationsf.org");
    expect(accountId).toBe("222");
  });

  it("alias matching is case-insensitive", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(accountsResponse)) as unknown as typeof fetch;
    const client = new ZohoMailClient(ORG_ID);
    const accountId = await client.findAccountIdForEmail("INFO@FaithFoundationSF.org");
    expect(accountId).toBe("222");
  });

  it("returns null when no account or alias matches", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(accountsResponse)) as unknown as typeof fetch;
    const client = new ZohoMailClient(ORG_ID);
    const accountId = await client.findAccountIdForEmail("nobody@nowhere.com");
    expect(accountId).toBeNull();
  });

  it("listAccountsRaw maps Zoho's emailAddress[].mailId list into a flat aliases array", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(accountsResponse)) as unknown as typeof fetch;
    const accounts = await listAccountsRaw("1000.raw-token");
    expect(accounts).toHaveLength(2);
    expect(accounts[1]).toEqual({
      accountId: "222",
      primaryEmailAddress: "faith@example.com",
      aliases: ["faith@example.com", "info@faithfoundationsf.org"],
    });
  });
});

describe("ZohoMailClient: findInboxFolderId", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("picks the folder with folderType 'Inbox'", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse([
        { folderId: "900", folderName: "Sent", folderType: "Sent" },
        { folderId: "901", folderName: "Inbox", folderType: "Inbox" },
      ]),
    ) as unknown as typeof fetch;
    const client = new ZohoMailClient(ORG_ID);
    const folderId = await client.findInboxFolderId("222");
    expect(folderId).toBe("901");
  });
});

describe("ZohoMailClient: listInboxMessagesSince pagination + date filtering", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("keeps only messages newer than the bound and stops paginating once older messages appear", async () => {
    const now = 1_700_000_000_000;
    const page = [
      { messageId: "3", subject: "Newest", fromAddress: "a@example.com", receivedTime: String(now), folderId: "901" },
      { messageId: "2", subject: "Middle", fromAddress: "b@example.com", receivedTime: String(now - 1000), folderId: "901" },
      { messageId: "1", subject: "Too old", fromAddress: "c@example.com", receivedTime: String(now - 999_999), folderId: "901" },
    ];
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(page));
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new ZohoMailClient(ORG_ID);
    const results = await client.listInboxMessagesSince("222", "901", now - 5000);

    expect(results.map((m) => m.messageId)).toEqual(["3", "2"]);
    // Hit an older-than-bound message on page 1 -> must not fetch page 2.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops after an empty page instead of looping forever", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new ZohoMailClient(ORG_ID);
    const results = await client.listInboxMessagesSince("222", "901", 0);

    expect(results).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("propagates a shaped error (.response.status) on a non-OK HTTP response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: async () => ({ status: { code: 401, description: "INVALID_OAUTHTOKEN" } }),
    }) as unknown as typeof fetch;

    const client = new ZohoMailClient(ORG_ID);
    await expect(client.listInboxMessagesSince("222", "901", 0)).rejects.toMatchObject({
      response: { status: 401 },
    });
  });
});

describe("ZohoMailClient: getMessageContentHtml", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns the HTML content field from Zoho's message-content response", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ messageId: 123, content: "<p>Your application was received.</p>" }),
    ) as unknown as typeof fetch;

    const client = new ZohoMailClient(ORG_ID);
    const html = await client.getMessageContentHtml("222", "901", "123");
    expect(html).toBe("<p>Your application was received.</p>");
  });
});
