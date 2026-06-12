import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import type { Enums } from "@/types/database";

// Per-campaign endpoint (AGENTS.md Agent 18, BLUEPRINT §4.11).
//
// GET  — detailed stats for one campaign (steps, per-contact status, totals,
//        and derived open/reply/conversion rates).
// PUT  — update the campaign's lifecycle status (activate / pause / complete),
//        enforcing the allowed transitions (BEHAVIORAL_CONTRACTS §21).
//
// Both authenticate via the session; reads/writes are RLS-scoped to the org, so
// a campaign from another organization simply isn't visible (§2).

export const runtime = "nodejs";

type CampaignStatus = Enums<"campaign_status">;

/** Roles permitted to change campaign state (viewer is read-only, §2). */
const EDITOR_ROLES = new Set(["owner", "admin", "writer"]);

/** Allowed status transitions (Contracts §21: draft→active→paused/completed). */
const ALLOWED_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ["active"],
  active: ["paused", "completed"],
  paused: ["active", "completed"],
  completed: [],
};

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

async function requireProfile(supabase: ReturnType<typeof createClient>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: jsonError("Authentication required.", "unauthenticated", 401) };
  }
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, organization_id, role")
    .eq("id", user.id)
    .single();
  if (error || !profile) {
    return { error: jsonError("Could not resolve your profile.", "no_profile", 403) };
  }
  return { profile };
}

export async function GET(
  _request: Request,
  { params }: { params: { campaignId: string } },
) {
  const supabase = createClient();
  const auth = await requireProfile(supabase);
  if ("error" in auth) return auth.error;

  const campaignId = params.campaignId;

  const { data: campaign, error: campaignError } = await supabase
    .from("email_campaigns")
    .select("*")
    .eq("id", campaignId)
    .maybeSingle();
  if (campaignError) {
    return jsonError("Could not load the campaign.", "load_failed", 500);
  }
  if (!campaign) {
    return jsonError("Campaign not found.", "not_found", 404);
  }

  const { data: steps } = await supabase
    .from("campaign_steps")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("step_number", { ascending: true });
  const stepRows = steps ?? [];
  const stepIds = stepRows.map((s) => s.id);

  const { data: contacts } = await supabase
    .from("outreach_contacts")
    .select("id, company_name, contact_name, email, status, converted_to_funder_id")
    .eq("campaign_id", campaignId);
  const contactRows = contacts ?? [];

  const sendRows =
    stepIds.length > 0
      ? (
          await supabase
            .from("campaign_sends")
            .select("*")
            .in("campaign_step_id", stepIds)
            .order("created_at", { ascending: false })
        ).data ?? []
      : [];

  // Per-contact latest status, derived from sends + the contact record.
  const sendsByContact = new Map<string, typeof sendRows>();
  for (const send of sendRows) {
    const list = sendsByContact.get(send.outreach_contact_id) ?? [];
    list.push(send);
    sendsByContact.set(send.outreach_contact_id, list);
  }

  const contactStatuses = contactRows.map((c) => {
    const sends = sendsByContact.get(c.id) ?? [];
    const sentCount = sends.filter((s) => s.sent_at).length;
    const opened = sends.some((s) => s.opened_at || s.status === "opened");
    const replied = sends.some((s) => s.replied_at || s.status === "replied");
    const bounced = sends.some((s) => s.status === "bounced");
    return {
      id: c.id,
      company_name: c.company_name,
      contact_name: c.contact_name,
      email: c.email,
      status: c.status ?? "new",
      converted: Boolean(c.converted_to_funder_id),
      sends_count: sentCount,
      last_state: replied
        ? "replied"
        : bounced
          ? "bounced"
          : opened
            ? "opened"
            : sentCount > 0
              ? "sent"
              : "pending",
    };
  });

  const totalSent = sendRows.filter((s) => s.sent_at).length;
  const totalOpened = sendRows.filter(
    (s) => s.opened_at || s.status === "opened",
  ).length;
  const totalReplied = sendRows.filter(
    (s) => s.replied_at || s.status === "replied",
  ).length;
  const totalBounced = sendRows.filter((s) => s.status === "bounced").length;
  const converted = contactRows.filter((c) => c.converted_to_funder_id).length;

  const rate = (num: number, den: number) =>
    den > 0 ? Math.round((num / den) * 1000) / 10 : 0;

  return NextResponse.json({
    campaign,
    steps: stepRows,
    contacts: contactStatuses,
    sends: sendRows,
    stats: {
      totalContacts: contactRows.length,
      totalSent,
      totalOpened,
      totalReplied,
      totalBounced,
      converted,
      openRate: rate(totalOpened, totalSent),
      replyRate: rate(totalReplied, totalSent),
      conversionRate: rate(converted, contactRows.length),
    },
  });
}

export async function PUT(
  request: Request,
  { params }: { params: { campaignId: string } },
) {
  const supabase = createClient();
  const auth = await requireProfile(supabase);
  if ("error" in auth) return auth.error;

  if (!EDITOR_ROLES.has(auth.profile.role as string)) {
    return jsonError("You do not have permission to do this.", "forbidden", 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }
  const { status } = (body ?? {}) as { status?: unknown };
  const validStatuses: CampaignStatus[] = ["draft", "active", "paused", "completed"];
  if (typeof status !== "string" || !validStatuses.includes(status as CampaignStatus)) {
    return jsonError("A valid status is required.", "invalid_input", 400);
  }
  const target = status as CampaignStatus;

  const { data: campaign, error: loadError } = await supabase
    .from("email_campaigns")
    .select("id, status")
    .eq("id", params.campaignId)
    .maybeSingle();
  if (loadError) {
    return jsonError("Could not load the campaign.", "load_failed", 500);
  }
  if (!campaign) {
    return jsonError("Campaign not found.", "not_found", 404);
  }

  const current = (campaign.status ?? "draft") as CampaignStatus;
  if (current !== target && !ALLOWED_TRANSITIONS[current].includes(target)) {
    return jsonError(
      `Cannot move a ${current} campaign to ${target}.`,
      "invalid_transition",
      409,
    );
  }

  const { data: updated, error: updateError } = await supabase
    .from("email_campaigns")
    .update({ status: target, updated_at: new Date().toISOString() })
    .eq("id", params.campaignId)
    .select("*")
    .single();
  if (updateError) {
    return jsonError("Could not update the campaign.", "update_failed", 500);
  }

  return NextResponse.json({ campaign: updated });
}
