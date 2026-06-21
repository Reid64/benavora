import { NextResponse } from "next/server";

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

  // The redirectUri passed to handleCallback must match what was sent to Google.
  // Since this route IS the callback handler, derive it from the current URL.
  const callbackUri = `${url.origin}${url.pathname}`;

  const manager = new GmailAuthManager();
  try {
    await manager.handleCallback(code, state, callbackUri);
    return redirectToIntegrations(request, { gmail: "connected" });
  } catch {
    return redirectToIntegrations(request, { gmail: "error", reason: "exchange_failed" });
  }
}
