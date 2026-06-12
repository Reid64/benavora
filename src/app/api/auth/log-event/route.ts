import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit/logger";

// Authentication audit events (BLUEPRINT Phase 5 / Behavioral Contracts §24:
// "Login/logout events logged automatically").
//
// Sign-in/out happen on the client via the Supabase JS auth API, so the client
// pings this endpoint to record the event with a real server-side actor and the
// request's IP + user agent. Call it AFTER a successful sign-in, and BEFORE
// sign-out (while the session is still valid) so the user can be resolved.
//
//   POST { event: 'login' | 'logout' } → 204

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(request: Request) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("Authentication required.", "unauthenticated", 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }
  const { event } = (body ?? {}) as { event?: unknown };
  if (event !== "login" && event !== "logout") {
    return jsonError("event must be 'login' or 'logout'.", "invalid_input", 400);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, organization_id")
    .eq("id", user.id)
    .single();
  if (!profile) {
    return jsonError("Could not resolve your profile.", "no_profile", 403);
  }

  // On login, also stamp last_login_at (BLUEPRINT profiles.last_login_at).
  if (event === "login") {
    await supabase
      .from("profiles")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", profile.id);
  }

  await logAudit(supabase, {
    organizationId: profile.organization_id as string,
    userId: profile.id as string,
    action: event,
    entityType: "session",
    entityId: profile.id as string,
    request,
  });

  return new NextResponse(null, { status: 204 });
}
