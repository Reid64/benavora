import { createHash, randomUUID } from "crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import {
  DEMO_PREPARATION_ACTION_VALUES,
  DEMO_PROPOSAL_ALLOWED_EXTENSIONS,
  DEMO_PROPOSAL_ALLOWED_MIME_TYPES,
  DEMO_PROPOSAL_MAX_BYTES,
  type DemoPreparationAction,
} from "@/lib/demo/constants";

export const runtime = "nodejs";

// Optional post-booking preparation step for the tailored demo flow
// (src/app/(marketing)/demo/DemoClient.tsx), shown only after the visitor
// has already booked a time via the Calendly embed. Per the outline
// (BENAVORA MARKETING PAGE.docx section 6): "After booking, let the
// prospect optionally upload an old proposal or select a real opportunity
// for the demonstration."
//
// "select a real opportunity" is deliberately free text
// (opportunityReference), not a live query against the `opportunities`
// table - see supabase/migrations/175_demo_preparation_requests.sql's
// file-level comment for why: that table is strictly org-isolated, and this
// anonymous visitor has no organization_id to scope a query to.
//
// multipart/form-data (not JSON) because the proposal_upload action carries
// a binary file. The uploaded file is written to the private
// demo-proposal-uploads bucket (anon INSERT-only, no anon read - see
// migration 175) under a random, non-guessable key, and only that storage
// path (never a public URL) is stored on the row.

const baseFieldsSchema = z.object({
  demoRequestId: z.string().uuid(),
  action: z.enum(DEMO_PREPARATION_ACTION_VALUES),
});

function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex");
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
}

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid-body" }, { status: 400 });
  }

  const parsedBase = baseFieldsSchema.safeParse({
    demoRequestId: formData.get("demoRequestId"),
    action: formData.get("action"),
  });
  if (!parsedBase.success) {
    return NextResponse.json(
      { error: "invalid-body", issues: parsedBase.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { demoRequestId, action } = parsedBase.data as {
    demoRequestId: string;
    action: DemoPreparationAction;
  };

  const forwardedFor = request.headers.get("x-forwarded-for");
  const ip = forwardedFor ? forwardedFor.split(",")[0]!.trim() : "unknown";
  const userAgent = request.headers.get("user-agent") ?? undefined;
  const ipHash = hashIp(ip);

  const supabase = createClient();

  if (action === "opportunity_reference") {
    const opportunityReference = String(formData.get("opportunityReference") ?? "").trim();
    if (opportunityReference.length < 3 || opportunityReference.length > 500) {
      return NextResponse.json(
        {
          error: "invalid-body",
          issues: { opportunityReference: ["Enter the name or a link to the opportunity."] },
        },
        { status: 400 },
      );
    }

    const { error } = await supabase.from("demo_preparation_requests").insert({
      demo_request_id: demoRequestId,
      action,
      opportunity_reference: opportunityReference,
      ip_hash: ipHash,
      user_agent: userAgent ?? null,
    });

    if (error) {
      console.error("DEMO PREPARE ERROR (opportunity_reference):", error);
      return NextResponse.json({ error: "submission-failed" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  }

  // action === "proposal_upload"
  const file = formData.get("proposal");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "invalid-body", issues: { proposal: ["Choose a file to upload."] } },
      { status: 400 },
    );
  }

  if (file.size === 0 || file.size > DEMO_PROPOSAL_MAX_BYTES) {
    return NextResponse.json(
      {
        error: "invalid-body",
        issues: { proposal: [`File must be under ${DEMO_PROPOSAL_MAX_BYTES / (1024 * 1024)}MB.`] },
      },
      { status: 400 },
    );
  }

  const lowerName = file.name.toLowerCase();
  const hasAllowedExtension = DEMO_PROPOSAL_ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
  const hasAllowedMimeType = (DEMO_PROPOSAL_ALLOWED_MIME_TYPES as readonly string[]).includes(file.type);
  if (!hasAllowedExtension || !hasAllowedMimeType) {
    return NextResponse.json(
      { error: "invalid-body", issues: { proposal: ["Upload a PDF, DOC, or DOCX file."] } },
      { status: 400 },
    );
  }

  const safeName = sanitizeFilename(file.name);
  const storagePath = `${demoRequestId}/${randomUUID()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from("demo-proposal-uploads")
    .upload(storagePath, file, { contentType: file.type, upsert: false });

  if (uploadError) {
    console.error("DEMO PREPARE UPLOAD ERROR:", uploadError);
    return NextResponse.json({ error: "upload-failed" }, { status: 500 });
  }

  const { error } = await supabase.from("demo_preparation_requests").insert({
    demo_request_id: demoRequestId,
    action,
    proposal_storage_path: storagePath,
    proposal_original_filename: file.name,
    ip_hash: ipHash,
    user_agent: userAgent ?? null,
  });

  if (error) {
    console.error("DEMO PREPARE ERROR (proposal_upload):", error);
    return NextResponse.json({ error: "submission-failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
