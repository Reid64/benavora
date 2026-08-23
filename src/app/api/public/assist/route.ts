import { NextResponse } from "next/server";
import { z } from "zod";

import { answerPublic } from "@/lib/knowledge/assist";
import { computeClientKey } from "@/lib/knowledge/client-key";

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
  sessionId: z.string().uuid(),
});

function clientKeyFor(request: Request, sessionId: string): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const ip = forwardedFor ? forwardedFor.split(",")[0]!.trim() : "unknown";
  return computeClientKey(ip, sessionId);
}

export async function POST(request: Request) {
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

  const { question, history, sessionId } = parsed.data;
  const clientKey = clientKeyFor(request, sessionId);

  try {
    const result = await answerPublic({ question, history, clientKey });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error && err.message === "RATE_LIMIT") {
      return NextResponse.json({ error: "daily-limit" }, { status: 429 });
    }
    console.error("ASSIST ERROR:", err);
    return NextResponse.json({ error: "assist-unavailable" }, { status: 500 });
  }
}
