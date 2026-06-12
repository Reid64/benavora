import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { handleCallback } from "@/lib/integrations/google/auth";

// Google OAuth callback (BLUEPRINT Phase 4, Contracts §19).
//
// Google redirects the user's browser here with `code` + `state` after consent.
// We exchange the code for tokens, persist them (auth.ts encrypts the refresh
// token), and redirect back to /settings with a status flag. The signed `state`
// binds the flow to an organization; we additionally require that organization
// to match the authenticated session before trusting it (Contracts §2) so a
// stray/forged callback can never write tokens into another tenant.

export const runtime = "nodejs";

function redirectToSettings(
  request: Request,
  params: Record<string, string>,
): NextResponse {
  const base =
    process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;
  const url = new URL("/settings", base);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  // User denied consent, or Google returned an error.
  if (oauthError) {
    return redirectToSettings(request, {
      google: "error",
      reason: oauthError,
    });
  }
  if (!code || !state) {
    return redirectToSettings(request, {
      google: "error",
      reason: "missing_code",
    });
  }

  // Resolve the authenticated user's organization from the session.
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return redirectToSettings(request, {
      google: "error",
      reason: "unauthenticated",
    });
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();
  if (!profile) {
    return redirectToSettings(request, {
      google: "error",
      reason: "no_profile",
    });
  }
  const sessionOrgId = profile.organization_id as string;

  try {
    const result = await handleCallback(code, state);
    // The state-bound org MUST match the signed-in user's org.
    if (result.organizationId !== sessionOrgId) {
      return redirectToSettings(request, {
        google: "error",
        reason: "org_mismatch",
      });
    }
    return redirectToSettings(request, {
      google: "connected",
      ...(result.email ? { email: result.email } : {}),
    });
  } catch {
    return redirectToSettings(request, {
      google: "error",
      reason: "exchange_failed",
    });
  }
}
