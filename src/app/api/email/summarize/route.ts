import { NextResponse } from "next/server";

import { createTrackedAnthropic } from "@/lib/ai/tracked-anthropic";
import { requireRole } from "@/lib/auth/role-gate";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { organizationId } = gate;

  const body = await request.json().catch(() => ({})) as { thread_id?: string };
  const threadId = body.thread_id;
  if (!threadId || typeof threadId !== "string") {
    return NextResponse.json({ error: "thread_id required" }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: thread } = await supabase
    .from("synced_email_threads")
    .select("id, subject")
    .eq("id", threadId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  const { data: messages } = await supabase
    .from("synced_email_messages")
    .select("from_name, from_email, sent_at, body_text")
    .eq("thread_id", threadId)
    .eq("organization_id", organizationId)
    .order("sent_at", { ascending: true });

  if (!messages?.length) {
    return NextResponse.json({ summary: "No messages found in this thread." });
  }

  const transcript = messages
    .map(
      (m) =>
        `From: ${m.from_name ?? m.from_email ?? "Unknown"} (${m.sent_at ?? ""})\n${m.body_text ?? ""}`,
    )
    .join("\n\n---\n\n");

  try {
    const client = createTrackedAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY }, "email-summarize");
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: `Summarize this email thread concisely (2-4 sentences). Focus on key topics, decisions, and action items.\n\nSubject: ${thread.subject ?? "(no subject)"}\n\n${transcript}`,
        },
      ],
    });

    const firstContent = response.content[0];
    const summary = firstContent?.type === "text" ? firstContent.text : "";

    return NextResponse.json({ summary });
  } catch {
    // Anthropic SDK errors can carry raw provider error bodies — never
    // relay those to the client.
    return NextResponse.json({ error: "Failed to summarize thread." }, { status: 502 });
  }
}
