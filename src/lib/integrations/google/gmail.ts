// Gmail sync + send (BLUEPRINT Phase 4, BEHAVIORAL_CONTRACTS Â§19).
//
// SERVER-ONLY. Wraps the Gmail API for one organization. Construct with an
// authorized OAuth2 client from auth.ts (`getAuthorizedClient`), which already
// loads, decrypts, and auto-refreshes the org's stored tokens â€” so every method
// here operates under that single organization's mailbox.
//
// Contracts honored (Â§19): email bodies are stored as both plain text and HTML;
// attachment NAMES are extracted but attachment FILES are never downloaded.

import { google, type Auth, type gmail_v1 } from "googleapis";

/** One address parsed from a From/To/Cc header. */
export interface GmailContact {
  name: string | null;
  email: string;
}

/** A Gmail message normalized to the shape the sync/matcher layer persists. */
export interface ParsedGmailMessage {
  gmailMessageId: string;
  gmailThreadId: string;
  fromEmail: string | null;
  fromName: string | null;
  toEmails: string[];
  ccEmails: string[];
  subject: string | null;
  snippet: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  sentAt: string | null;
  hasAttachments: boolean;
  attachmentNames: string[];
  labels: string[];
}

export interface SendEmailParams {
  to: string | string[];
  subject: string;
  body: string;
  cc?: string | string[];
  bcc?: string | string[];
  /** Gmail message id being replied to â€” threads the reply correctly. */
  replyToMessageId?: string;
  /** Set true to send `body` as HTML; defaults to plain text. */
  html?: boolean;
}

export class GmailSync {
  private readonly gmail: gmail_v1.Gmail;

  constructor(auth: Auth.OAuth2Client) {
// eslint-disable-next-line @typescript-eslint/no-explicit-any

    this.gmail = google.gmail({ version: "v1" as const, auth: auth as any });
  }

  /**
   * List message ids matching a Gmail search query (e.g. "in:inbox newer_than:30d").
   * Returns the lightweight {id, threadId} stubs â€” call getMessage for full content.
   */
  async listMessages(
    query: string,
    maxResults = 100,
  ): Promise<Array<{ id: string; threadId: string }>> {
    const collected: Array<{ id: string; threadId: string }> = [];
    let pageToken: string | undefined = undefined;

    do {
      const remaining = maxResults - collected.length;
      const res: gmail_v1.Schema$ListMessagesResponse = (
        await this.gmail.users.messages.list({
          userId: "me",
          q: query || undefined,
          maxResults: Math.min(remaining, 100),
          pageToken,
        })
      ).data;

      for (const m of res.messages ?? []) {
        if (m.id && m.threadId) collected.push({ id: m.id, threadId: m.threadId });
      }
      pageToken = res.nextPageToken ?? undefined;
    } while (pageToken && collected.length < maxResults);

    return collected;
  }

