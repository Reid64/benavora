import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createClient } from "@/lib/supabase/server";
import { AgentError } from "@/lib/agents/base-agent";
import {
  AutomationSessionManager,
  AutomationSessionError,
} from "@/lib/automation/session-manager";
import { withUsageCheck } from "@/lib/billing/usage-middleware";
import { SubmissionValidator } from "@/lib/autoapply/submission-validator";

// Browser Automation start endpoint (AGENTS.md Agent 16, BEHAVIORAL_CONTRACTS
// §18). POST { applicationId } authenticates the user, derives organization_id
// from their profile (never the body), confirms the application exists and has
// a portal URL, then enqueues the run: navigate → screenshot → detect/fill
// form → upload documents → pause at `awaiting_approval` never happens here.
//
// WGR-167: this route used to instantiate BrowserAutomationAgent and run it
// synchronously, which launches Playwright directly inside this Vercel
// serverless function - there is no Chromium binary here, so every run
// failed. The Railway worker (worker/queue-processor.ts) already has
// Playwright installed and already polls submission_queue, so this route now
// only creates the automation_sessions row (status 'pending', surfaced to the
// caller as "queued") and inserts a submission_queue row pointing at it
// (automation_mode 'browser_automation', automation_session_id set). The
// worker claims that row like any other submission_queue item and runs
// BrowserAutomationAgent itself - see
// worker/queue-processor.ts's processBrowserAutomationItem(). Submission
// still never happens without a human approval, per §18 - that invariant
// lives in AutomationSessionManager/approveAndSubmit, untouched here.

export const runtime = "nodejs";
// Phase 3 sessions may run up to ~5 minutes (BEHAVIORAL_CONTRACTS §18); the
// platform caps this per plan, but the initial fill pass is bounded by
// BaseAgent's 60s ceiling regardless.
export const maxDuration = 300;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

// Per-org rate limit, mirroring the other agent routes (Contracts §16).
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

export async function POST(request: Request) {
  // Starting an automation session is a write action - viewers are read-only
  // (Contracts §16). Final submission additionally requires approval (§18).
  const roleCheck = await requireRole("writer");
  if ("error" in roleCheck) return roleCheck.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { applicationId } = (body ?? {}) as { applicationId?: unknown };
  if (typeof applicationId !== "string" || applicationId.trim() === "") {
    return jsonError("applicationId is required.", "invalid_input", 400);
  }

  const supabase = createClient();

  // Authenticate via the session (Contracts §16).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("Authentication required.", "unauthenticated", 401);
  }

  // Derive organization_id server-side from the profile - never from the body.
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, organization_id")
    .eq("id", user.id)
    .single();
  if (profileError || !profile) {
    return jsonError("Could not resolve your profile.", "no_profile", 403);
  }
  const organizationId = profile.organization_id as string;

  if (isRateLimited(organizationId)) {
    return jsonError(
      "Too many automation runs. Please wait a moment and try again.",
      "rate_limited",
      429,
    );
  }

  // Daily agent_runs quota (usage-limiter tier limits).
  const runLimitBlocked = await withUsageCheck(supabase, organizationId, "agent_runs");
  if (runLimitBlocked) return runLimitBlocked;

  // Browser automation is a Phase 3 feature, gated per organization (SCHEMA
  // platform_config feature.browser_automation; tier limits restrict it to paid
  // plans).
  const { data: flagRow } = await supabase
    .from("platform_config")
    .select("value")
    .eq("organization_id", organizationId)
    .eq("key", "feature.browser_automation")
    .maybeSingle();
  if ((flagRow?.value as string | undefined) !== "true") {
    return jsonError(
      "Browser automation is not enabled for your organization.",
      "feature_disabled",
      403,
    );
  }

  // Mutual exclusion vs. the other AutoApply pipeline (submission_queue /
  // worker/queue-processor.ts, Railway) — both can independently target the
  // same org+funder with no shared lock otherwise. Resolve the funder the
  // same way BrowserAutomationAgent's own loadContext() does (application ->
  // opportunity -> funder); if it can't be resolved here either, skip the
  // check and let agent.run() surface its own "no target URL" error shortly.
  const { data: applicationRow } = await supabase
    .from("applications")
    .select("opportunity_id")
    .eq("id", applicationId.trim())
    .eq("organization_id", organizationId)
    .maybeSingle();

  const opportunityId = (applicationRow?.opportunity_id as string | null) ?? null;
  let conflictFunderId: string | null = null;
  let targetUrl: string | null = null;
  if (opportunityId) {
    const { data: opportunityRow } = await supabase
      .from("opportunities")
      .select("funder_id")
      .eq("id", opportunityId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    conflictFunderId = (opportunityRow?.funder_id as string | null) ?? null;

    if (conflictFunderId) {
      const { data: funderRow } = await supabase
        .from("funders")
        .select("giving_portal_url")
        .eq("id", conflictFunderId)
        .maybeSingle();
      targetUrl = (funderRow?.giving_portal_url as string | null) ?? null;
    }
  }

  if (conflictFunderId) {
    const { conflict } = await new SubmissionValidator().checkConcurrentSubmissionQueue(
      organizationId,
      conflictFunderId,
      supabase,
    );

    if (conflict) {
      return jsonError(
        "This funder already has a pending AutoApply submission queued for your organization. Wait for it to finish, or cancel it, before starting a manual browser-automation session.",
        "concurrent_submission_queue_conflict",
        409,
      );
    }
  }

  const sessions = new AutomationSessionManager({
    client: supabase,
    organizationId,
  });

  try {
    const session = await sessions.createSession({
      applicationId: applicationId.trim(),
      opportunityId,
      funderId: conflictFunderId,
      targetUrl,
      startedBy: profile.id as string,
    });

    const { error: enqueueError } = await supabase.from("submission_queue").insert({
      organization_id: organizationId,
      funder_id: conflictFunderId,
      automation_mode: "browser_automation",
      automation_session_id: session.id,
      status: "pending",
    });

    if (enqueueError) {
      await sessions
        .markFailed(session.id, `Failed to enqueue for the automation worker: ${enqueueError.message}`)
        .catch(() => undefined);
      return jsonError(
        "Failed to queue the automation session. Please try again.",
        "enqueue_failed",
        500,
      );
    }

    return NextResponse.json({ sessionId: session.id, status: "queued" });
  } catch (err) {
    if (err instanceof AgentError) {
      return jsonError(err.message, err.code, err.status);
    }
    if (err instanceof AutomationSessionError) {
      return jsonError(err.message, err.code, 500);
    }
    return jsonError(
      "Browser automation failed to start. Please try again.",
      "automation_failed",
      500,
    );
  }
}
