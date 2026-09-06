// Zoho Mail API client for the AutoApply confirmation monitor's Zoho path
// (used alongside the existing Gmail path in
// src/lib/autoapply/confirmation-monitor.ts). One instance per organization;
// pulls its access token from src/lib/zoho/zoho-auth.ts, which refreshes it
// from the org's stored refresh token as needed.
//
// Every endpoint/response field below is taken from Zoho's own published API
// docs (zoho.com/mail/help/api/*), fetched live while building this — not
// guessed:
//   GET https://mail.zoho.com/api/accounts
//     -> { status, data: [{ accountId, primaryEmailAddress, emailAddress:
//          [{ mailId, isAlias, isPrimary, isConfirmed }], ... }] }
//   GET https://mail.zoho.com/api/accounts/{accountId}/folders
//     -> { status, data: [{ folderId, folderName, folderType, path, ... }] }
//   GET https://mail.zoho.com/api/accounts/{accountId}/messages/view
//     ?folderId&start&limit&sortBy&sortorder
//     -> { status, data: [{ messageId, subject, fromAddress, sender,
//          receivedTime (ms, as a string), folderId, ... }] }
//   GET https://mail.zoho.com/api/accounts/{accountId}/folders/{folderId}/messages/{messageId}/content
//     -> { status, data: { messageId, content } }  (content is an HTML string)
//
// FLAGGED GAP: Zoho also documents a dedicated .../messages/search endpoint,
// but its `searchKey` query-operator syntax (e.g. anything analogous to
// Gmail's `after:`/`from:`) is not published anywhere in Zoho's own docs —
// the only example value they give is the literal string "newMails". Rather
// than guess undocumented search-operator syntax, this client lists the
// Inbox folder via messages/view (sorted newest-first) and filters
// client-side by receivedTime — the same list-then-filter approach
// confirmation-monitor.ts already uses for the Gmail path (it lists via
// Gmail's documented `after:` query, which Zoho has no equivalent for
// on this endpoint, then matches in application code either way).

import { getAuthorizedAccessToken } from "./zoho-auth";

const ZOHO_MAIL_API = "https://mail.zoho.com/api";
// Zoho's documented max is 200; matches the Gmail path's page-size cadence.
const MESSAGE_PAGE_SIZE = 100;
// Same defensive cap as confirmation-monitor.ts's MAX_LIST_PAGES — a
// dedicated, low-volume inbox should never need more than this in one cycle.
const MAX_LIST_PAGES = 3;

export interface ZohoAccount {
  accountId: string;
  primaryEmailAddress: string | null;
  /** Every emailAddress[].mailId for this account, primary address included. */
  aliases: string[];
}

export interface ZohoFolder {
  folderId: string;
  folderName: string;
  folderType: string | null;
}

export interface ZohoMessageSummary {
  messageId: string;
  subject: string;
  fromAddress: string | null;
  receivedTimeMs: number | null;
  folderId: string;
}

/** Shape confirmation-monitor.ts's existing isOAuthRefreshFailure/isRetryableStatus expect. */
function zohoApiError(
  status: number,
  errorText: string,
): Error & { response: { status: number; data: { error?: string } } } {
  const err = new Error(`Zoho Mail API error (HTTP ${status}): ${errorText}`) as Error & {
    response: { status: number; data: { error?: string } };
  };
  err.response = { status, data: { error: errorText } };
  return err;
}

