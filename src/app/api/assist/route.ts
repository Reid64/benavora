import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRole } from "@/lib/auth/role-gate";
import { answerApp } from "@/lib/knowledge/assist";

// POST /api/assist - the in-app, authenticated, org-scoped Benavora Assist
// surface (knw-004). organization_id and userId are derived server-side from
// the session via requireRole() (Contracts SS2) - never from the request body.
// Unlike /api/public/assist, this surface has no daily rate limit (an
// authenticated session already gates it) and no sessionId (the session
// cookie is the identity).

export const runtime = "nodejs";
export const maxDuration = 60;

const requestSchema = z.object({
  question: z.string().min(3).max(1000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(2000),
      }),
    )
    .max(12),
});

export async function POST(request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { organizationId, userId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-body" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid-body" }, { status: 400 });
  }

  const { question, history } = parsed.data;

  try {
    const result = await answerApp({ question, history, orgId: organizationId, userId });
    return NextResponse.json({
      answer: result.answer,
      citations: result.citations,
      toolsUsed: result.toolsUsed,
    });
  } catch (err) {
    console.error("ASSIST APP ERROR:", err);
    return NextResponse.json({ error: "assist-unavailable" }, { status: 500 });
  }
}
