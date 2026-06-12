// Email Matching Agent — AGENTS.md Agent 17 (BLUEPRINT Phase 4).
//
// Persists synced Gmail threads/messages and links each to a CRM record by its
// sender. Matching priority (BEHAVIORAL_CONTRACTS §19): exact email on a CRM
// contact → exact email on an outreach contact → funder domain match → no match.
// A thread is linked to exactly one record per matched correspondent, and links
// are de-duplicated so re-syncs are idempotent.
//
// Extends BaseAgent: one sync run logs a single agent_runs row (agent_type
// 'email_matching', migration 006) with item counts. Every query is explicitly
// scoped by organization_id — correct under the service-role client too (§2,§15).

import {
  AgentError,
  BaseAgent,
  type AgentExecution,
} from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";
import type { TablesInsert } from "@/types/database";
import type { ParsedGmailMessage } from "@/lib/integrations/google/gmail";

export type EmailMatchType = "contact" | "outreach" | "funder" | "none";

export interface EmailMatchResult {
  matchType: EmailMatchType;
  recordId?: string;
  recordName?: string;
}

export interface EmailMatcherInput {
  /** Normalized messages to persist and match, newest or oldest order is fine. */
  emails: ParsedGmailMessage[];
}

export interface EmailMatcherResult {
  /** Messages persisted this run. */
  synced: number;
  /** Messages whose sender resolved to a CRM record. */
  matched: number;
  /** Messages with no matching record. */
  unmatched: number;
}

/** Map a match type to the email_thread_links.match_type value it records. */
function linkMatchType(type: EmailMatchType): string {
  return type === "funder" ? "auto_domain" : "auto_email";
}

export class EmailMatcherAgent extends BaseAgent<
  EmailMatcherInput,
  EmailMatcherResult
