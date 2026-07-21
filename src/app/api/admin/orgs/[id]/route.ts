import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit/logger";
import { NARRATIVE_CATEGORIES } from "@/lib/utils/constants";
import { createPortalSession } from "@/lib/payments/stripe";

// GET/POST /api/admin/orgs/[id] — platform-admin org detail + actions.
// Owner-only, same gate as /admin/orgs/[id] and the sibling /suspend route.
// Every query is explicitly scoped to this org's id via the service-role
// client — a cross-tenant admin tool looking INTO one tenant, not that
// tenant's own RLS-scoped session (mirrors /admin/orgs/[id]/page.tsx).
export const runtime = "nodejs";

type RouteContext = { params: { id: string } };

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

// The live org_autonomous_config columns (per /api/autonomous/config/route.ts)
// diverge from SCHEMA_REGISTRY_v2.md's documented shape — this is the real,
// currently-read/written column set, not the one written into the doc.
const AUTONOMOUS_CONFIG_SELECT =
  "auto_research_enabled, auto_score_enabled, auto_draft_enabled, " +
  "auto_draft_threshold, auto_reputation_enabled, auto_relationship_enabled, " +
  "auto_deadline_prediction_enabled, auto_followup_enabled, " +
  "auto_autoapply_enabled, max_nightly_autoapply_submissions, " +
  "notify_on_auto_draft, notify_on_high_score, notify_digest_time, " +
  "max_auto_drafts_per_night";

export async function GET(_request: Request, { params }: RouteContext) {
  const gate = await requireRole("owner");
  if ("error" in gate) return gate.error;

  const orgId = params.id;
  const admin = createAdminClient();

  const orgRes = await admin
    .from("organizations")
    .select("*")
    .eq("id", orgId)
    .single();

  if (orgRes.error || !orgRes.data) {
    return jsonError("Organization not found.", "not_found", 404);
  }

  const [
    subRes,
    kbRes,
    agentRunsRes,
    strategicRecsRes,
    opportunitiesRes,
    autonomousConfigRes,
  ] = await Promise.all([
    admin
      .from("subscriptions")
      .select("status, stripe_subscription_id, current_period_end")
      .eq("organization_id", orgId)
      .maybeSingle(),
    admin.from("knowledge_base").select("category").eq("organization_id", orgId),
    admin
      .from("agent_runs")
      .select(
        "id, agent_type, status, items_found, items_processed, error_message, duration_ms, trigger_source, created_at, completed_at",
      )
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      .from("strategic_recommendations")
      .select(
        "id, recommendation_category, title, recommendation, urgency, confidence_score, status, generated_at",
      )
      .eq("org_id", orgId)
      .order("generated_at", { ascending: false })
      .limit(50),
    admin
      .from("opportunities")
      .select("id, name, category, deadline, status, probability_score")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false }),
    admin
      .from("org_autonomous_config")
      .select(AUTONOMOUS_CONFIG_SELECT)
      .eq("org_id", orgId)
      .maybeSingle(),
  ]);

  const kbCategories = new Set(
    ((kbRes.data ?? []) as { category: string }[]).map((row) => row.category),
  );
  const kbCompletenessPct = Math.round(
    (kbCategories.size / NARRATIVE_CATEGORIES.length) * 100,
  );

  return NextResponse.json({
    organization: orgRes.data,
    subscription: subRes.data ?? null,
    kbCompleteness: {
      percent: kbCompletenessPct,
      categoriesPresent: kbCategories.size,
      categoriesTotal: NARRATIVE_CATEGORIES.length,
    },
    agentRuns: agentRunsRes.data ?? [],
    strategicRecommendations: strategicRecsRes.data ?? [],
    opportunities: opportunitiesRes.data ?? [],
    autonomousConfig: autonomousConfigRes.data ?? null,
  });
}

export async function POST(request: Request, { params }: RouteContext) {
  const gate = await requireRole("owner");
  if ("error" in gate) return gate.error;
  const { userId } = gate;

  const orgId = params.id;
  const admin = createAdminClient();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }
  const { action } = (body ?? {}) as { action?: unknown };

  const orgRes = await admin
    .from("organizations")
    .select("id")
    .eq("id", orgId)
    .single();
  if (orgRes.error || !orgRes.data) {
    return jsonError("Organization not found.", "not_found", 404);
  }

  if (action === "run_pipeline") {
    // Queues the head of the autonomous chain (ag-17 Discovery ->
    // ag-15 Probability -> ag-05 Draft) for this org, same mechanism as the
    // org's own manual trigger at /api/autonomous/trigger — just issued by a
    // platform admin against a target org instead of the caller's own org.
    const { data, error } = await admin
      .from("agent_queue")
      .insert({
        org_id: orgId,
        agent_id: "ag-17",
        priority: 9,
        // The live worker/autonomous-orchestrator.ts processor only claims rows
        // with status='queued' (never the schema doc's documented 'pending'
        // default) — matches /api/autonomous/trigger's precedent exactly.
        status: "queued",
        trigger_source: "manual",
      })
      .select("id")
      .single();

    if (error || !data) {
      return jsonError("Could not queue the pipeline run.", "queue_failed", 500);
    }

    await logAudit(admin, {
      organizationId: orgId,
      userId,
      action: "agent_run",
      entityType: "agent_queue",
      entityId: (data as { id: string }).id,
      details: { admin_action: "run_pipeline", agent_id: "ag-17" },
      request,
    });

    return NextResponse.json({ ok: true, queueItemId: (data as { id: string }).id });
  }

  if (action === "reset_onboarding") {
    const { data, error } = await admin
      .from("organizations")
      .update({
        onboarding_completed: false,
        onboarding_completed_at: null,
        onboarding_step: 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", orgId)
      .select("id, onboarding_completed, onboarding_step")
      .single();

    if (error || !data) {
      return jsonError("Could not reset onboarding.", "update_failed", 500);
    }

    await logAudit(admin, {
      organizationId: orgId,
      userId,
      action: "update",
      entityType: "organization",
      entityId: orgId,
      details: { admin_action: "reset_onboarding" },
      request,
    });

    return NextResponse.json({ ok: true, organization: data });
  }

  if (action === "upgrade_plan") {
    // Opens the Stripe Billing Portal for this org (createPortalSession takes
    // an explicit orgId — it's not session-derived — so a platform admin can
    // open it for any tenant, same helper /api/billing uses for the org's own
    // owner).
    try {
      const { url } = await createPortalSession(orgId);
      await logAudit(admin, {
        organizationId: orgId,
        userId,
        action: "billing_change",
        entityType: "subscription",
        details: { admin_action: "upgrade_plan" },
        request,
      });
      return NextResponse.json({ url });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not open the billing portal.";
      return jsonError(message, "billing_error", 502);
    }
  }

  return jsonError("Unknown action.", "invalid_action", 400);
}
