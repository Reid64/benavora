import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { GmailAuthManager } from "@/lib/email/gmail-auth";

export const runtime = "nodejs";

function redirectToIntegrations(
  request: Request,
  params: Record<string, string>,
): NextResponse {
  const base =
    process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;
  const target = new URL("/settings/integrations", base);
  for (const [k, v] of Object.entries(params)) {
    target.searchParams.set(k, v);
  }
  return NextResponse.redirect(target);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return redirectToIntegrations(request, { gmail: "error", reason: oauthError });
  }
  if (!code || !state) {
    return redirectToIntegrations(request, { gmail: "error", reason: "missing_code" });
  }

  // Resolve the authenticated user's organization from the session. The signed
  // `state` already binds the flow to an org (see gmail-auth.ts), but we
  // additionally require that org to match the logged-in session before
  // trusting it (Contracts §2) so a stray/forged callback can never write
  // tokens into another tenant.
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return redirectToIntegrations(request, { gmail: "error", reason: "unauthenticated" });
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();
  if (!profile) {
    return redirectToIntegrations(request, { gmail: "error", reason: "no_profile" });
  }
  const sessionOrgId = profile.organization_id as string;

  // The redirectUri passed to handleCallback must match what was sent to Google.
  // Since this route IS the callback handler, derive it from the current URL.
  const callbackUri = `${url.origin}${url.pathname}`;

  const manager = new GmailAuthManager();
  try {
    const result = await manager.handleCallback(code, state, callbackUri);
    // The state-bound org MUST match the signed-in user's org.
    if (result.organizationId !== sessionOrgId) {
      return redirectToIntegrations(request, { gmail: "error", reason: "org_mismatch" });
    }
    return redirectToIntegrations(request, { gmail: "connected" });
  } catch {
    return redirectToIntegrations(request, { gmail: "error", reason: "exchange_failed" });
  }
}
