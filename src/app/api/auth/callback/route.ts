import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Supabase auth callback (BLUEPRINT §3.1).
 *
 * Handles the email-confirmation / magic-link redirect: exchanges the `code`
 * for a session, then bootstraps the organization + owner profile via the
 * idempotent `register_organization()` RPC (migration 002). The RPC reads org
 * name / full name from auth metadata set at sign-up and acts only on auth.uid()
 * — organization_id is never taken from the request (Behavioral Contracts §2).
 *
 * On any failure the only action is a redirect to /login (Behavioral Contracts
 * §1: failed auth → /login, no exceptions).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const loginUrl = new URL("/login", url.origin);

  if (!code) {
    return NextResponse.redirect(loginUrl);
  }

  const supabase = createClient();
  const { error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    return NextResponse.redirect(loginUrl);
  }

  // Idempotent: returns the existing organization_id if one already exists.
  const { error: rpcError } = await supabase.rpc("register_organization");
  if (rpcError) {
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.redirect(new URL("/dashboard", url.origin));
}
