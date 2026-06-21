// SERVER-ONLY. Extracts enriched contact information from synced email threads
// by combining header parsing with Claude AI analysis.

import { callClaude } from "@/lib/ai/claude";
import { createAdminClient } from "@/lib/supabase/admin";

export interface RichExtractedContact {
  name: string;
  email: string;
  title: string | null;
  organization: string | null;
  phone: string | null;
  role_context: string | null;
  suggested_funder_id: string | null;
  suggested_funder_name: string | null;
  is_duplicate: boolean;
  existing_contact_id: string | null;
}

export interface ContactSuggestion {
  thread_id: string;
  thread_subject: string | null;
  contacts: RichExtractedContact[];
  confidence: number;
}

interface ClaudeContactRow {
  name?: unknown;
  email?: unknown;
  title?: unknown;
  organization?: unknown;
  phone?: unknown;
  role_context?: unknown;
}

interface MessageRow {
  from_email: string | null;
  from_name: string | null;
  to_emails: string[] | null;
  cc_emails: string[] | null;
  body_text: string | null;
  sent_at: string | null;
}

interface ThreadRow {
  id: string;
  subject: string | null;
}

interface ExistingContactRow {
  id: string;
  email: string | null;
  funder_id: string;
}

interface FunderRow {
  id: string;
  name: string;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export class EmailContactExtractor {
  async extractFromThread(
    threadId: string,
    orgId: string,
  ): Promise<RichExtractedContact[]> {
    const supabase = createAdminClient();

    const { data: rawMessages, error } = await supabase
      .from("synced_email_messages")
      .select("from_email, from_name, to_emails, cc_emails, body_text, sent_at")
      .eq("thread_id", threadId)
      .order("sent_at", { ascending: true })
      .limit(3);

    if (error || !rawMessages || rawMessages.length === 0) return [];
    const messages = rawMessages as MessageRow[];

    // Collect email -> name from headers (from, to, cc).
    const headerMap = new Map<string, string>();
    for (const msg of messages) {
      if (msg.from_email) {
        headerMap.set(msg.from_email.toLowerCase(), msg.from_name ?? "");
      }
      for (const e of msg.to_emails ?? []) {
        if (e && !headerMap.has(e.toLowerCase())) {
          headerMap.set(e.toLowerCase(), "");
        }
      }
      for (const e of msg.cc_emails ?? []) {
        if (e && !headerMap.has(e.toLowerCase())) {
          headerMap.set(e.toLowerCase(), "");
        }
      }
    }

    // Build body text for Claude (first 3 messages, max 10K chars).
    const bodyText = messages
      .map((m) => m.body_text ?? "")
      .join("\n---\n")
      .slice(0, 10_000);

    // Ask Claude to enrich contacts from the body.
    let claudeContacts: ClaudeContactRow[] = [];
    if (bodyText.trim().length > 50) {
      try {
        const response = await callClaude({
          system:
            'Extract contact information from these emails. For each person mentioned, return a JSON array: [{"name": string, "email": string, "title": string, "organization": string, "phone": string, "role_context": string}]. Only include people who appear to work at a funder or partner organization. Exclude the sender\'s own organization. Return ONLY valid JSON, no other text.',
          prompt: bodyText,
          maxTokens: 1024,
          temperature: 0,
        });
        const jsonMatch = response.text.trim().match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed: unknown = JSON.parse(jsonMatch[0]);
          if (Array.isArray(parsed)) {
            claudeContacts = parsed as ClaudeContactRow[];
          }
        }
      } catch {
        // Non-fatal: fall back to header-only extraction.
      }
    }

    // Merge: header map as base, Claude enriches with extra fields.
    const merged = new Map<string, ClaudeContactRow>();
    for (const [email, name] of headerMap) {
      merged.set(email, { email, name });
    }
    for (const c of claudeContacts) {
      const rawEmail = str(c.email);
      if (!rawEmail) continue;
      const key = rawEmail.toLowerCase();
      merged.set(key, { ...merged.get(key), ...c, email: key });
    }

    // Load existing contacts to detect duplicates.
    const emailList = Array.from(merged.keys());
    if (emailList.length === 0) return [];

    const { data: rawExisting } = await supabase
      .from("contacts")
      .select("id, email, funder_id")
      .eq("organization_id", orgId)
      .in("email", emailList);

    const existingByEmail = new Map<string, ExistingContactRow>();
    for (const row of (rawExisting ?? []) as ExistingContactRow[]) {
      if (row.email) existingByEmail.set(row.email.toLowerCase(), row);
    }

    // Load funders to suggest linkage by organization name.
    const { data: rawFunders } = await supabase
      .from("funders")
      .select("id, name")
      .eq("organization_id", orgId);

    const funderByName = new Map<string, FunderRow>();
    for (const f of (rawFunders ?? []) as FunderRow[]) {
      funderByName.set(f.name.toLowerCase(), f);
    }

    const results: RichExtractedContact[] = [];
    for (const [email, contact] of merged) {
      const existing = existingByEmail.get(email);
      const orgName = str(contact.organization);
      const funderMatch = orgName
        ? (funderByName.get(orgName.toLowerCase()) ?? null)
        : null;

      results.push({
        name: str(contact.name) ?? "",
        email,
        title: str(contact.title),
        organization: orgName,
        phone: str(contact.phone),
        role_context: str(contact.role_context),
        suggested_funder_id: existing?.funder_id ?? funderMatch?.id ?? null,
        suggested_funder_name: funderMatch?.name ?? null,
        is_duplicate: Boolean(existing),
        existing_contact_id: existing?.id ?? null,
      });
    }

    return results;
  }

