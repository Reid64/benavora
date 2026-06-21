import "server-only";
import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

function periodStart(period: string): string | null {
  const days = period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : 0;
  if (!days) return null;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function GET(request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period") ?? "30d";
  const sequenceId = searchParams.get("sequence_id");
  const since = periodStart(period);

  // Load sequences for the org
  let seqQuery = supabase
    .from("email_campaign_sequences")
    .select("id, name, total_enrolled, total_completed, total_replied")
    .eq("organization_id", organizationId);
  if (sequenceId) seqQuery = seqQuery.eq("id", sequenceId);

  const { data: sequences, error: seqErr } = await seqQuery;
  if (seqErr) return NextResponse.json({ error: "Failed to load analytics." }, { status: 500 });

  const seqIds = (sequences ?? []).map((s) => s.id);

  // Load enrollments filtered to those sequences
  const enrollments = await (async () => {
    if (seqIds.length === 0) return [];
    let q = supabase
      .from("email_sequence_enrollments")
      .select("*")
      .eq("organization_id", organizationId)
      .in("sequence_id", seqIds);
    if (since) q = q.gte("enrolled_at", since);
    const { data } = await q;
    return data ?? [];
  })();

  const total_sent = enrollments.filter((r) => r.current_step > 0).length;
  const total_opened = 0; // no open-tracking column exists yet
  const total_replied = enrollments.filter((r) => r.reply_detected).length;
  const total_bounced = 0; // no bounce-tracking column exists yet
  const open_rate = total_sent > 0 ? total_opened / total_sent : 0;
  const reply_rate = total_sent > 0 ? total_replied / total_sent : 0;
  const bounce_rate = total_sent > 0 ? total_bounced / total_sent : 0;

  const by_sequence = (sequences ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    enrolled: s.total_enrolled,
    completed: s.total_completed,
    replied: s.total_replied,
    reply_rate: s.total_enrolled > 0 ? s.total_replied / s.total_enrolled : 0,
  }));

  // Load steps to map templates to sends
  const stepsData = await (async () => {
    if (seqIds.length === 0) return [];
    const { data } = await supabase
      .from("email_sequence_steps")
      .select("sequence_id, step_number, template_id")
      .in("sequence_id", seqIds);
    return data ?? [];
  })();

  const templateIds = [
    ...new Set(
      stepsData.filter((s) => s.template_id != null).map((s) => s.template_id as string),
    ),
  ];

  const templatesData = await (async () => {
    if (templateIds.length === 0) return [];
    const { data } = await supabase
      .from("email_templates")
      .select("id, name")
      .in("id", templateIds);
    return data ?? [];
  })();

  const by_template = templatesData.map((t) => {
    // sequence_id -> step_numbers using this template
    const stepsBySeq = new Map<string, number[]>();
    for (const step of stepsData) {
      if (step.template_id !== t.id) continue;
      const nums = stepsBySeq.get(step.sequence_id) ?? [];
      nums.push(step.step_number);
      stepsBySeq.set(step.sequence_id, nums);
    }
    let sends = 0;
    let replies = 0;
    for (const e of enrollments) {
      const nums = stepsBySeq.get(e.sequence_id) ?? [];
      if (nums.some((n) => e.current_step >= n)) {
        sends++;
        if (e.reply_detected) replies++;
      }
    }
    return {
      id: t.id,
      name: t.name,
      sends,
      replies,
      reply_rate: sends > 0 ? replies / sends : 0,
    };
  });

  // Daily send counts keyed by last_sent_at date
  const dayMap = new Map<string, number>();
  for (const e of enrollments) {
    if (!e.last_sent_at) continue;
    const day = e.last_sent_at.slice(0, 10);
    dayMap.set(day, (dayMap.get(day) ?? 0) + 1);
  }
  const daily_sends = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  const top_performing_templates = [...by_template]
    .sort((a, b) => b.reply_rate - a.reply_rate)
    .slice(0, 5)
    .map(({ id, name, reply_rate: rr }) => ({ id, name, reply_rate: rr }));

  return NextResponse.json({
    total_sent,
    total_opened,
    total_replied,
    total_bounced,
    open_rate,
    reply_rate,
    bounce_rate,
    by_sequence,
    by_template,
    daily_sends,
    top_performing_templates,
  });
}
