import { NextResponse } from "next/server";
import { Resend } from "resend";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  MAX_OUTREACH_EMAILS_PER_DAY,
  MIN_CAMPAIGN_STEP_GAP_DAYS,
} from "@/lib/utils/constants";

// POST /api/outreach/send
// Sends the next due campaign step to an outreach contact via Resend.
// Enforces Contracts Â§13: 24-hour minimum gap between steps, 50 emails/day per org.
// Resolves all 6 template variables from org profile + outreach_contact + knowledge_base.
// Creates a campaign_sends record with status 'sent'.

export const runtime = "nodejs";

const DAY_MS = MIN_CAMPAIGN_STEP_GAP_DAYS * 24 * 60 * 60 * 1000;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Render a template string, replacing all {variable} tokens. */
function renderTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{([a-z_]+)\}/gi, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key]! : match,
  );
}

/** Returns the first ~120-char sentence fragment from a string. */
function snippetOf(text: string | null | undefined): string {
  if (!text) return "";
  const trimmed = text.trim();
  const dot = trimmed.indexOf(".");
  const end = dot > 0 && dot < 120 ? dot : Math.min(trimmed.length, 120);
  return trimmed.slice(0, end).replace(/\s+$/, "");
}

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Authentication required.", "unauthenticated", 401);

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, organization_id, role")
    .eq("id", user.id)
    .single();
  if (profileError || !profile)
    return jsonError("Could not resolve your profile.", "no_profile", 403);

  const organizationId = profile.organization_id as string;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { campaign_id, outreach_contact_id } = (body ?? {}) as {
    campaign_id?: unknown;
    outreach_contact_id?: unknown;
  };

  if (typeof campaign_id !== "string" || campaign_id.trim() === "")
    return jsonError("campaign_id is required.", "validation_error", 400);
  if (
    typeof outreach_contact_id !== "string" ||
    outreach_contact_id.trim() === ""
  )
    return jsonError("outreach_contact_id is required.", "validation_error", 400);

  const admin = createAdminClient();

  // Verify campaign belongs to this org.
  const { data: campaign, error: campaignError } = await admin
    .from("email_campaigns")
    .select("id, status, organization_id")
    .eq("id", campaign_id)
    .eq("organization_id", organizationId)
    .single();
  if (campaignError || !campaign)
    return jsonError("Campaign not found.", "not_found", 404);
  if (campaign.status !== "active")
    return jsonError(
      "Campaign must be active to send.",
      "campaign_not_active",
      422,
    );

  // Verify contact belongs to this org and is enrolled in this campaign.
  const { data: contact, error: contactError } = await admin
    .from("outreach_contacts")
    .select("id, email, company_name, contact_name, campaign_id, status")
    .eq("id", outreach_contact_id)
    .eq("organization_id", organizationId)
    .single();
  if (contactError || !contact)
    return jsonError("Contact not found.", "not_found", 404);
  if (!contact.email)
    return jsonError(
      "Contact has no email address.",
      "no_email",
      422,
    );
  if (contact.campaign_id !== campaign_id)
    return jsonError(
      "Contact is not enrolled in this campaign.",
      "not_enrolled",
      422,
    );

  const terminalStatuses = new Set(["responded", "converted", "unresponsive"]);
  if (terminalStatuses.has(contact.status ?? ""))
    return jsonError(
      "Contact is in a terminal status and will not receive further emails.",
      "terminal_status",
      422,
    );

  // Enforce daily send limit for this org (Contracts Â§21).
  // Resolve all step ids for this org, then count today's sends against them.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const { data: orgCampaigns } = await admin
    .from("email_campaigns")
    .select("id")
    .eq("organization_id", organizationId);
  const orgCampaignIds = (orgCampaigns ?? []).map((c) => c.id as string);

  let todayCount = 0;
  if (orgCampaignIds.length > 0) {
    const { data: orgSteps } = await admin
      .from("campaign_steps")
      .select("id")
      .in("campaign_id", orgCampaignIds);
    const orgStepIds = (orgSteps ?? []).map((s) => s.id as string);
    if (orgStepIds.length > 0) {
      const { count } = await admin
        .from("campaign_sends")
        .select("id", { count: "exact", head: true })
        .gte("sent_at", todayStart.toISOString())
        .in("campaign_step_id", orgStepIds);
      todayCount = count ?? 0;
    }
  }

  if (todayCount >= MAX_OUTREACH_EMAILS_PER_DAY)
    return jsonError(
      `Daily send limit of ${MAX_OUTREACH_EMAILS_PER_DAY} emails reached.`,
      "daily_limit_reached",
      429,
    );

  // Load all steps for this campaign in order.
  const { data: steps, error: stepsError } = await admin
    .from("campaign_steps")
    .select("id, step_number, subject_template, body_template, delay_days")
    .eq("campaign_id", campaign_id)
    .order("step_number");
  if (stepsError || !steps?.length)
    return jsonError("Campaign has no steps.", "no_steps", 422);

  // Load all sends to this contact for this campaign's steps.
  const stepIds = steps.map((s) => s.id as string);
  const { data: sends } = await admin
    .from("campaign_sends")
    .select("campaign_step_id, sent_at, status")
    .eq("outreach_contact_id", outreach_contact_id)
    .in("campaign_step_id", stepIds)
    .order("sent_at", { ascending: false });

  const sentStepIds = new Set((sends ?? []).map((s) => s.campaign_step_id as string));

  // Find the next step this contact hasn't received.
  const nextStep = steps.find((s) => !sentStepIds.has(s.id as string));
  if (!nextStep)
    return jsonError(
      "All steps have already been sent to this contact.",
      "all_steps_sent",
      422,
    );

  // Enforce 24-hour minimum gap from the last send to this contact.
  const lastSend = (sends ?? []).sort(
    (a, b) =>
      new Date(b.sent_at ?? 0).getTime() - new Date(a.sent_at ?? 0).getTime(),
  )[0];
  if (lastSend?.sent_at) {
    const elapsed = Date.now() - new Date(lastSend.sent_at).getTime();
    if (elapsed < DAY_MS)
      return jsonError(
        "Minimum 24-hour gap between steps not yet elapsed.",
        "gap_not_elapsed",
        429,
      );
  }

  // Resolve template variables from org + contact + knowledge_base.
  const [orgRes, kbImpactRes, kbProgramRes] = await Promise.all([
    admin
      .from("organizations")
      .select("name, mission_statement, email")
      .eq("id", organizationId)
      .single(),
    admin
      .from("knowledge_base")
      .select("content")
      .eq("organization_id", organizationId)
      .eq("category", "impact_statement")
      .order("updated_at", { ascending: false })
      .limit(1),
    admin
      .from("knowledge_base")
      .select("title")
      .eq("organization_id", organizationId)
      .eq("category", "program_description")
      .order("updated_at", { ascending: false })
      .limit(1),
  ]);

  const org = orgRes.data;
  const programName =
    (kbProgramRes.data?.[0]?.title as string | null | undefined) ?? null;
  const impactStat = kbImpactRes.data?.[0]?.content
    ? snippetOf(kbImpactRes.data[0].content as string)
    : null;

  // Validate all variables used in this step can be resolved.
  const varValues: Record<string, string> = {
    company_name: contact.company_name ?? "",
    contact_name: contact.contact_name ?? "",
    foundation_name: org?.name ?? "",
    mission_snippet: snippetOf(org?.mission_statement),
    program_name: programName ?? "",
    impact_stat: impactStat ?? "",
  };

  const usedVars = new Set<string>();
  const allText = `${nextStep.subject_template} ${nextStep.body_template}`;
  for (const m of allText.matchAll(/\{([a-z_]+)\}/gi)) {
    usedVars.add(m[1] ?? "");
  }

  const unresolvable: string[] = [];
  for (const v of usedVars) {
    if (!(v in varValues) || varValues[v] === "") {
      unresolvable.push(`{${v}}`);
    }
  }
  if (unresolvable.length > 0)
    return jsonError(
      `Cannot send: template variable(s) unresolvable: ${unresolvable.join(", ")}. Add the required data to your org profile or Knowledge Base.`,
      "unresolvable_variables",
      422,
    );

  const subject = renderTemplate(nextStep.subject_template as string, varValues);
  const htmlBody = renderTemplate(nextStep.body_template as string, varValues)
    .split("\n")
    .map((line) => `<p>${line}</p>`)
    .join("");

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey)
    return jsonError(
      "Email sending is not configured (missing RESEND_API_KEY).",
      "no_resend_key",
      500,
    );

  const fromEmail = (org?.email as string | null) ?? "outreach@benavora.com";
  const resend = new Resend(resendKey);

  const { data: emailData, error: sendError } = await resend.emails.send({
    from: fromEmail,
    to: contact.email as string,
    subject,
    html: htmlBody,
  });

  if (sendError) {
    const msg =
      typeof sendError === "object" && sendError !== null && "message" in sendError
        ? String((sendError as { message: unknown }).message)
        : "Unknown send error";
    return jsonError(`Email delivery failed: ${msg}`, "send_failed", 500);
  }

  // Record the send (Contracts Â§13).
  const { data: sendRecord, error: sendRecordError } = await admin
    .from("campaign_sends")
    .insert({
      campaign_step_id: nextStep.id,
      outreach_contact_id: outreach_contact_id,
      status: "sent",
      sent_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (sendRecordError) {
    console.error("OUTREACH SEND RECORD ERROR:", sendRecordError.message);
  }

  // Advance contact status from 'new' â†’ 'contacted'.
  if (contact.status === "new") {
    await admin
      .from("outreach_contacts")
      .update({ status: "contacted", updated_at: new Date().toISOString() })
      .eq("id", outreach_contact_id);
  }

  return NextResponse.json({
    data: {
      send_id: sendRecord?.id ?? null,
      resend_id: (emailData as { id?: string } | null)?.id ?? null,
      step_number: nextStep.step_number,
    },
  });
}


