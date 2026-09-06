import { createHash, randomUUID } from "crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email/resend-client";
import { DEMO_ROLE_OPTIONS, DEMO_ROLE_VALUES } from "@/lib/demo/constants";

export const runtime = "nodejs";

// Tailored demo intake (/demo). Anonymous, unauthenticated visitors submit
// this before ever seeing the Calendly booking step - see
// supabase/migrations/174_demo_requests.sql for the RLS model (anon
// INSERT-only, no SELECT), same pattern as /api/public/scan's
// scan_submissions table. Exactly the four outline-specified fields
// (BENAVORA MARKETING PAGE.docx section 6): work email, organization
// website, role, primary funding challenge.
//
// Unlike scan_submissions, there is no scoring step here - a human
// strategist reviews the intake ahead of the booked call, so this route's
// only job is to durably store the request and (best-effort) notify the
// team so they can prepare. A notification-send failure must not turn into
// a 500 for a visitor whose request is already stored.

const requestSchema = z.object({
  workEmail: z.string().trim().email().max(200),
  orgWebsite: z.string().trim().min(3).max(200),
  role: z.enum(DEMO_ROLE_VALUES),
  primaryFundingChallenge: z.string().trim().min(5).max(500),
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

  const { workEmail, orgWebsite, role, primaryFundingChallenge, hpToken } = parsed.data;

  // Bot caught the honeypot: report success without writing anything, so the
  // bot gets no signal that it was detected.
  if (hpToken) {
    return NextResponse.json({ ok: true, demoRequestId: randomUUID() });
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  const ip = forwardedFor ? forwardedFor.split(",")[0]!.trim() : "unknown";
  const userAgent = request.headers.get("user-agent") ?? undefined;

  const demoRequestId = randomUUID();

  const supabase = createClient();
  const { error } = await supabase.from("demo_requests").insert({
    id: demoRequestId,
    work_email: workEmail,
    org_website: orgWebsite,
    role,
    primary_funding_challenge: primaryFundingChallenge,
    ip_hash: hashIp(ip),
    user_agent: userAgent ?? null,
  });

  if (error) {
    console.error("DEMO REQUEST ERROR:", error);
    return NextResponse.json({ error: "submission-failed" }, { status: 500 });
  }

  const roleLabel = DEMO_ROLE_OPTIONS.find((r) => r.value === role)?.label ?? role;
  const html = `
    <div style="font-family: sans-serif; color: #2B2B28; max-width: 600px;">
      <h1 style="color: #1F3A2E;">New tailored demo request</h1>
      <p><strong>Work email:</strong> ${escapeHtml(workEmail)}</p>
      <p><strong>Organization website:</strong> ${escapeHtml(orgWebsite)}</p>
      <p><strong>Role:</strong> ${escapeHtml(roleLabel)}</p>
      <p><strong>Primary funding challenge:</strong> ${escapeHtml(primaryFundingChallenge)}</p>
      <p style="font-size: 13px; color: #6F6F69; margin-top: 24px;">demo_requests.id: ${demoRequestId}</p>
    </div>
  `.trim();

  // Best-effort only - the request is already durably stored above, so a
  // notification-send failure must not turn into a 500 for this visitor.
  try {
    await sendEmail({
      to: "sales@benavora.com",
      subject: `New tailored demo request - ${orgWebsite}`,
      html,
    });
  } catch (notifyError) {
    console.error("DEMO REQUEST NOTIFICATION ERROR:", notifyError);
  }

  return NextResponse.json({ ok: true, demoRequestId });
}
