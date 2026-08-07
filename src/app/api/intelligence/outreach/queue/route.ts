// POST /api/intelligence/outreach/queue — "Queue for Sending" backend for the
// Corporate Outreach composer.
//
// The build task described this as writing to `outreach_campaigns` /
// `outreach_prospects` — neither exists (see project memory
// benavora-outreach-table-names-collide). The real org-scoped email
// infrastructure is email_campaign_sequences / email_sequence_steps /
// email_sequence_enrollments (migration 054), the same tables
// route-to-email/route.ts already writes to for Donor Discovery outreach —
// this route follows that exact pattern for corporate_prospects instead of
// donor_discovery_prospects.
//
// organization_id is always derived from the authenticated session
// (requireRole), never the request body (Behavioral Contracts §2).
//
// Two request shapes:
//   - Shared-template mode (original): { subject, body, templateType, prospects[] }
//     — one sequence, one step (shared subject/body), N enrollments. This is
//     what a single generated draft rendered with {company_name}/{org_name}
//     tokens looks like.
//   - Batch-personalized mode (new): { drafts[] }, each item carrying its own
//     subject/body already generated per-prospect by the composer's batch
//     flow. email_sequence_steps.subject_override/body_override is shared
//     across every enrollment in a sequence (SequenceEngine.processScheduledSends
//     reads exactly one step per sequence) — there is no column that lets one
//     sequence carry N distinct bodies. Rather than a schema change, each
//     draft gets its own one-step, one-enrollment sequence, so genuinely
//     distinct per-prospect content is possible without touching the send
//     engine at all.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

// Mirrors SequenceEngine.processScheduledSends' own per-sweep cap
// (src/lib/email/sequence-engine.ts) — used only to phrase an honest
// estimate, not a promise of a live schedule (the /api/cron/email-sequences
// sweep this depends on is not currently registered in vercel.json).
const MAX_SENDS_PER_CYCLE = 50;

function isUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

interface ProspectInput {
  id: string;
  displayName: string;
  email: string;
}

interface DraftInput {
  id: string;
  displayName: string;
  email: string;
  subject: string;
  body: string;
}

