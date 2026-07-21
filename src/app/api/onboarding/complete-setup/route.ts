import { NextResponse } from "next/server";
import { headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { autoPopulateTwin } from "@/lib/intelligence/twin-auto-populate";
import { dispatchNotification } from "@/lib/services/notification-dispatcher";

// POST /api/onboarding/complete-setup
//
// Fired once, right after the wizard sets organizations.onboarding_completed
// = true (src/app/(dashboard)/onboarding/page.tsx handleChoosePlan/handleSkip).
// Runs the three post-onboarding automations end to end and returns a
// summary; the client shows a "Setting up your AI..." screen while this is
// in flight. Every step is independently try/caught — a failure in one
// (e.g. Claude web search timing out) must never block the other two or
// strand the user off the dashboard (Contracts: never block on a non-fatal
// background step).
//
// Uses the same Claude-web-search-backed autoPopulateTwin() call this
// project's AI routes already budget 300s for (see
// benavora-ai-routes-maxduration project memory) — hence maxDuration=300
// here too, and the matching vercel.json functions entry.
export const runtime = "nodejs";
export const maxDuration = 300;

const DISCOVERY_AGENT_ID = "ag-17-discovery";

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.benavora.com").replace(/\/+$/, "");
}

export async function POST() {
  const headersList = headers();
  const orgId = headersList.get("x-organization-id");
  const userId = headersList.get("x-user-id");
  if (!orgId || !userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient();
  const warnings: string[] = [];

  // 1. Twin auto-populate — fills Digital Twin / Knowledge Base gaps from IRS
  // BMF data, foundation_directory, agent_decisions, and Claude web search.
  let twinFieldsPopulated = 0;
  try {
    const result = await autoPopulateTwin(orgId, supabase);
    twinFieldsPopulated = result.fieldsPopulated;
    warnings.push(...result.warnings);
  } catch (err) {
    warnings.push(
      `Twin auto-populate failed: ${err instanceof Error ? err.message : "unknown error"}`,
    );
  }

  // 2. Queue an initial opportunity discovery run so matches are waiting the
  // first time this org visits the dashboard, instead of waiting for the
  // nightly sweep. Same agent_queue insert shape as queueChainedAgent() /
  // POST /api/autonomous/trigger (org_id, agent_id, priority, status,
  // trigger_source) — ag-17-discovery is the real routing id
  // routeQueueItem() (worker/autonomous-orchestrator.ts) matches on, not the
  // agent_registry seed row's shorter "ag-17".
  let discoveryQueued = false;
  try {
    const { error } = await supabase.from("agent_queue").insert({
      org_id: orgId,
      agent_id: DISCOVERY_AGENT_ID,
      priority: 1,
      status: "queued",
      trigger_source: "onboarding",
    });
    if (error) {
      warnings.push(`Discovery queue insert failed: ${error.message}`);
    } else {
      discoveryQueued = true;
    }
  } catch (err) {
    warnings.push(
      `Discovery queue insert failed: ${err instanceof Error ? err.message : "unknown error"}`,
    );
  }

  // 3. Welcome notification — bell (automation_notifications) + email via
  // dispatchNotification(), the system NotificationBell/the /notifications
  // page actually read (see benavora-notification-center-two-systems project
  // memory — this is a different table/pipeline than src/lib/notifications/notify.ts's
  // alerts-table path).
  try {
    const [{ data: org }, { data: profile }] = await Promise.all([
      supabase.from("organizations").select("name").eq("id", orgId).maybeSingle(),
      supabase.from("profiles").select("email").eq("id", userId).maybeSingle(),
    ]);
    const orgName = (org?.name as string | undefined)?.trim() || "your organization";
    const emailTo = (profile?.email as string | undefined) ?? undefined;
    const base = siteUrl();

    await dispatchNotification({
      event_type: "onboarding_welcome",
      organization_id: orgId,
      title: `Welcome to Benavora, ${orgName}!`,
      message:
        `Your account is set up. We populated your AI profile from ${twinFieldsPopulated} ` +
        `data point(s) and queued your first opportunity discovery run — new matches will ` +
        `appear on your dashboard shortly.`,
      email_to: emailTo,
      extra_links: [
        { label: "View your first opportunity matches", href: `${base}/opportunities` },
        { label: "Explore the Intelligence Library", href: `${base}/intelligence-library` },
        { label: "Schedule a demo", href: "https://calendly.com" },
      ],
    });
  } catch (err) {
    warnings.push(
      `Welcome notification failed: ${err instanceof Error ? err.message : "unknown error"}`,
    );
  }

  return NextResponse.json({
    ok: true,
    twinFieldsPopulated,
    discoveryQueued,
    warnings,
  });
}
