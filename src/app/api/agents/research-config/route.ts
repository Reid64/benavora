import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/role-gate";
import { generateOrgResearchConfig } from "@/lib/research/org-research-config";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST() {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;

  const { organizationId, supabase } = gate;

  try {
    const config = await generateOrgResearchConfig(organizationId, supabase);
    return NextResponse.json({ ok: true, config });
  } catch {
    return NextResponse.json(
      {
        error: "Research configuration failed. Please try again.",
        code: "config_failed",
      },
      { status: 500 },
    );
  }
}