type DraftQueueResult =
  | { prospectId: string; displayName: string; campaignId: string }
  | { prospectId: string; displayName: string; error: string };

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isValidEmail(v: unknown): v is string {
  return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId, userId } = gate;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  const { subject, body, templateType, prospects, campaignName, drafts } = (raw ?? {}) as {
    subject?: unknown;
    body?: unknown;
    templateType?: unknown;
    prospects?: unknown;
    campaignName?: unknown;
    drafts?: unknown;
  };

  if (Array.isArray(drafts) && drafts.length > 0) {
    const validDrafts: DraftInput[] = [];
    const skipped: string[] = [];

    for (const rawDraft of drafts) {
      const candidate = rawDraft as {
        id?: unknown;
        displayName?: unknown;
        email?: unknown;
        subject?: unknown;
        body?: unknown;
      };
      if (!isUuid(candidate.id) || !isNonEmptyString(candidate.displayName)) continue;
      if (
        isValidEmail(candidate.email) &&
        isNonEmptyString(candidate.subject) &&
        isNonEmptyString(candidate.body)
      ) {
        validDrafts.push({
          id: candidate.id,
          displayName: candidate.displayName,
          email: candidate.email.trim(),
          subject: candidate.subject.trim(),
          body: candidate.body.trim(),
        });
      } else {
        skipped.push(candidate.displayName);
      }
    }

    if (validDrafts.length === 0) {
      return jsonError(
        "None of the submitted drafts had a usable email address, subject, and body.",
        422,
      );
    }

    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", organizationId)
      .single();
    if (orgError || !org) {
      return jsonError("Could not load your organization.", 500);
    }

    const campaignPrefix =
      typeof campaignName === "string" && campaignName.trim()
        ? campaignName.trim()
        : `Corporate Outreach — personalized — ${typeof templateType === "string" ? templateType : "custom"}`;
    const dateStamp = new Date().toISOString().slice(0, 10);

    const results: DraftQueueResult[] = await Promise.all(
      validDrafts.map(async (d): Promise<DraftQueueResult> => {
        const { data: sequence, error: sequenceError } = await supabase
          .from("email_campaign_sequences")
          .insert({
            organization_id: organizationId,
            name: `${campaignPrefix} — ${d.displayName} — ${dateStamp}`,
            description: "Batch-personalized corporate outreach composed via /donor-discovery/outreach.",
            trigger_type: "manual",
            status: "active",
            created_by: userId,
          })
          .select("id")
          .single();

        if (sequenceError || !sequence) {
          return { prospectId: d.id, displayName: d.displayName, error: "Failed to create the outreach campaign." };
        }

        const { error: stepError } = await supabase.from("email_sequence_steps").insert({
          sequence_id: sequence.id,
          step_number: 1,
          subject_override: d.subject,
          body_override: d.body,
          delay_days: 0,
          delay_hours: 0,
          condition_type: "always",
        });

        if (stepError) {
          return {
            prospectId: d.id,
            displayName: d.displayName,
            error: "Failed to create the outreach campaign step.",
          };
        }

        const { error: enrollError } = await supabase.from("email_sequence_enrollments").insert({
          organization_id: organizationId,
          sequence_id: sequence.id,
          contact_id: null,
          funder_id: null,
          email_address: d.email,
          current_step: 0,
          status: "active",
          next_send_at: new Date().toISOString(),
          variables: { company_name: d.displayName, org_name: org.name },
        });

        // 23505 = unique_violation — impossible in practice against a brand-new
        // sequence, but handled the same non-error way route-to-email/route.ts
        // treats it for consistency.
        if (enrollError && (enrollError as { code?: string }).code !== "23505") {
          return { prospectId: d.id, displayName: d.displayName, error: "Failed to enroll this prospect." };
        }

        return { prospectId: d.id, displayName: d.displayName, campaignId: sequence.id as string };
      }),
    );

    const queuedDrafts = results.filter(
      (r): r is Extract<DraftQueueResult, { campaignId: string }> => "campaignId" in r,
    );
    const failedDrafts = results.filter(
      (r): r is Extract<DraftQueueResult, { error: string }> => "error" in r,
    );

    if (queuedDrafts.length === 0) {
      return jsonError("Failed to queue any of the personalized drafts.", 500);
    }

    return NextResponse.json({
      queued: queuedDrafts.length,
      queuedDrafts,
      failedDrafts,
      skipped,
      estimatedBatchSize: MAX_SENDS_PER_CYCLE,
    });
  }

  if (typeof subject !== "string" || !subject.trim()) {
    return jsonError("subject is required.", 400);
  }
  if (typeof body !== "string" || !body.trim()) {
    return jsonError("body is required.", 400);
  }
  if (!Array.isArray(prospects) || prospects.length === 0) {
    return jsonError("At least one prospect is required.", 400);
  }

  const validProspects: ProspectInput[] = [];
  const skippedNoEmail: string[] = [];
  for (const p of prospects) {
    const candidate = p as { id?: unknown; displayName?: unknown; email?: unknown };
    if (!isUuid(candidate.id) || typeof candidate.displayName !== "string") continue;
    if (typeof candidate.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate.email.trim())) {
      validProspects.push({ id: candidate.id, displayName: candidate.displayName, email: candidate.email.trim() });
    } else {
      skippedNoEmail.push(candidate.displayName);
    }
  }

  if (validProspects.length === 0) {
    return jsonError("None of the selected prospects have a usable email address on file.", 422);
  }

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .single();
  if (orgError || !org) {
    return jsonError("Could not load your organization.", 500);
  }

  const sequenceName =
    typeof campaignName === "string" && campaignName.trim()
      ? campaignName.trim()
      : `Corporate Outreach — ${typeof templateType === "string" ? templateType : "custom"} — ${new Date().toISOString().slice(0, 10)}`;

  const { data: sequence, error: sequenceError } = await supabase
    .from("email_campaign_sequences")
    .insert({
      organization_id: organizationId,
      name: sequenceName,
      description: "Corporate outreach composed via /donor-discovery/outreach.",
      trigger_type: "manual",
      status: "active",
      created_by: userId,
    })
    .select("id")
    .single();

  if (sequenceError || !sequence) {
    return jsonError("Failed to create the outreach campaign.", 500);
  }

  const { error: stepError } = await supabase.from("email_sequence_steps").insert({
    sequence_id: sequence.id,
    step_number: 1,
    subject_override: subject.trim(),
    body_override: body.trim(),
    delay_days: 0,
    delay_hours: 0,
    condition_type: "always",
  });

  if (stepError) {
    return jsonError("Failed to create the outreach campaign step.", 500);
  }

  const nowIso = new Date().toISOString();

  // One insert per prospect (not a single bulk insert) so a duplicate
  // enrollment (unique_violation, 23505 — already enrolled in this sequence,
  // same non-error case route-to-email/route.ts handles) only drops that one
  // row instead of failing the whole batch.
  const results = await Promise.all(
    validProspects.map((p) =>
      supabase
        .from("email_sequence_enrollments")
        .insert({
          organization_id: organizationId,
          sequence_id: sequence.id,
          contact_id: null,
          funder_id: null,
          email_address: p.email,
          current_step: 0,
          status: "active",
          next_send_at: nowIso,
          variables: { company_name: p.displayName, org_name: org.name },
        })
        .select("id")
        .single(),
    ),
  );

  const queued = results.filter((r) => !r.error).length;
  const hardFailures = results.filter((r) => r.error && (r.error as { code?: string }).code !== "23505").length;

  if (queued === 0 && hardFailures > 0) {
    return jsonError("Failed to queue prospects for sending.", 500);
  }

  return NextResponse.json({
    campaignId: sequence.id,
    queued,
    skipped: skippedNoEmail,
    estimatedBatchSize: MAX_SENDS_PER_CYCLE,
  });
}
