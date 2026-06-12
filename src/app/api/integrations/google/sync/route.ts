import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { AgentError } from "@/lib/agents/base-agent";
import {
  getAuthorizedClient,
  GOOGLE_PROVIDER,
  isConnected,
} from "@/lib/integrations/google/auth";
import { EmailMatcherAgent } from "@/lib/integrations/google/email-matcher";
import {
  GmailSync,
  type ParsedGmailMessage,
} from "@/lib/integrations/google/gmail";

// Gmail sync trigger (BLUEPRINT Phase 4, Contracts §19).
//
// POST fetches the org's recent inbox messages (last 100, or since the last sync,
// whichever is fewer), normalizes them, and runs the Email Matching Agent to
// persist threads/messages and link each to a CRM record by sender. Manual
// trigger only in MVP (§19: "no auto-polling"). Returns { synced, matched,
// unmatched }.
//
// Authenticates via the session and derives organization_id server-side from the
// profile — never from the request body (Contracts §2, §16).

export const runtime = "nodejs";

/** Contracts §19: pull at most the last 100 messages per sync. */
const MAX_MESSAGES = 100;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

// Per-org rate limit, mirroring the other agent routes (in-memory; a shared
// store is the production fix for multi-instance deployments).
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function isRateLimited(orgId: string): boolean {
  const now = Date.now();
  const recent = (hits.get(orgId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    hits.set(orgId, recent);
    return true;
  }
  recent.push(now);
  hits.set(orgId, recent);
  return false;
}

/** Build the Gmail search query, scoped to inbox and bounded by last sync. */
function buildQuery(lastSyncAt: string | null): string {
  const base = "in:inbox";
  if (!lastSyncAt) return base;
  const ms = Date.parse(lastSyncAt);
  if (Number.isNaN(ms)) return base;
  const seconds = Math.floor(ms / 1000);
  return `${base} after:${seconds}`;
}

export async function POST() {
  // A sync writes synced threads/messages — a create/edit action (task §6).
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, userId, organizationId } = gate;

  if (isRateLimited(organizationId)) {
    return jsonError(
      "Too many sync requests. Please wait a moment and try again.",
      "rate_limited",
      429,
    );
  }

  if (!(await isConnected(organizationId))) {
    return jsonError(
      "Google is not connected. Connect it from Settings first.",
      "not_connected",
      400,
    );
  }

  // Read the last sync time to bound the query (RLS allows the org's own row).
  const { data: integration } = await supabase
    .from("integrations")
    .select("last_sync_at")
    .eq("organization_id", organizationId)
    .eq("provider", GOOGLE_PROVIDER)
    .maybeSingle();
  const lastSyncAt = (integration?.last_sync_at as string | null) ?? null;

  let parsedEmails: ParsedGmailMessage[] = [];
  try {
    const auth = await getAuthorizedClient(organizationId);
    const gmail = new GmailSync(auth);
    const stubs = await gmail.listMessages(buildQuery(lastSyncAt), MAX_MESSAGES);

    // Fetch + normalize each message. A single message failure is skipped, not
    // fatal — the rest of the sync still completes.
    const settled = await Promise.all(
      stubs.map(async (stub) => {
        try {
          const full = await gmail.getMessage(stub.id);
          return gmail.toParsedMessage(full);
        } catch {
          return null;
        }
      }),
    );
    parsedEmails = settled.filter(
      (m): m is NonNullable<typeof m> => m !== null,
    );
  } catch {
    return jsonError(
      "Could not reach Gmail. Try reconnecting Google.",
      "gmail_failed",
      502,
    );
  }

  const agent = new EmailMatcherAgent({
    client: supabase,
    organizationId,
    triggeredBy: userId,
  });

  try {
    const outcome = await agent.run({ emails: parsedEmails });

    // Stamp the sync time so the next run only pulls newer mail.
    await supabase
      .from("integrations")
      .update({
        last_sync_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", organizationId)
      .eq("provider", GOOGLE_PROVIDER);

    return NextResponse.json(outcome.data);
  } catch (err) {
    if (err instanceof AgentError) {
      return jsonError(err.message, err.code, err.status);
    }
    return jsonError("Email sync failed. Please try again.", "sync_failed", 500);
  }
}
