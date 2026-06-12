import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { enforceLimit } from "@/lib/billing/tier-enforcer";
import { checkLimit } from "@/lib/billing/usage-tracker";

// Storage quota pre-flight (BLUEPRINT Phase 5 / Behavioral Contracts §25).
//
// Document uploads go directly from the browser to Supabase Storage (Storage RLS
// scopes the bucket), so the storage ceiling can't be enforced purely in that
// client path. This endpoint is the server-side gate: the uploader calls it with
// the incoming file's size BEFORE uploading; the org, tier, and current usage are
// all resolved server-side from the session, so the client cannot bypass the
// limit (Contracts §25). A 429 means the upload must not proceed.
//
//   POST { fileSize } → 200 { ok: true, remaining } | 429 usage_limit_exceeded

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(request: Request) {
  const supabase = createClient();

  // Authenticate and derive organization_id from the session (Contracts §2/§16).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("Authentication required.", "unauthenticated", 401);
  }
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();
  if (profileError || !profile) {
    return jsonError("Could not resolve your profile.", "no_profile", 403);
  }
  const organizationId = profile.organization_id as string;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }
  const { fileSize } = (body ?? {}) as { fileSize?: unknown };
  const size =
    typeof fileSize === "number" && Number.isFinite(fileSize) && fileSize >= 0
      ? Math.floor(fileSize)
      : null;
  if (size === null) {
    return jsonError("A valid fileSize is required.", "invalid_input", 400);
  }

  // Would this upload push cumulative storage over the tier ceiling?
  const blocked = await enforceLimit(
    supabase,
    organizationId,
    "storage_bytes",
    size,
  );
  if (blocked) return blocked;

  const check = await checkLimit(supabase, organizationId, "storage_bytes", size);
  return NextResponse.json({ ok: true, remaining: check.remaining });
}
