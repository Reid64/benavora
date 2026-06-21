// Gmail full-sync and incremental-sync engine.
//
// SERVER-ONLY. Uses GmailAuthManager for token management and writes to
// synced_email_threads + synced_email_messages (migration 054).
//
// as any casts on google.auth.OAuth2() and gmail({ auth }) are load-bearing:
// same divergence as gmail-auth.ts (pinned google-auth-library vs googleapis copy).

import { gmail_v1, google } from "googleapis";

import { createAdminClient } from "@/lib/supabase/admin";

import { GmailAuthManager } from "./gmail-auth";

export interface SyncResult {
  threads_synced: number;
  messages_synced: number;
  new_threads: number;
  errors: string[];
}

export interface ExtractedContact {
  name: string;
  email: string;
}

export interface EmailMessage {
  from_email: string | null;
  from_name: string | null;
  to_emails: string[] | null;
  cc_emails: string[] | null;
}

interface ParsedAddr {
  name: string;
  email: string;
}

function parseAddress(raw: string): ParsedAddr {
  const m = raw.trim().match(/^(.*?)\s*<([^>]+)>$/);
  if (m) return { name: (m[1] ?? "").trim(), email: (m[2] ?? "").trim() };
  return { name: "", email: raw.trim() };
}

function parseAddressList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => parseAddress(s).email)
    .filter((e) => e.length > 0);
}

function b64urlDecode(data: string): string {
  return Buffer.from(
    data.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  ).toString("utf8");
}

function extractBodyParts(
  payload: gmail_v1.Schema$MessagePart | null | undefined,
): { text: string | null; html: string | null } {
  if (!payload) return { text: null, html: null };

  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return { text: b64urlDecode(payload.body.data), html: null };
  }
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return { text: null, html: b64urlDecode(payload.body.data) };
  }

  let text: string | null = null;
  let html: string | null = null;

  for (const part of payload.parts ?? []) {
    if (part.mimeType === "text/plain" && part.body?.data) {
      text ??= b64urlDecode(part.body.data);
    } else if (part.mimeType === "text/html" && part.body?.data) {
      html ??= b64urlDecode(part.body.data);
    } else if (part.mimeType?.startsWith("multipart/")) {
      const nested = extractBodyParts(part);
      text ??= nested.text;
      html ??= nested.html;
    }
  }

  return { text, html };
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 4): Promise<T> {
  let backoff = 1000;
  for (let i = 0; i < maxAttempts - 1; i++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const status =
        (err as { response?: { status?: number } })?.response?.status;
      if (status === 429) {
        await new Promise((r) => setTimeout(r, backoff));
        backoff *= 2;
        continue;
      }
      throw err;
    }
  }
  return fn();
}

function getHeader(
  headers: gmail_v1.Schema$MessagePartHeader[],
  name: string,
): string | null {
  return (
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())
      ?.value ?? null
  );
}

export class GmailSyncEngine {
  private connectionId: string;
  private authManager = new GmailAuthManager();

