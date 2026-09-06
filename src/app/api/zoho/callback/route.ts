import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { handleCallback } from "@/lib/zoho/zoho-auth";

// Zoho Mail OAuth callback. Zoho redirects the user's browser here with
// `code` + `state` after consent. Mirrors /api/integrations/google/callback:
// exchange the code, persist tokens (zoho-auth.ts encrypts the refresh
// token), and redirect back to /settings with a status flag. The signed
// `state` binds the flow to an organization; we additionally require that
// organization to match the authenticated session before trusting it
// (Contracts §2) so a stray/forged callback can never write tokens into
// another tenant.

export const runtime = "nodejs";

function redirectToSettings(request: Request, params: Record<string, string>): NextResponse {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;
  const url = new URL("/settings", base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return redirectToSettings(request, { zoho: "error", reason: oauthError });
  }
  if (!code || !state) {
    return redirectToSettings(request, { zoho: "error", reason: "missing_code" });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return redirectToSettings(request, { zoho: "error", reason: "unauthenticated" });
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();
  if (!profile) {
    return redirectToSettings(request, { zoho: "error", reason: "no_profile" });
  }
  const sessionOrgId = profile.organization_id as string;

  try {
    const result = await handleCallback(code, state);
    if (result.organizationId !== sessionOrgId) {
      return redirectToSettings(request, { zoho: "error", reason: "org_mismatch" });
    }
    return redirectToSettings(request, {
      zoho: "connected",
      ...(result.email ? { email: result.email } : {}),
    });
  } catch {
    return redirectToSettings(request, { zoho: "error", reason: "exchange_failed" });
  }
}
