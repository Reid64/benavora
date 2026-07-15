import Link from "next/link";

import { createAdminClient } from "@/lib/supabase/admin";
import { Logo } from "@/components/layout/Logo";
import { humanizeEnum } from "@/lib/utils/formatters";
import type { Enums } from "@/types/database";

import { AcceptForm } from "./AcceptForm";

export const runtime = "nodejs";
// The invitation state changes per request; never cache this page.
export const dynamic = "force-dynamic";

type UserRole = Enums<"user_role">;

type InviteState =
  | { kind: "ok"; orgName: string; email: string; role: UserRole }
  | { kind: "error"; reason: string };

/**
 * Validate the invitation token server-side. The visitor is unauthenticated and
 * RLS scopes user_invitations to a member's org, so the service-role client is
 * used to read the token-keyed row (the token is the bearer credential). Only
 * non-secret display fields (org name, email, role) are passed to the client.
 */
async function resolveInvite(token: string): Promise<InviteState> {
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return { kind: "error", reason: "Invitations are not configured." };
  }

  const { data, error } = await admin
    .from("user_invitations")
    .select("organization_id, email, role, status, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (error) return { kind: "error", reason: "We couldn't validate this invitation." };
  if (!data) return { kind: "error", reason: "This invitation link is invalid." };
  if (data.status !== "pending") {
    return {
      kind: "error",
      reason: "This invitation has already been used or cancelled.",
    };
  }
  if (new Date(data.expires_at as string).getTime() < Date.now()) {
    return { kind: "error", reason: "This invitation has expired." };
  }

  const { data: org } = await admin
    .from("organizations")
    .select("name")
    .eq("id", data.organization_id as string)
    .single();

  return {
    kind: "ok",
    orgName: (org?.name as string | undefined) ?? "this organization",
    email: data.email as string,
    role: data.role as UserRole,
  };
}

export default async function InviteAcceptPage({
  params,
}: {
  params: { token: string };
}) {
  const state = await resolveInvite(params.token);

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo size={40} />
        </div>

        {state.kind === "error" ? (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-5 py-6 text-center"
          >
            <h1 className="text-lg font-semibold text-red-900">
              Invitation unavailable
            </h1>
            <p className="mt-2 text-sm text-red-700">{state.reason}</p>
            <Link
              href="/login"
              className="mt-4 inline-block text-sm font-semibold text-teal-600 transition hover:text-teal-700"
            >
              Go to sign in
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-center text-2xl font-semibold tracking-tight text-navy-900">
              Join {state.orgName}
            </h1>
            <p className="mt-2 text-center text-sm text-navy-500">
              You&apos;ve been invited to join{" "}
              <span className="font-medium text-navy-700">{state.orgName}</span>{" "}
              as a{" "}
              <span className="font-medium text-navy-700">
                {humanizeEnum(state.role)}
              </span>
              . Set a password to activate your account.
            </p>

            <div className="mt-8">
              <AcceptForm token={params.token} email={state.email} />
            </div>

            <p className="mt-8 text-center text-sm text-navy-500">
              Already have an account?{" "}
              <Link
                href="/login"
                className="font-semibold text-teal-600 transition hover:text-teal-700"
              >
                Sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