  /** Fetch a full message (headers + body parts) by id. */
  async getMessage(messageId: string): Promise<gmail_v1.Schema$Message> {
    const res = await this.gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full",
    });
    return res.data;
  }

  /**
   * Send an email. When `replyToMessageId` is given, the message is threaded
   * (In-Reply-To/References headers + Gmail threadId) so it appears as a reply.
   * Returns the sent message's id and threadId.
   */
  async sendEmail(
    params: SendEmailParams,
  ): Promise<{ id: string | null; threadId: string | null }> {
    let threadId: string | undefined;
    let inReplyTo: string | undefined;
    let references: string | undefined;

    if (params.replyToMessageId) {
      const original = await this.getMessage(params.replyToMessageId);
      threadId = original.threadId ?? undefined;
      const headers = original.payload?.headers ?? [];
      inReplyTo = findHeader(headers, "Message-ID") ?? undefined;
      references =
        findHeader(headers, "References") ?? inReplyTo ?? undefined;
    }

    const raw = buildRawMessage({ ...params, inReplyTo, references });
    const res = await this.gmail.users.messages.send({
      userId: "me",
      requestBody: { raw, ...(threadId ? { threadId } : {}) },
    });
    return { id: res.data.id ?? null, threadId: res.data.threadId ?? null };
  }

  /**
   * Extract the contacts referenced by a message's From/To/Cc headers. The first
   * entry is always the sender (when present) so callers can match on it first.
   */
  extractContacts(message: gmail_v1.Schema$Message): GmailContact[] {
    const headers = message.payload?.headers ?? [];
    const contacts: GmailContact[] = [];
    for (const name of ["From", "To", "Cc"]) {
      const value = findHeader(headers, name);
      if (value) contacts.push(...parseAddressList(value));
    }
    // De-duplicate by lowercased email, preserving first-seen order.
    const seen = new Set<string>();
    return contacts.filter((c) => {
      const key = c.email.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /** Extract plain-text and HTML bodies from a (possibly multipart) message. */
  parseEmailBody(message: gmail_v1.Schema$Message): {
    text: string | null;
    html: string | null;
  } {
    const text = collectPart(message.payload, "text/plain");
    const html = collectPart(message.payload, "text/html");
    return { text, html };
  }

  /** Normalize a full Gmail message into {@link ParsedGmailMessage}. */
  toParsedMessage(message: gmail_v1.Schema$Message): ParsedGmailMessage {
    const headers = message.payload?.headers ?? [];
    const from = parseAddressList(findHeader(headers, "From") ?? "")[0] ?? null;
    const { text, html } = this.parseEmailBody(message);
    const attachmentNames = collectAttachmentNames(message.payload);
    const dateHeader = findHeader(headers, "Date");
    const sentAt = toIso(message.internalDate, dateHeader);

    return {
      gmailMessageId: message.id ?? "",
      gmailThreadId: message.threadId ?? "",
      fromEmail: from?.email ?? null,
      fromName: from?.name ?? null,
      toEmails: parseAddressList(findHeader(headers, "To") ?? "").map(
        (c) => c.email,
      ),
      ccEmails: parseAddressList(findHeader(headers, "Cc") ?? "").map(
        (c) => c.email,
      ),
      subject: findHeader(headers, "Subject"),
      snippet: message.snippet ?? null,
      bodyText: text,
      bodyHtml: html,
      sentAt,
      hasAttachments: attachmentNames.length > 0,
      attachmentNames,
      labels: message.labelIds ?? [],
    };
  }
}

// --- header / address parsing ------------------------------------------------

function findHeader(
  headers: gmail_v1.Schema$MessagePartHeader[],
  name: string,
): string | null {
  const lower = name.toLowerCase();
  const match = headers.find((h) => (h.name ?? "").toLowerCase() === lower);
  return match?.value ?? null;
}

/**
 * Parse an RFC 5322 address-list header value into {name, email} entries.
 * Handles `"Display Name" <addr@x>`, `Display Name <addr@x>`, and bare `addr@x`,
 * comma-separated.
 */
export function parseAddressList(value: string): GmailContact[] {
  if (!value.trim()) return [];
  return splitAddresses(value)
    .map((part) => parseSingleAddress(part))
    .filter((c): c is GmailContact => c !== null);
}

/** Split on commas that are not inside quotes or angle brackets. */
function splitAddresses(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  let inAngle = false;
  for (const ch of value) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === "<") inAngle = true;
    else if (ch === ">") inAngle = false;
    if (ch === "," && !inQuotes && !inAngle) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function parseSingleAddress(part: string): GmailContact | null {
  const trimmed = part.trim();
  if (!trimmed) return null;

  const angle = trimmed.match(/<([^>]+)>/);
  if (angle) {
    const email = (angle[1] ?? "").trim();
    const name = trimmed
      .slice(0, angle.index)
      .trim()
      .replace(/^"|"$/g, "")
      .trim();
    return email ? { name: name || null, email } : null;
  }

  // Bare address with no display name.
  const email = trimmed.replace(/^"|"$/g, "").trim();
  return email.includes("@") ? { name: null, email } : null;
}

// --- body / attachment extraction --------------------------------------------

/** Base64url â†’ utf8 (Gmail encodes part bodies as base64url). */
function decodeBody(data: string | null | undefined): string {
  if (!data) return "";
  return Buffer.from(data, "base64").toString("utf8");
}

/** Depth-first collect of the first body whose mimeType matches `mimeType`. */
function collectPart(
  part: gmail_v1.Schema$MessagePart | undefined,
  mimeType: string,
): string | null {
  if (!part) return null;

  if (part.mimeType === mimeType && part.body?.data) {
    return decodeBody(part.body.data);
  }
  for (const child of part.parts ?? []) {
    const found = collectPart(child, mimeType);
    if (found !== null) return found;
  }
  return null;
}

/** Collect filenames of all attachment parts (names only â€” never the bytes). */
function collectAttachmentNames(
  part: gmail_v1.Schema$MessagePart | undefined,
  acc: string[] = [],
): string[] {
  if (!part) return acc;
  if (part.filename && part.filename.trim() !== "") acc.push(part.filename);
  for (const child of part.parts ?? []) collectAttachmentNames(child, acc);
  return acc;
}

function toIso(
  internalDate: string | null | undefined,
  dateHeader: string | null,
): string | null {
  if (internalDate) {
    const ms = Number(internalDate);
    if (Number.isFinite(ms) && ms > 0) return new Date(ms).toISOString();
  }
  if (dateHeader) {
    const parsed = Date.parse(dateHeader);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return null;
}

// --- outbound message construction -------------------------------------------

function toList(value: string | string[] | undefined): string {
  if (!value) return "";
  return Array.isArray(value) ? value.join(", ") : value;
}

/** Build an RFC 2822 message and base64url-encode it for the Gmail send API. */
function buildRawMessage(params: {
  to: string | string[];
  subject: string;
  body: string;
  cc?: string | string[];
  bcc?: string | string[];
  html?: boolean;
  inReplyTo?: string;
  references?: string;
}): string {
  const lines: string[] = [];
  lines.push(`To: ${toList(params.to)}`);
  if (params.cc) lines.push(`Cc: ${toList(params.cc)}`);
  if (params.bcc) lines.push(`Bcc: ${toList(params.bcc)}`);
  lines.push(`Subject: ${encodeHeaderWord(params.subject)}`);
  if (params.inReplyTo) lines.push(`In-Reply-To: ${params.inReplyTo}`);
  if (params.references) lines.push(`References: ${params.references}`);
  lines.push("MIME-Version: 1.0");
  lines.push(
    `Content-Type: ${params.html ? "text/html" : "text/plain"}; charset="UTF-8"`,
  );
  lines.push("");
  lines.push(params.body);

  return Buffer.from(lines.join("\r\n"), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** RFC 2047 encode a header value when it contains non-ASCII characters. */
function encodeHeaderWord(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