  async suggestNewContacts(
    orgId: string,
    limit = 20,
  ): Promise<ContactSuggestion[]> {
    const supabase = createAdminClient();

    const { data: rawThreads } = await supabase
      .from("synced_email_threads")
      .select("id, subject")
      .eq("organization_id", orgId)
      .order("last_message_at", { ascending: false })
      .limit(limit * 4);

    if (!rawThreads || rawThreads.length === 0) return [];
    const threads = rawThreads as ThreadRow[];

    // Build a set of all known contact emails for this org.
    const { data: rawKnown } = await supabase
      .from("contacts")
      .select("email")
      .eq("organization_id", orgId);

    const knownEmails = new Set(
      (rawKnown ?? [])
        .map((c: { email: string | null }) => c.email?.toLowerCase())
        .filter((e): e is string => Boolean(e)),
    );

    const suggestions: ContactSuggestion[] = [];

    for (const thread of threads) {
      if (suggestions.length >= limit) break;

      const { data: rawMsgs } = await supabase
        .from("synced_email_messages")
        .select("from_email, from_name, to_emails, cc_emails")
        .eq("thread_id", thread.id)
        .limit(5);

      if (!rawMsgs || rawMsgs.length === 0) continue;
      const msgs = rawMsgs as Pick<
        MessageRow,
        "from_email" | "from_name" | "to_emails" | "cc_emails"
      >[];

      // Find emails in this thread that are not in the CRM.
      const newEmails = new Map<string, string>();
      let totalEmailsSeen = 0;
      for (const msg of msgs) {
        totalEmailsSeen++;
        if (msg.from_email) {
          if (!knownEmails.has(msg.from_email.toLowerCase())) {
            newEmails.set(msg.from_email.toLowerCase(), msg.from_name ?? "");
          }
        }
        for (const e of msg.to_emails ?? []) {
          totalEmailsSeen++;
          if (e && !knownEmails.has(e.toLowerCase())) {
            newEmails.set(e.toLowerCase(), "");
          }
        }
        for (const e of msg.cc_emails ?? []) {
          totalEmailsSeen++;
          if (e && !knownEmails.has(e.toLowerCase())) {
            newEmails.set(e.toLowerCase(), "");
          }
        }
      }

      if (newEmails.size === 0) continue;

      const contacts: RichExtractedContact[] = Array.from(newEmails).map(
        ([email, name]) => ({
          name,
          email,
          title: null,
          organization: null,
          phone: null,
          role_context: null,
          suggested_funder_id: null,
          suggested_funder_name: null,
          is_duplicate: false,
          existing_contact_id: null,
        }),
      );

      const confidence = Math.min(
        0.95,
        0.5 + (newEmails.size / Math.max(1, totalEmailsSeen)) * 0.5,
      );

      suggestions.push({
        thread_id: thread.id,
        thread_subject: thread.subject,
        contacts,
        confidence: Math.round(confidence * 100) / 100,
      });
    }

    return suggestions;
  }
}
