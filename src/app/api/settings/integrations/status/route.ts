import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;

  return NextResponse.json({
    resend_configured: Boolean(process.env.RESEND_API_KEY),
  });
}
