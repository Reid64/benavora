import { createHash, randomUUID } from "crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  SCAN_FUNDING_PRIORITY_VALUES,
  SCAN_STATE_ABBREVIATIONS,
  type ScanFundingPriority,
} from "@/lib/scan/constants";
import {
  computeFundingPotentialScan,
  type FundingPotentialScanResult,
} from "@/lib/scan/scoring-engine";

export const runtime = "nodejs";

// Funding Potential Scan intake (/scan). Anonymous, unauthenticated visitors
// submit this - see supabase/migrations/172_scan_submissions.sql for the RLS
// model (anon INSERT-only, no SELECT). Because anon has no SELECT grant/policy
// on scan_submissions, `.insert().select()` would return nothing for this
// role (RLS gates RETURNING the same as SELECT) - so the id is generated here
// server-side with randomUUID() and inserted explicitly, then returned to the
// client as-is, rather than read back from the table. The client keeps that
// id as scanSubmissionId and later sends it to POST /api/public/scan/capture
// (ScanEmailCapture.tsx) when the visitor asks to email/save/share the report.
//
// Scoring runs here, not client-side, because computeFundingPotentialScan()
// requires a service-role client to read across every org's opportunities
// (this visitor has no organization_id yet). Per that module's own file-level
// comment, this is a sanctioned exception to admin.ts's blanket "never in
// user-facing routes" rule: the engine only ever returns aggregated
// category/geography/amount signals, never an opportunity id, name,
// description, funder_id, or organization_id, so no other org's data leaks
// to this anonymous visitor.

const requestSchema = z.object({
  orgNameOrWebsite: z.string().trim().min(2).max(200),
  ein: z
    .string()
    .trim()
    .max(20)
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => v === undefined || /^\d{2}-?\d{7}$/.test(v), {
      message: "EIN must look like 12-3456789",
    }),
  state: z.enum(SCAN_STATE_ABBREVIATIONS as [string, ...string[]]),
  primaryMission: z.string().trim().min(5).max(200),
  fundingPriority: z.enum(SCAN_FUNDING_PRIORITY_VALUES as [string, ...string[]]),
  // Honeypot: real visitors never see or fill this field (off-screen in the
  // form). A non-empty value means a bot filled every input it found.
  hpToken: z.string().optional(),
});

function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex");
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

  const { orgNameOrWebsite, ein, state, primaryMission, fundingPriority, hpToken } = parsed.data;

  // Bot caught the honeypot: report success without writing anything, so the
  // bot gets no signal that it was detected.
  if (hpToken) {
    return NextResponse.json({ ok: true });
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  const ip = forwardedFor ? forwardedFor.split(",")[0]!.trim() : "unknown";
  const userAgent = request.headers.get("user-agent") ?? undefined;

  const submissionId = randomUUID();

  const supabase = createClient();
  const { error } = await supabase.from("scan_submissions").insert({
    id: submissionId,
    org_name_or_website: orgNameOrWebsite,
    ein: ein ?? null,
    state,
    primary_mission: primaryMission,
    funding_priority: fundingPriority,
    ip_hash: hashIp(ip),
    user_agent: userAgent ?? null,
  });

  if (error) {
    console.error("SCAN SUBMISSION ERROR:", error);
    return NextResponse.json({ error: "submission-failed" }, { status: 500 });
  }

  // The submission is already durably stored above, so a scoring failure
  // (missing service-role env vars, opportunities query error, etc.) must
  // not turn into a 500 for a visitor whose data we already have - the
  // client falls back to a no-score thank-you state when `scan` is null.
  let scan: FundingPotentialScanResult | null = null;
  try {
    scan = await computeFundingPotentialScan(
      { primaryMission, fundingPriority: fundingPriority as ScanFundingPriority, state },
      createAdminClient(),
    );
  } catch (scoringError) {
    console.error("SCAN SCORING ERROR:", scoringError);
  }

  return NextResponse.json({ ok: true, scan, submissionId });
}