async function zohoGet<T>(
  accessToken: string,
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const url = new URL(`${ZOHO_MAIL_API}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      Accept: "application/json",
    },
  });

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (!res.ok) {
    const description =
      json && typeof json === "object" && "status" in (json as Record<string, unknown>)
        ? JSON.stringify((json as Record<string, unknown>).status)
        : res.statusText;
    throw zohoApiError(res.status, description);
  }

  return (json as { data: T })?.data;
}

interface RawAccount {
  accountId: string;
  primaryEmailAddress?: string;
  emailAddress?: { mailId: string; isAlias?: boolean; isPrimary?: boolean }[];
}

/** Low-level: list every account visible to a raw access token. */
export async function listAccountsRaw(accessToken: string): Promise<ZohoAccount[]> {
  const data = await zohoGet<RawAccount[]>(accessToken, "/accounts");
  return (data ?? []).map((account) => ({
    accountId: account.accountId,
    primaryEmailAddress: account.primaryEmailAddress ?? null,
    aliases: (account.emailAddress ?? []).map((entry) => entry.mailId).filter(Boolean),
  }));
}

export class ZohoMailClient {
  constructor(private readonly organizationId: string) {}

  private async accessToken(): Promise<string> {
    return getAuthorizedAccessToken(this.organizationId);
  }

  async listAccounts(): Promise<ZohoAccount[]> {
    const token = await this.accessToken();
    return listAccountsRaw(token);
  }

  /**
   * Resolve the accountId whose primary address or any alias matches
   * `email` (case-insensitive) — e.g. finding the account for
   * info@faithfoundationsf.org among whatever accounts/aliases the
   * connected Zoho grant exposes. Returns null if no account matches.
   */
  async findAccountIdForEmail(email: string): Promise<string | null> {
    const target = email.trim().toLowerCase();
    const accounts = await this.listAccounts();
    const match = accounts.find(
      (account) =>
        account.primaryEmailAddress?.toLowerCase() === target ||
        account.aliases.some((alias) => alias.toLowerCase() === target),
    );
    return match?.accountId ?? null;
  }

  async listFolders(accountId: string): Promise<ZohoFolder[]> {
    const token = await this.accessToken();
    interface RawFolder {
      folderId: string;
      folderName: string;
      folderType?: string;
    }
    const data = await zohoGet<RawFolder[]>(token, `/accounts/${accountId}/folders`);
    return (data ?? []).map((folder) => ({
      folderId: folder.folderId,
      folderName: folder.folderName,
      folderType: folder.folderType ?? null,
    }));
  }

  /** Resolve the Inbox folder's folderId (folderType === 'Inbox', falling back to name match). */
  async findInboxFolderId(accountId: string): Promise<string | null> {
    const folders = await this.listFolders(accountId);
    return (
      folders.find((folder) => folder.folderType === "Inbox")?.folderId ??
      folders.find((folder) => folder.folderName === "Inbox")?.folderId ??
      null
    );
  }

  /**
   * List Inbox messages received after `afterMs` (exclusive), newest first,
   * paginating up to MAX_LIST_PAGES pages of MESSAGE_PAGE_SIZE each. Stops
   * early once a page's messages are all older than `afterMs` — since the
   * listing is sorted newest-first, every subsequent page would be too.
   */
  async listInboxMessagesSince(
    accountId: string,
    folderId: string,
    afterMs: number,
  ): Promise<ZohoMessageSummary[]> {
    const token = await this.accessToken();
    interface RawMessage {
      messageId: string;
      subject?: string;
      fromAddress?: string;
      receivedTime?: string;
      folderId: string;
    }

    const results: ZohoMessageSummary[] = [];
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const start = page * MESSAGE_PAGE_SIZE + 1;
      const data = await zohoGet<RawMessage[]>(token, `/accounts/${accountId}/messages/view`, {
        folderId,
        start: String(start),
        limit: String(MESSAGE_PAGE_SIZE),
        sortBy: "date",
        sortorder: "false", // false = descending = newest first, per Zoho's docs
      });
      if (!data || data.length === 0) break;

      let hitOlderThanBound = false;
      for (const message of data) {
        const receivedTimeMs = message.receivedTime ? Number(message.receivedTime) : null;
        if (receivedTimeMs !== null && receivedTimeMs <= afterMs) {
          hitOlderThanBound = true;
          continue;
        }
        results.push({
          messageId: message.messageId,
          subject: message.subject ?? "",
          fromAddress: message.fromAddress ?? null,
          receivedTimeMs,
          folderId: message.folderId,
        });
      }

      if (hitOlderThanBound || data.length < MESSAGE_PAGE_SIZE) break;
    }
    return results;
  }

  /** Fetch one message's HTML body. Returns null if Zoho reports no content. */
  async getMessageContentHtml(
    accountId: string,
    folderId: string,
    messageId: string,
  ): Promise<string | null> {
    const token = await this.accessToken();
    interface RawContent {
      messageId: number | string;
      content?: string;
    }
    const data = await zohoGet<RawContent>(
      token,
      `/accounts/${accountId}/folders/${folderId}/messages/${messageId}/content`,
    );
    return data?.content ?? null;
  }
}