> {
  readonly agentType: AgentType = "email_matching";

  /** Cache of gmail_thread_id → synced_email_threads.id within one run. */
  private readonly threadIdCache = new Map<string, string>();
  /** Cache of org funders with a website, loaded lazily for domain matching. */
  private funderDomainCache:
    | Array<{ id: string; name: string; domain: string }>
    | null = null;

  protected async execute(
    input: EmailMatcherInput,
  ): Promise<AgentExecution<EmailMatcherResult>> {
    const emails = input.emails ?? [];
    let synced = 0;
    let matched = 0;
    let unmatched = 0;

    for (const email of emails) {
      if (!email.gmailMessageId || !email.gmailThreadId) continue;

      const threadId = await this.ensureThread(email);
      if (!threadId) continue;

      await this.upsertMessage(threadId, email);
      synced += 1;

      const match = await this.matchEmailToRecords(email);
      if (match.matchType === "none") {
        unmatched += 1;
        continue;
      }
      matched += 1;
      await this.ensureLink(threadId, match);
    }

    return {
      data: { synced, matched, unmatched },
      outputSummary: `Synced ${synced} message${
        synced === 1 ? "" : "s"
      }: ${matched} matched, ${unmatched} unmatched.`,
      itemsFound: synced,
      itemsProcessed: matched,
    };
  }

  /**
   * Match a message's sender to a CRM record. Priority: exact email on contacts,
   * then exact email on outreach_contacts, then funder website-domain match.
   */
  async matchEmailToRecords(
    email: ParsedGmailMessage,
  ): Promise<EmailMatchResult> {
    const from = email.fromEmail?.trim().toLowerCase();
    if (!from) return { matchType: "none" };

    // 1) CRM contact, exact email.
    const { data: contact } = await this.client
      .from("contacts")
      .select("id, name")
      .eq("organization_id", this.organizationId)
      .ilike("email", from)
      .limit(1)
      .maybeSingle();
    if (contact) {
      return {
        matchType: "contact",
        recordId: contact.id as string,
        recordName: contact.name as string,
      };
    }

    // 2) Outreach contact, exact email.
    const { data: outreach } = await this.client
      .from("outreach_contacts")
      .select("id, company_name, contact_name")
      .eq("organization_id", this.organizationId)
      .ilike("email", from)
      .limit(1)
      .maybeSingle();
    if (outreach) {
      return {
        matchType: "outreach",
        recordId: outreach.id as string,
        recordName:
          (outreach.contact_name as string | null) ??
          (outreach.company_name as string),
      };
    }

    // 3) Funder by website domain.
    const domain = emailDomain(from);
    if (domain) {
      const funder = (await this.loadFunderDomains()).find((f) =>
        domainsMatch(domain, f.domain),
      );
      if (funder) {
        return {
          matchType: "funder",
          recordId: funder.id,
          recordName: funder.name,
        };
      }
    }

    return { matchType: "none" };
  }

  // --- persistence -----------------------------------------------------------

  /** Upsert the thread row for a message, returning its id (cached per run). */
  private async ensureThread(
    email: ParsedGmailMessage,
  ): Promise<string | null> {
    const cached = this.threadIdCache.get(email.gmailThreadId);
    if (cached) return cached;

    const row: TablesInsert<"synced_email_threads"> = {
      organization_id: this.organizationId,
      gmail_thread_id: email.gmailThreadId,
      subject: email.subject,
      snippet: email.snippet,
      last_message_at: email.sentAt,
      labels: email.labels.length > 0 ? email.labels : null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await this.client
      .from("synced_email_threads")
      .upsert(row, { onConflict: "organization_id,gmail_thread_id" })
      .select("id")
      .single();

    if (error || !data) {
      throw new AgentError(
        "Failed to persist an email thread.",
        "write_failed",
      );
    }
    const id = data.id as string;
    this.threadIdCache.set(email.gmailThreadId, id);
    return id;
  }

  /** Upsert one message under its thread (idempotent on gmail_message_id). */
  private async upsertMessage(
    threadId: string,
    email: ParsedGmailMessage,
  ): Promise<void> {
    const row: TablesInsert<"synced_email_messages"> = {
      organization_id: this.organizationId,
      thread_id: threadId,
      gmail_message_id: email.gmailMessageId,
      from_email: email.fromEmail,
      from_name: email.fromName,
      to_emails: email.toEmails.length > 0 ? email.toEmails : null,
      cc_emails: email.ccEmails.length > 0 ? email.ccEmails : null,
      subject: email.subject,
      body_text: email.bodyText,
      body_html: email.bodyHtml,
      sent_at: email.sentAt,
      has_attachments: email.hasAttachments,
      attachment_names:
        email.attachmentNames.length > 0 ? email.attachmentNames : null,
    };

    const { error } = await this.client
      .from("synced_email_messages")
      .upsert(row, { onConflict: "organization_id,gmail_message_id" });

    if (error) {
      throw new AgentError(
        "Failed to persist an email message.",
        "write_failed",
      );
    }
  }

  /** Create the thread→record link if an identical one doesn't already exist. */
  private async ensureLink(
    threadId: string,
    match: EmailMatchResult,
  ): Promise<void> {
    if (!match.recordId || match.matchType === "none") return;

    const column =
      match.matchType === "contact"
        ? "contact_id"
        : match.matchType === "outreach"
          ? "outreach_contact_id"
          : "funder_id";

    // Skip if this exact link already exists (re-sync idempotency).
    const { data: existing } = await this.client
      .from("email_thread_links")
      .select("id")
      .eq("organization_id", this.organizationId)
      .eq("thread_id", threadId)
      .eq(column, match.recordId)
      .limit(1)
      .maybeSingle();
    if (existing) return;

    const row: TablesInsert<"email_thread_links"> = {
      organization_id: this.organizationId,
      thread_id: threadId,
      funder_id: match.matchType === "funder" ? match.recordId : null,
      contact_id: match.matchType === "contact" ? match.recordId : null,
      outreach_contact_id:
        match.matchType === "outreach" ? match.recordId : null,
      match_type: linkMatchType(match.matchType),
    };

    await this.client.from("email_thread_links").insert(row);
  }

  /** Lazily load this org's funders that have a website, parsed to bare domains. */
  private async loadFunderDomains(): Promise<
    Array<{ id: string; name: string; domain: string }>
  > {
    if (this.funderDomainCache) return this.funderDomainCache;

    const { data } = await this.client
      .from("funders")
      .select("id, name, website")
      .eq("organization_id", this.organizationId)
      .not("website", "is", null)
      .limit(1000);

    this.funderDomainCache = (data ?? [])
      .map((f) => ({
        id: f.id as string,
        name: f.name as string,
        domain: hostFromWebsite(f.website as string | null),
      }))
      .filter((f): f is { id: string; name: string; domain: string } =>
        Boolean(f.domain),
      );
    return this.funderDomainCache;
  }
}

// --- domain helpers ----------------------------------------------------------

/** The domain part of an email address, lowercased and de-www'd; null if none. */
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at === -1) return null;
  const domain = email.slice(at + 1).trim().toLowerCase().replace(/^www\./, "");
  return domain || null;
}

/** Parse a website URL/host into a bare registrable-ish domain, or "". */
export function hostFromWebsite(website: string | null): string {
  if (!website) return "";
  let value = website.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, "");
  value = value.split("/")[0] ?? "";
  value = value.split("?")[0] ?? "";
  value = value.split("#")[0] ?? "";
  value = value.replace(/^www\./, "");
  return value;
}

/** True if an email domain matches a funder domain (equal or a subdomain of it). */
export function domainsMatch(emailDom: string, funderDom: string): boolean {
  if (!emailDom || !funderDom) return false;
  return emailDom === funderDom || emailDom.endsWith(`.${funderDom}`);
}
