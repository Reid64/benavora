import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { getAuthUrl } from "@/lib/zoho/zoho-auth";

// Zoho Mail OAuth — connect start. Connecting a mailbox integration is a
// settings-level action, so owner/admin only (same gating as the analogous
// POST /api/integrations/google route). Unlike that route, this one 302s
// directly to Zoho's consent screen rather than returning { authUrl } as
// JSON — visiting this URL in a browser while signed in is the whole flow.

export const runtime = "nodejs";

export async function GET() {
  const gate = await requireRole("admin");
  if ("error" in gate) return gate.error;

  try {
    const authUrl = getAuthUrl(gate.organizationId);
    return NextResponse.redirect(authUrl);
  } catch {
    // Most likely missing ZOHO_CLIENT_ID / ZOHO_REDIRECT_URI / ZOHO_CLIENT_SECRET.
    return NextResponse.json(
      { error: "Zoho Mail integration is not configured on the server.", code: "not_configured" },
      { status: 500 },
    );
  }
}
