// Thread auto-linking engine.
//
// SERVER-ONLY. Links synced_email_threads to funders/contacts via email_thread_links
// using three strategies (email match → domain match → Claude AI fallback).

import Anthropic from "@anthropic-ai/sdk";

import { createTrackedAnthropic } from "@/lib/ai/tracked-anthropic";
import { createAdminClient } from "@/lib/supabase/admin";

export interface LinkResult {
  linked: boolean;
  method: "email" | "domain" | "ai" | "none";
  funder_id: string | null;
  contact_id: string | null;
  confidence?: number;
}

let _anthropic: Anthropic | null = null;

function getAnthropic(): Anthropic {
  if (_anthropic) return _anthropic;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
  _anthropic = createTrackedAnthropic({ apiKey }, "thread-linker");
  return _anthropic;
}

const COMMON_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "live.com",
  "msn.com",
  "protonmail.com",
  "googlemail.com",
]);

function isCommonDomain(domain: string): boolean {
  return COMMON_DOMAINS.has(domain.toLowerCase());
}

function extractDomain(url: string): string | null {
  try {
    const normalized = url.startsWith("http") ? url : `https://${url}`;
    const hostname = new URL(normalized).hostname;
    return hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export class ThreadLinker {
  private async writeLink(
    supabase: ReturnType<typeof createAdminClient>,
    orgId: string,
    threadId: string,
    funderId: string | null,
    contactId: string | null,
    matchType: string,
  ): Promise<void> {
    await supabase
      .from("email_thread_links")
      .delete()
      .eq("organization_id", orgId)
      .eq("thread_id", threadId);

    await supabase.from("email_thread_links").insert({
      organization_id: orgId,
      thread_id: threadId,
      funder_id: funderId,
      contact_id: contactId,
      match_type: matchType,
    });
  }

  async autoLinkThread(threadId: string, orgId: string): Promise<LinkResult> {
    const supabase = createAdminClient();

    // 1. Fetch thread metadata.
    const { data: thread } = await supabase
      .from("synced_email_threads")
      .select("id, subject, snippet")
      .eq("id", threadId)
      .eq("organization_id", orgId)
      .single();

    if (!thread) {
      return { linked: false, method: "none", funder_id: null, contact_id: null };
    }

    const typedThread = thread as { id: string; subject: string | null; snippet: string | null };

    // 2. Fetch all messages for this thread.
    const { data: messages } = await supabase
      .from("synced_email_messages")
      .select("from_email, to_emails, cc_emails")
      .eq("thread_id", threadId)
      .eq("organization_id", orgId);

    // 3. Collect all unique email addresses across from/to/cc.
    const emailSet = new Set<string>();
    for (const msg of messages ?? []) {
      const m = msg as {
        from_email: string | null;
        to_emails: string[] | null;
        cc_emails: string[] | null;
      };
      if (m.from_email) emailSet.add(m.from_email.toLowerCase());
      for (const e of m.to_emails ?? []) emailSet.add(e.toLowerCase());
      for (const e of m.cc_emails ?? []) emailSet.add(e.toLowerCase());
    }
    const emails = Array.from(emailSet);

    // 4. Contact email match — direct lookup.
    if (emails.length > 0) {
      const { data: contacts } = await supabase
        .from("contacts")
        .select("id, funder_id, email")
        .eq("organization_id", orgId)
        .in("email", emails);

      const match = (contacts ?? []).find(
        (c) => (c as { email: string | null }).email !== null,
      ) as { id: string; funder_id: string; email: string } | undefined;

      if (match?.funder_id) {
        await this.writeLink(supabase, orgId, threadId, match.funder_id, match.id, "auto_email");
        return {
          linked: true,
          method: "email",
          funder_id: match.funder_id,
          contact_id: match.id,
        };
      }
    }

    // 5. Domain match against funder websites.
    const participantDomains = emails
      .map((e) => e.split("@")[1])
      .filter((d): d is string => !!d && !isCommonDomain(d));

    if (participantDomains.length > 0) {
      const { data: funders } = await supabase
        .from("funders")
        .select("id, website")
        .eq("organization_id", orgId)
        .not("website", "is", null);

      const funderMatch = (funders ?? []).find((f) => {
        const fd = extractDomain(
          (f as { id: string; website: string | null }).website ?? "",
        );
        return fd && participantDomains.includes(fd);
      }) as { id: string } | undefined;

      if (funderMatch) {
        await this.writeLink(supabase, orgId, threadId, funderMatch.id, null, "auto_domain");
        return {
          linked: true,
          method: "domain",
          funder_id: funderMatch.id,
          contact_id: null,
        };
      }
    }

    // 6. Claude AI fallback — classify thread and name-search for a matching funder.
    const aiPrompt = [
      `Subject: ${typedThread.subject ?? "(no subject)"}`,
      `Snippet: ${typedThread.snippet ?? "(no snippet)"}`,
      `Participants: ${emails.join(", ") || "(none)"}`,
    ].join("\n");

    try {
      const anthropic = getAnthropic();
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 256,
        system:
          "Given this email thread metadata, identify if it relates to a grant funder, opportunity, or application. Return JSON: { funder_name?: string, opportunity_keywords?: string[], confidence: number }",
        messages: [{ role: "user", content: aiPrompt }],
      });

      const text =
        response.content[0]?.type === "text" ? response.content[0].text : "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { linked: false, method: "none", funder_id: null, contact_id: null };
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        funder_name?: string;
        opportunity_keywords?: string[];
        confidence: number;
      };
      const confidence = parsed.confidence ?? 0;
      const funderName = parsed.funder_name;

      if (confidence > 0.7 && funderName) {
        const searchName = funderName.toLowerCase();
        const { data: funders } = await supabase
          .from("funders")
          .select("id, name")
          .eq("organization_id", orgId);

        const funderMatch = (funders ?? []).find((f) => {
          const fn = ((f as { name: string }).name ?? "").toLowerCase();
          return fn.includes(searchName) || searchName.includes(fn);
        }) as { id: string } | undefined;

        if (funderMatch) {
          await this.writeLink(supabase, orgId, threadId, funderMatch.id, null, "auto_ai");
          return {
            linked: true,
            method: "ai",
            funder_id: funderMatch.id,
            contact_id: null,
            confidence,
          };
        }
      }

      return { linked: false, method: "none", funder_id: null, contact_id: null, confidence };
    } catch {
      return { linked: false, method: "none", funder_id: null, contact_id: null };
    }
  }

  async bulkAutoLink(orgId: string): Promise<{ linked: number; unlinked: number }> {
    const supabase = createAdminClient();

    // Collect thread IDs that already have a link record.
    const { data: existingLinks } = await supabase
      .from("email_thread_links")
      .select("thread_id")
      .eq("organization_id", orgId);

    const linkedIds = new Set(
      (existingLinks ?? []).map(
        (r) => (r as { thread_id: string }).thread_id,
      ),
    );

    // All threads for this org.
    const { data: threads } = await supabase
      .from("synced_email_threads")
      .select("id")
      .eq("organization_id", orgId);

    const unlinkedThreads = (threads ?? []).filter(
      (t) => !linkedIds.has((t as { id: string }).id),
    );

    let linked = 0;
    let unlinked = 0;

    for (const t of unlinkedThreads) {
      const result = await this.autoLinkThread((t as { id: string }).id, orgId);
      if (result.linked) {
        linked++;
      } else {
        unlinked++;
      }
    }

    return { linked, unlinked };
  }
}
