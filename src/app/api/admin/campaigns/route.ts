import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { SalesCampaignEngine } from "@/lib/admin/sales-campaign-engine";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const gate = await requireRole("owner");
  if ("error" in gate) return gate.error;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("sales_campaigns")
    .select("*, sales_campaign_steps(*), sales_sends(id, status)")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "Failed to load campaigns.", code: "load_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ campaigns: data });
}

export async function POST(request: Request) {
  const gate = await requireRole("owner");
  if ("error" in gate) return gate.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body.", code: "bad_request" },
      { status: 400 },
    );
  }

  const b = body as Record<string, unknown>;
  const {
    name,
    description,
    list_id,
    sending_domain_ids,
    daily_send_target,
    send_window_start,
    send_window_end,
    send_timezone,
    filter_criteria,
    steps,
  } = b;

  if (
    !name ||
    !list_id ||
    !Array.isArray(sending_domain_ids) ||
    typeof daily_send_target !== "number" ||
    typeof send_window_start !== "number" ||
    typeof send_window_end !== "number" ||
    !send_timezone ||
    !Array.isArray(steps)
  ) {
    return NextResponse.json(
      { error: "Missing required fields.", code: "missing_fields" },
      { status: 400 },
    );
  }

  try {
    const engine = new SalesCampaignEngine();
    const campaignId = await engine.createCampaign({
      name: name as string,
      description: description as string | undefined,
      list_id: list_id as string,
      sending_domain_ids: sending_domain_ids as string[],
      daily_send_target,
      send_window_start,
      send_window_end,
      send_timezone: send_timezone as string,
      filter_criteria: ((filter_criteria ?? {}) as Record<string, unknown>),
      steps: steps as Array<{
        subject_template: string;
        body_template: string;
        delay_days: number;
      }>,
    });

    return NextResponse.json({ id: campaignId }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Failed to create campaign.", code: "create_failed" },
      { status: 500 },
    );
  }
}
