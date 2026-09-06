import { createHash } from "crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email/resend-client";
import {
  SCAN_REPORT_ACTION_VALUES,
  SCAN_TIER_COPY,
  type ScanReportAction,
} from "@/lib/scan/constants";
import type { FundingPotentialTier } from "@/lib/scan/scoring-engine";

export const runtime = "nodejs";

// Post-report email capture for the public Funding Potential Scan
// (src/app/(marketing)/scan/ScanEmailCapture.tsx). Anonymous, unauthenticated
// visitors submit this after already seeing their full report on-page - see
// supabase/migrations/173_scan_report_requests.sql for the RLS model
// (anon INSERT-only, no SELECT, same pattern as scan_submissions).
//
// "email_report" and "share_board" actually send mail via the real Resend
// client (src/lib/email/resend-client.ts, already used for platform
// notification email) - this is not a placeholder. "save_profile" sends
// nothing; the row itself, already durably stored below, is the save.
//
// A send failure must not turn into a 500 for a visitor whose request we
// already stored: email_send_status/email_send_error record the outcome on
// the row for follow-up, and the response still reports ok:true with
// emailSent:false so the client can show an honest (non-alarming) message.

const boardEmailSchema = z.string().trim().email().max(200);

const requestSchema = z.object({
  scanSubmissionId: z.string().uuid(),
  orgNameOrWebsite: z.string().trim().max(200).optional(),
  email: z.string().trim().email().max(200),
  action: z.enum(SCAN_REPORT_ACTION_VALUES as [string, ...string[]]),
  boardEmails: z.array(boardEmailSchema).max(10).optional(),
  score: z.number().int().min(0).max(100),
  tier: z.enum(["strong", "moderate", "emerging", "early_stage"]),
  categoriesConsidered: z.array(z.string().max(80)).max(20),
  matchedCount: z.number().int().min(0),
  degraded: z.boolean(),
  amountMin: z.number().nullable().optional(),
  amountMax: z.number().nullable().optional(),
  // Honeypot, same pattern as /api/public/scan - real visitors never see it.
  hpToken: z.string().optional(),
});

function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildReportEmailHtml(input: {
  orgNameOrWebsite?: string;
  score: number;
  tier: FundingPotentialTier;
  categoriesConsidered: string[];
  matchedCount: number;
  degraded: boolean;
  amountMin: number | null;
  amountMax: number | null;
}): string {
  const tierCopy = SCAN_TIER_COPY[input.tier];
  const orgLine = input.orgNameOrWebsite
    ? `<p>Organization: ${escapeHtml(input.orgNameOrWebsite)}</p>`
    : "";
  const categoriesLine =
    input.categoriesConsidered.length > 0
      ? `<p>Likely opportunity categories: ${escapeHtml(input.categoriesConsidered.join(", "))}</p>`
      : `<p>We couldn't confidently match your mission statement to one of our tracked funding categories.</p>`;
  const matchLine =
    !input.degraded && input.matchedCount > 0
      ? `<p>We found ${input.matchedCount} open opportunit${input.matchedCount === 1 ? "y" : "ies"} in Benavora's live database that match your category and aren't geographically restricted against your state.</p>`
      : "";
  const amountLine =
    !input.degraded && input.amountMin !== null && input.amountMax !== null
      ? `<p>Typical award sizes among these run from $${input.amountMin.toLocaleString()} to $${input.amountMax.toLocaleString()}.</p>`
      : "";

  return `
    <div style="font-family: sans-serif; color: #2B2B28; max-width: 600px;">
      <h1 style="color: #1F3A2E;">Your Funding Potential Scan</h1>
      ${orgLine}
      <p style="font-size: 24px; font-weight: bold; color: ${tierCopy.color};">
        ${input.score}/100 &mdash; ${tierCopy.label}
      </p>
      <p>${escapeHtml(tierCopy.blurb)}</p>
      ${categoriesLine}
      ${matchLine}
      ${amountLine}
      <p style="font-size: 13px; color: #6F6F69; margin-top: 24px;">
        This is a rules-based heuristic that compares your stated mission and state against the
        categories and geographic restrictions of open opportunities currently tracked in
        Benavora's opportunities database. It is not a real-time AI analysis, a statistical
        prediction, or a guarantee of funding, and it does not identify or recommend any specific
        funder.
      </p>
    </div>
  `.trim();
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-body" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid-body", issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const {
    scanSubmissionId,
    orgNameOrWebsite,
    email,
    action,
    boardEmails,
    score,
    tier,
    categoriesConsidered,
    matchedCount,
    degraded,
    amountMin,
    amountMax,
    hpToken,
  } = parsed.data;

  if (action === "share_board" && (!boardEmails || boardEmails.length === 0)) {
    return NextResponse.json(
      { error: "invalid-body", issues: { boardEmails: ["At least one board email is required."] } },
      { status: 400 },
    );
  }

  // Bot caught the honeypot: report success without writing anything or
  // sending mail, so the bot gets no signal that it was detected.
  if (hpToken) {
    return NextResponse.json({ ok: true, emailSent: false });
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  const ip = forwardedFor ? forwardedFor.split(",")[0]!.trim() : "unknown";
  const userAgent = request.headers.get("user-agent") ?? undefined;

  let emailSent = false;
  let emailSendStatus: "not_attempted" | "sent" | "failed" = "not_attempted";
  let emailSendError: string | null = null;

  if (action === "email_report" || action === "share_board") {
    const html = buildReportEmailHtml({
      orgNameOrWebsite,
      score,
      tier: tier as FundingPotentialTier,
      categoriesConsidered,
      matchedCount,
      degraded,
      amountMin: amountMin ?? null,
      amountMax: amountMax ?? null,
    });
    const recipients = action === "share_board" ? [email, ...(boardEmails ?? [])] : [email];

    const result = await sendEmail({
      to: recipients,
      subject: "Your Benavora Funding Potential Scan",
      html,
    });

    emailSent = result.success;
    emailSendStatus = result.success ? "sent" : "failed";
    emailSendError = result.success ? null : (result.error ?? "unknown error");
  }

  const supabase = createClient();
  const { error } = await supabase.from("scan_report_requests").insert({
    scan_submission_id: scanSubmissionId,
    email,
    action: action as ScanReportAction,
    board_emails: action === "share_board" ? boardEmails : null,
    score,
    tier,
    categories_considered: categoriesConsidered,
    matched_count: matchedCount,
    degraded,
    amount_min: amountMin ?? null,
    amount_max: amountMax ?? null,
    email_send_status: emailSendStatus,
    email_send_error: emailSendError,
    ip_hash: hashIp(ip),
    user_agent: userAgent ?? null,
  });

  if (error) {
    console.error("SCAN CAPTURE ERROR:", error);
    return NextResponse.json({ error: "capture-failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, emailSent });
}
