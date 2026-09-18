import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Enums } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UserRole = Enums<"user_role">;

function jsonError(message: string, code: string, status: number) {
  // Consistent error shape across API routes (Behavioral Contracts §16).
  return NextResponse.json({ error: message, code }, { status });
}

interface PendingInvitation {
  id: string;
  organization_id: string;
  email: string;
  role: UserRole;
  status: string;
  expires_at: string;
}

/**
 * Load a pending, unexpired invitation by token using the service-role client.
 * The token IS the bearer credential, so no session is required (the invite page
 * is public). Returns the invitation or an error response.
 */
async function loadPendingInvitation(
  admin: ReturnType<typeof createAdminClient>,
  token: string,
): Promise<PendingInvitation | { error: NextResponse }> {
  const { data, error } = await admin
    .from("user_invitations")
    .select("id, organization_id, email, role, status, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (error) {
    return { error: jsonError("Could not validate the invitation.", "lookup_failed", 500) };
  }
  if (!data) {
    return { error: jsonError("This invitation link is invalid.", "invalid_token", 404) };
  }
  const invite = data as PendingInvitation;

  if (invite.status !== "pending") {
    return {
      error: jsonError(
        "This invitation has already been used or cancelled.",
        "not_pending",
        409,
      ),
    };
  }
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    // Mark it expired so the inviter sees the right status (best-effort).
    await admin
      .from("user_invitations")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("id", invite.id);
    return { error: jsonError("This invitation has expired.", "expired", 410) };
  }

  return invite;
}

/**
 * Accept an invitation (BLUEPRINT US-03, Behavioral Contracts §23).
 *
 * Public route - the visitor has no session, so the service-role admin client
 * creates the auth user and profile. Both the org and the role come from the
 * server-side invitation row keyed by the bearer token, never from the request
 * body (Contracts §2): the client only supplies the password and display name.
 *
 * POST { token, password, full_name? }
 *   1. Validate the token (pending + not expired).
 *   2. Create a confirmed auth user for the invited email.
 *   3. Create the profile with the invitation's organization_id and role.
 *   4. Mark the invitation accepted.
 * The client then signs in with the password and lands on /dashboard.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { token, password, full_name } = (body ?? {}) as {
    token?: unknown;
    password?: unknown;
    full_name?: unknown;
  };

  if (typeof token !== "string" || token.trim() === "") {
    return jsonError("A valid invitation token is required.", "invalid_input", 400);
  }
  if (typeof password !== "string" || password.length < 8) {
    return jsonError("Password must be at least 8 characters.", "weak_password", 400);
  }
  const fullName =
    typeof full_name === "string" && full_name.trim() ? full_name.trim() : null;

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return jsonError(
      "Invitations are not configured on this server.",
      "not_configured",
      500,
    );
  }

  const loaded = await loadPendingInvitation(admin, token);
  if ("error" in loaded) return loaded.error;
  const invite = loaded;

  // Create a confirmed auth user (admin-created users skip email confirmation).
  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email: invite.email,
      password,
      email_confirm: true,
      user_metadata: full_name ? { full_name: fullName } : {},
    });

  if (createError || !created?.user) {
    const alreadyRegistered = /already|registered|exists/i.test(
      createError?.message ?? "",
    );
    return jsonError(
      alreadyRegistered
        ? "An account already exists for this email. Please sign in instead."
        : "Could not create your account. Please try again.",
      alreadyRegistered ? "already_registered" : "create_failed",
      alreadyRegistered ? 409 : 500,
    );
  }

  const newUserId = created.user.id;

  // Link the new user to the inviting organization with the invited role.
  const { error: profileError } = await admin.from("profiles").upsert(
    {
      id: newUserId,
      organization_id: invite.organization_id,
      email: invite.email,
      full_name: fullName,
      role: invite.role,
    },
    { onConflict: "id" },
  );

  if (profileError) {
    // Roll back the orphaned auth user so the invite can be retried cleanly.
    await admin.auth.admin.deleteUser(newUserId).catch(() => {});
    return jsonError(
      "Your account could not be set up. Please try again.",
      "profile_create_failed",
      500,
    );
  }

  // Mark the invitation accepted (best-effort - the account already exists).
  await admin
    .from("user_invitations")
    .update({
      status: "accepted",
      accepted_by: newUserId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", invite.id);

  return NextResponse.json({ email: invite.email });
}