  constructor(connectionId: string) {
    this.connectionId = connectionId;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async buildGmailClient(): Promise<{ gmail: any; organizationId: string }> {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("email_connections")
      .select("organization_id")
      .eq("id", this.connectionId)
      .single();

    if (error || !data) throw new Error("Email connection not found");

    const { organization_id } = data as { organization_id: string };
    const accessToken = await this.authManager.refreshToken(this.connectionId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const oauth = new (google.auth.OAuth2 as any)();
    oauth.setCredentials({ access_token: accessToken });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gmail = google.gmail({ version: "v1", auth: oauth as any });

    return { gmail, organizationId: organization_id };
  }

  private async upsertThread(
    supabase: ReturnType<typeof createAdminClient>,
    organizationId: string,
    thread: gmail_v1.Schema$Thread,
  ): Promise<{ dbId: string; isNew: boolean } | null> {
    if (!thread.id) return null;

    const messages = thread.messages ?? [];
    const firstMsg = messages[0];
    const lastMsg = messages[messages.length - 1];
    const headers: gmail_v1.Schema$MessagePartHeader[] =
      firstMsg?.payload?.headers ?? [];

    const subject = getHeader(headers, "subject");
    const lastMessageAt = lastMsg?.internalDate
      ? new Date(parseInt(lastMsg.internalDate, 10)).toISOString()
      : null;

    const { data: existing } = await supabase
      .from("synced_email_threads")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("gmail_thread_id", thread.id)
      .maybeSingle();

    const isNew = !existing;

    const { data: upserted, error } = await supabase
      .from("synced_email_threads")
      .upsert(
        {
          organization_id: organizationId,
          gmail_thread_id: thread.id,
          subject,
          snippet: thread.snippet ?? null,
          last_message_at: lastMessageAt,
          message_count: messages.length,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,gmail_thread_id" },
      )
      .select("id")
      .single();

    if (error || !upserted) return null;
    return { dbId: (upserted as { id: string }).id, isNew };
  }

  private async upsertMessages(
    supabase: ReturnType<typeof createAdminClient>,
    organizationId: string,
    dbThreadId: string,
    messages: gmail_v1.Schema$Message[],
  ): Promise<{ count: number; errors: string[] }> {
    let count = 0;
    const errors: string[] = [];

    for (const msg of messages) {
      if (!msg.id) continue;

      const headers: gmail_v1.Schema$MessagePartHeader[] =
        msg.payload?.headers ?? [];

      const fromRaw = getHeader(headers, "from") ?? "";
      const { name: fromName, email: fromEmail } = parseAddress(fromRaw);
      const toRaw = getHeader(headers, "to") ?? "";
      const ccRaw = getHeader(headers, "cc") ?? "";
      const msgSubject = getHeader(headers, "subject");

      const { text, html } = extractBodyParts(msg.payload);

      const sentAt = msg.internalDate
        ? new Date(parseInt(msg.internalDate, 10)).toISOString()
        : null;

      const parts = msg.payload?.parts ?? [];
      const attParts = parts.filter(
        (p) => p.filename && p.filename.length > 0 && p.body?.attachmentId,
      );
      const hasAttachments = attParts.length > 0;
      const attachmentNames = attParts.map((p) => p.filename ?? "");

      const { error: msgError } = await supabase
        .from("synced_email_messages")
        .upsert(
          {
            organization_id: organizationId,
            thread_id: dbThreadId,
            gmail_message_id: msg.id,
            from_email: fromEmail || null,
            from_name: fromName || null,
            to_emails: toRaw ? parseAddressList(toRaw) : null,
            cc_emails: ccRaw ? parseAddressList(ccRaw) : null,
            subject: msgSubject,
            body_text: text,
            body_html: html,
            sent_at: sentAt,
            has_attachments: hasAttachments,
            attachment_names: attachmentNames.length > 0 ? attachmentNames : null,
          },
          { onConflict: "organization_id,gmail_message_id" },
        );

      if (msgError) {
        errors.push(`Message ${msg.id}: ${msgError.message}`);
      } else {
        count++;
      }
    }

    return { count, errors };
  }

  async syncThreads(options?: {
    maxResults?: number;
    since?: Date;
  }): Promise<SyncResult> {
    const errors: string[] = [];
    let threads_synced = 0;
    let messages_synced = 0;
    let new_threads = 0;

    let { gmail, organizationId } = await this.buildGmailClient();
    const supabase = createAdminClient();
    const maxResults = options?.maxResults ?? 100;
    const q = options?.since
      ? `after:${Math.floor(options.since.getTime() / 1000)}`
      : undefined;

    let pageToken: string | undefined;

    do {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const listRes: any = await withRetry(() =>
        gmail.users.threads.list({
          userId: "me",
          maxResults,
          pageToken,
          q,
        }),
      );

      const refs: gmail_v1.Schema$Thread[] = listRes.data?.threads ?? [];
      pageToken = listRes.data?.nextPageToken ?? undefined;

      for (const ref of refs) {
        if (!ref.id) continue;

        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const threadRes: any = await withRetry(() =>
            gmail.users.threads.get({
              userId: "me",
              id: ref.id,
              format: "full",
            }),
          );

          const thread: gmail_v1.Schema$Thread = threadRes.data;
          if (!thread?.id) continue;

          const result = await this.upsertThread(supabase, organizationId, thread);
          if (!result) {
            errors.push(`Thread ${thread.id}: upsert failed`);
            continue;
          }

          threads_synced++;
          if (result.isNew) new_threads++;

          const { count, errors: msgErrs } = await this.upsertMessages(
            supabase,
            organizationId,
            result.dbId,
            thread.messages ?? [],
          );
          messages_synced += count;
          errors.push(...msgErrs);
        } catch (err: unknown) {
          const httpStatus =
            (err as { response?: { status?: number } })?.response?.status;
          if (httpStatus === 401) {
            // Token expired mid-sync — refresh client and retry this thread once.
            try {
              const rebuilt = await this.buildGmailClient();
              gmail = rebuilt.gmail;
              organizationId = rebuilt.organizationId;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const retryRes: any = await gmail.users.threads.get({
                userId: "me",
                id: ref.id,
                format: "full",
              });
              const thread: gmail_v1.Schema$Thread = retryRes.data;
              if (thread?.id) {
                const result = await this.upsertThread(supabase, organizationId, thread);
                if (result) {
                  threads_synced++;
                  if (result.isNew) new_threads++;
                  const { count, errors: msgErrs } = await this.upsertMessages(
                    supabase,
                    organizationId,
                    result.dbId,
                    thread.messages ?? [],
                  );
                  messages_synced += count;
                  errors.push(...msgErrs);
                }
              }
            } catch (retryErr: unknown) {
              errors.push(
                `Thread ${ref.id}: ${(retryErr as Error)?.message ?? "unknown error"}`,
              );
            }
          } else {
            errors.push(
              `Thread ${ref.id}: ${(err as Error)?.message ?? "unknown error"}`,
            );
          }
        }
      }
    } while (pageToken);

    // Use the profile's current historyId as the cursor for incremental syncs.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const profileRes: any = await withRetry(() =>
        gmail.users.getProfile({ userId: "me" }),
      );
      const historyId: string | null | undefined = profileRes.data?.historyId;
      if (historyId) {
        await supabase
          .from("email_connections")
          .update({
            sync_cursor: historyId,
            last_sync_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", this.connectionId);
      }
    } catch {
      // Non-fatal — cursor update is best-effort.
    }

    return { threads_synced, messages_synced, new_threads, errors };
  }

  async incrementalSync(): Promise<SyncResult> {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("email_connections")
      .select("sync_cursor")
      .eq("id", this.connectionId)
      .single();

    if (error || !data) throw new Error("Email connection not found");

    const { sync_cursor } = data as { sync_cursor: string | null };

    if (!sync_cursor) {
      return this.syncThreads({ maxResults: 50 });
    }

    const errors: string[] = [];
    let threads_synced = 0;
    let messages_synced = 0;
    let new_threads = 0;

    let { gmail, organizationId } = await this.buildGmailClient();
    let latestHistoryId = sync_cursor;
    let pageToken: string | undefined;

    do {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let histRes: any;
      try {
        histRes = await withRetry(() =>
          gmail.users.history.list({
            userId: "me",
            startHistoryId: sync_cursor,
            historyTypes: ["messageAdded", "labelAdded", "labelRemoved"],
            pageToken,
          }),
        );
      } catch (err: unknown) {
        const status =
          (err as { response?: { status?: number } })?.response?.status;
        if (status === 404) {
          // Cursor is too old — fall back to a fresh full sync.
          return this.syncThreads({ maxResults: 100 });
        }
        throw err;
      }

      if (histRes.data?.historyId) {
        latestHistoryId = histRes.data.historyId as string;
      }
      pageToken = histRes.data?.nextPageToken ?? undefined;

      const history: gmail_v1.Schema$History[] = histRes.data?.history ?? [];
      const threadIds = new Set<string>();

      for (const record of history) {
        for (const added of record.messagesAdded ?? []) {
          if (added.message?.threadId) threadIds.add(added.message.threadId);
        }
        for (const changed of [
          ...(record.labelsAdded ?? []),
          ...(record.labelsRemoved ?? []),
        ]) {
          if (changed.message?.threadId) threadIds.add(changed.message.threadId);
        }
      }

      for (const threadId of threadIds) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const threadRes: any = await withRetry(() =>
            gmail.users.threads.get({
              userId: "me",
              id: threadId,
              format: "full",
            }),
          );

          const thread: gmail_v1.Schema$Thread = threadRes.data;
          if (!thread?.id) continue;

          const result = await this.upsertThread(supabase, organizationId, thread);
          if (!result) {
            errors.push(`Thread ${thread.id}: upsert failed`);
            continue;
          }

          threads_synced++;
          if (result.isNew) new_threads++;

          const { count, errors: msgErrs } = await this.upsertMessages(
            supabase,
            organizationId,
            result.dbId,
            thread.messages ?? [],
          );
          messages_synced += count;
          errors.push(...msgErrs);
        } catch (err: unknown) {
          const httpStatus =
            (err as { response?: { status?: number } })?.response?.status;
          if (httpStatus === 401) {
            // Token expired mid-sync — refresh client and retry this thread once.
            try {
              const rebuilt = await this.buildGmailClient();
              gmail = rebuilt.gmail;
              organizationId = rebuilt.organizationId;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const retryRes: any = await gmail.users.threads.get({
                userId: "me",
                id: threadId,
                format: "full",
              });
              const retryThread: gmail_v1.Schema$Thread = retryRes.data;
              if (retryThread?.id) {
                const result = await this.upsertThread(supabase, organizationId, retryThread);
                if (result) {
                  threads_synced++;
                  if (result.isNew) new_threads++;
                  const { count, errors: msgErrs } = await this.upsertMessages(
                    supabase,
                    organizationId,
                    result.dbId,
                    retryThread.messages ?? [],
                  );
                  messages_synced += count;
                  errors.push(...msgErrs);
                }
              }
            } catch (retryErr: unknown) {
              errors.push(
                `Thread ${threadId}: ${(retryErr as Error)?.message ?? "unknown error"}`,
              );
            }
          } else {
            errors.push(
              `Thread ${threadId}: ${(err as Error)?.message ?? "unknown error"}`,
            );
          }
        }
      }
    } while (pageToken);

    await supabase
      .from("email_connections")
      .update({
        sync_cursor: latestHistoryId,
        last_sync_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", this.connectionId);

    return { threads_synced, messages_synced, new_threads, errors };
  }

  async extractContactsFromMessage(
    message: EmailMessage,
  ): Promise<ExtractedContact[]> {
    const contacts: ExtractedContact[] = [];

    if (message.from_email) {
      contacts.push({ name: message.from_name ?? "", email: message.from_email });
    }

    for (const email of message.to_emails ?? []) {
      if (email) contacts.push({ name: "", email });
    }

    for (const email of message.cc_emails ?? []) {
      if (email) contacts.push({ name: "", email });
    }

    return contacts.filter(
      (c, i, arr) => arr.findIndex((x) => x.email === c.email) === i,
    );
  }
}
