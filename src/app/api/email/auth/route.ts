import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { GmailAuthManager } from "@/lib/email/gmail-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { userId, organizationId } = gate;

  const url = new URL(request.url);
  const redirectUri = url.searchParams.get("redirect_uri");
  if (!redirectUri) {
    return NextResponse.json(
      { error: "redirect_uri is required", code: "missing_redirect_uri" },
      { status: 400 },
    );
  }

  const manager = new GmailAuthManager();
  const authUrl = manager.generateAuthUrl(organizationId, userId, redirectUri);
  return NextResponse.json({ url: authUrl });
}
