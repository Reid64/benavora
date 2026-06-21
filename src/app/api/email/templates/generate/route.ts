import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { templateEngine } from "@/lib/email/template-engine";

export const runtime = "nodejs";
export const maxDuration = 300;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

// POST /api/email/templates/generate — AI-generate a template without saving it.
// The caller reviews the result and confirms before saving via POST /api/email/templates.
export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { organizationId } = gate;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { funder_name, opportunity_name, purpose, tone } = (raw ?? {}) as {
    funder_name?: unknown;
    opportunity_name?: unknown;
    purpose?: unknown;
    tone?: unknown;
  };

  if (typeof funder_name !== "string" || funder_name.trim() === "") {
    return jsonError("funder_name is required.", "invalid_input", 400);
  }
  if (typeof purpose !== "string" || purpose.trim() === "") {
    return jsonError("purpose is required.", "invalid_input", 400);
  }
  if (typeof tone !== "string" || tone.trim() === "") {
    return jsonError("tone is required.", "invalid_input", 400);
  }

  try {
    const result = await templateEngine.generateWithAI(
      {
        funderName: funder_name.trim(),
        opportunityName:
          typeof opportunity_name === "string" ? opportunity_name.trim() : undefined,
        purpose: purpose.trim(),
        tone: tone.trim(),
      },
      organizationId,
    );

    return NextResponse.json({ template: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI generation failed";
    return jsonError(message, "ai_error", 500);
  }
}
