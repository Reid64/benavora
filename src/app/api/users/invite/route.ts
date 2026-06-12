import { randomUUID } from "crypto";

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { logAudit } from "@/lib/audit/logger";
import { getAuthorizedClient, isConnected } from "@/lib/integrations/google/auth";
import { GmailSync } from "@/lib/integrations/google/gmail";
import { USER_ROLES } from "@/lib/utils/constants";
import { isValidEmail } from "@/lib/utils/validators";
import { humanizeEnum } from "@/lib/utils/formatters";
import type { Enums } from "@/types/database";

export const runtime = "nodejs";

type UserRole = Enums<"user_role">;

// Invitations expire after 7 days (Behavioral Contracts §23).
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function jsonError(message: string, code: string, status: number) {
  // Consistent error shape across API routes (Behavioral Contracts §16).
  return NextResponse.json({ error: message, code }, { status });
}

/** Resolve the app's base URL for building the public invite link. */
function appUrl(request: Request): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  // Fall back to the request origin so the link still works without config.
  return new URL(request.url).origin;
}

/**
 * Invite a user into the caller's organization (BLUEPRINT US-03, Behavioral
 * Contracts §23).
 *
 * POST { email, role } → creates (or refreshes) a `user_invitations` record with
 * a unique token and a 7-day expiry, then either emails the invite (when the org
 * has connected Gmail) or returns the link for the inviter to share manually.
 *
 *   - Authenticated via the session; organization_id is derived from the caller's
 *     profile, never the body (Contracts §2, §16).
 *   - Only owners/admins may invite; admins cannot invite an owner — they may not
 *     grant a role higher than their own (Contracts §23 / BLUEPRINT §3.2).
 *   - One invitation per email per organization: a re-invite refreshes the
 *     existing pending row (new token + expiry) rather than duplicating it.
 */
export async function POST(request: Request) {
  // Owner or admin (admin >= owner in rank? no — requireRole("admin") allows
  // owner and admin). Role-specific limits are enforced below.
  const gate = await requireRole("admin");
  if ("error" in gate) return gate.error;
  const { supabase, userId, userRole, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { email, role } = (body ?? {}) as { email?: unknown; role?: unknown };

  if (typeof email !== "string" || !isValidEmail(email)) {
    return jsonError("A valid email address is required.", "invalid_input", 400);
  }
  if (
    typeof role !== "string" ||
    !(USER_ROLES as readonly string[]).includes(role)
  ) {
    return jsonError("A valid role is required.", "invalid_input", 400);
  }
  const invitedRole = role as UserRole;
  const invitedEmail = email.trim().toLowerCase();

  // Admins cannot invite owners (a role higher than their own) — Contracts §23.
  if (invitedRole === "owner" && userRole !== "owner") {
    return jsonError(
      "Only an owner can invite another owner.",
      "forbidden",
      403,
    );
  }

  // Refuse to invite someone who is already on the team.
  const { data: existingMember } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", invitedEmail)
    .maybeSingle();
  if (existingMember) {
    return jsonError(
      "That person is already a member of your organization.",
      "already_member",
      409,
    );
  }

  const token = randomUUID();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  const nowIso = new Date().toISOString();

  // One invitation per email per org: refresh an existing one if present.
  const { data: existingInvite } = await supabase
    .from("user_invitations")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("email", invitedEmail)
    .maybeSingle();

  if (existingInvite) {
    const { error: updateError } = await supabase
      .from("user_invitations")
      .update({
        role: invitedRole,
        token,
        status: "pending",
        invited_by: userId,
        accepted_by: null,
        expires_at: expiresAt,
        updated_at: nowIso,
      })
      .eq("id", existingInvite.id);
    if (updateError) {
      return jsonError(
        "Could not refresh the invitation. Please try again.",
        "invite_failed",
        500,
      );
    }
  } else {
    const { error: insertError } = await supabase
      .from("user_invitations")
      .insert({
        organization_id: organizationId,
        email: invitedEmail,
        role: invitedRole,
        token,
        status: "pending",
        invited_by: userId,
        expires_at: expiresAt,
      });
    if (insertError) {
      return jsonError(
        "Could not create the invitation. Please try again.",
        "invite_failed",
        500,
      );
    }
  }

  // Audit the invitation (Behavioral Contracts §24).
  await logAudit(supabase, {
    organizationId,
    userId,
    action: "invite",
    entityType: "user",
    details: { email: invitedEmail, role: invitedRole },
    request,
  });

  const inviteLink = `${appUrl(request)}/invite/${token}`;

  // Best-effort email delivery. If Gmail is connected for this org, send the
  // invite from its mailbox; otherwise the inviter shares the link manually
  // (task spec). A send failure never fails the invitation.
  let emailed = false;
  try {
    if (await isConnected(organizationId)) {
      const { data: org } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", organizationId)
        .single();
      const orgName = (org?.name as string | undefined) ?? "our organization";

      const auth = await getAuthorizedClient(organizationId);
      const gmail = new GmailSync(auth);
      await gmail.sendEmail({
        to: invitedEmail,
        subject: `You've been invited to join ${orgName} on Benavora`,
        html: true,
        body: `<p>You've been invited to join <strong>${orgName}</strong> as a ${humanizeEnum(
          invitedRole,
        )} on Benavora.</p>
<p><a href="${inviteLink}">Accept your invitation</a> to set up your account. This link expires in 7 days.</p>
<p>If the link doesn't work, copy and paste this URL into your browser:<br />${inviteLink}</p>`,
      });
      emailed = true;
    }
  } catch {
    emailed = false;
  }

  return NextResponse.json({
    invitation: {
      email: invitedEmail,
      role: invitedRole,
      expires_at: expiresAt,
    },
    link: inviteLink,
    emailed,
  });
}
