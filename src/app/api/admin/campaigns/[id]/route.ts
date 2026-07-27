import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { SalesCampaignEngine } from "@/lib/admin/sales-campaign-engine";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type RouteContext = { params: { id: string } };

export async function GET(_request: Request, { params }: RouteContext) {
  const gate = await requireRole("owner");
  if ("error" in gate) return gate.error;

  const { id } = params;
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("sales_campaigns")
    .select("*, sales_campaign_steps(*), sales_sends(id, status, sent_at, opened_at, replied_at, bounced_at)")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Campaign not found.", code: "not_found" },
      { status: 404 },
    );
  }

  return NextResponse.json({ campaign: data });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const gate = await requireRole("owner");
  if ("error" in gate) return gate.error;

  const { id } = params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body.", code: "bad_request" },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  const b = body as Record<string, unknown>;

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (b["status"] !== undefined) update["status"] = b["status"];
  if (b["name"] !== undefined) update["name"] = b["name"];
  if (b["description"] !== undefined) update["description"] = b["description"];
  if (b["daily_send_target"] !== undefined) update["daily_send_target"] = b["daily_send_target"];
  if (b["send_window_start"] !== undefined) update["send_window_start"] = b["send_window_start"];
  if (b["send_window_end"] !== undefined) update["send_window_end"] = b["send_window_end"];
  if (b["send_timezone"] !== undefined) update["send_timezone"] = b["send_timezone"];
  if (b["filter_criteria"] !== undefined) update["filter_criteria"] = b["filter_criteria"];

  const { data, error } = await supabase
    .from("sales_campaigns")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Failed to update campaign.", code: "update_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ campaign: data });
}

export async function POST(request: Request, { params }: RouteContext) {
  const gate = await requireRole("owner");
  if ("error" in gate) return gate.error;

  const { id } = params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body.", code: "bad_request" },
      { status: 400 },
    );
  }

  const action = (body as Record<string, unknown>)["action"] as string | undefined;

  if (!action) {
    return NextResponse.json(
      { error: "action is required.", code: "missing_action" },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();

  if (action === "schedule") {
    try {
      const engine = new SalesCampaignEngine();
      const result = await engine.scheduleSends(id);
      return NextResponse.json(result);
    } catch {
      return NextResponse.json(
        { error: "Failed to schedule sends.", code: "schedule_failed" },
        { status: 500 },
      );
    }
  }

  if (action === "pause") {
    const { error: cErr } = await supabase
      .from("sales_campaigns")
      .update({ status: "paused", updated_at: new Date().toISOString() })
      .eq("id", id);

    if (cErr) {
      return NextResponse.json(
        { error: "Failed to pause campaign.", code: "pause_failed" },
        { status: 500 },
      );
    }

    // Cancel queued sends
    const { error: sErr } = await supabase
      .from("sales_sends")
      .update({ status: "cancelled" })
      .eq("campaign_id", id)
      .eq("status", "queued");

    if (sErr) {
      return NextResponse.json(
        { error: "Failed to cancel queued sends.", code: "cancel_failed" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, action: "paused" });
  }

  if (action === "resume") {
    const { error: cErr } = await supabase
      .from("sales_campaigns")
      .update({ status: "active", updated_at: new Date().toISOString() })
      .eq("id", id);

    if (cErr) {
      return NextResponse.json(
        { error: "Failed to resume campaign.", code: "resume_failed" },
        { status: 500 },
      );
    }

    // Re-schedule cancelled sends
    const { error: sErr } = await supabase
      .from("sales_sends")
      .update({ status: "queued", scheduled_for: new Date().toISOString() })
      .eq("campaign_id", id)
      .eq("status", "cancelled");

    if (sErr) {
      return NextResponse.json(
        { error: "Failed to re-schedule sends.", code: "reschedule_failed" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, action: "resumed" });
  }

  return NextResponse.json(
    { error: `Unknown action: ${action}`, code: "unknown_action" },
    { status: 400 },
  );
}
