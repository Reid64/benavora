import "server-only";
import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const sequenceId = params.id;

  const { data: sequence, error: seqErr } = await supabase
    .from("email_campaign_sequences")
    .select("id, name, total_enrolled, total_completed, total_replied")
    .eq("id", sequenceId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (seqErr) return NextResponse.json({ error: "Failed to load sequence." }, { status: 500 });
  if (!sequence) return NextResponse.json({ error: "Sequence not found." }, { status: 404 });

  const { data: steps, error: stepsErr } = await supabase
    .from("email_sequence_steps")
    .select("*")
    .eq("sequence_id", sequenceId)
    .order("step_number", { ascending: true });

  if (stepsErr) return NextResponse.json({ error: "Failed to load steps." }, { status: 500 });

  const { data: enrollments, error: enrollErr } = await supabase
    .from("email_sequence_enrollments")
    .select("current_step, status, reply_detected, enrolled_at, completed_at, last_sent_at")
    .eq("sequence_id", sequenceId)
    .eq("organization_id", organizationId);

  if (enrollErr) return NextResponse.json({ error: "Failed to load enrollments." }, { status: 500 });

  const rows = enrollments ?? [];
  const totalEnrolled = rows.length;

  // Step-by-step conversion funnel
  const funnel = (steps ?? []).map((step) => {
    const reached = rows.filter((e) => e.current_step >= step.step_number).length;
    const replied = rows.filter(
      (e) => e.current_step >= step.step_number && e.reply_detected,
    ).length;
    return {
      step_number: step.step_number,
      template_id: step.template_id,
      delay_days: step.delay_days,
      delay_hours: step.delay_hours,
      reached,
      replied,
      conversion_rate: totalEnrolled > 0 ? reached / totalEnrolled : 0,
      reply_rate: reached > 0 ? replied / reached : 0,
    };
  });

  // Status breakdown
  const statusCounts = rows.reduce<Record<string, number>>((acc, e) => {
    acc[e.status] = (acc[e.status] ?? 0) + 1;
    return acc;
  }, {});

  // Daily enrollment trend
  const dayMap = new Map<string, number>();
  for (const e of rows) {
    const day = e.enrolled_at.slice(0, 10);
    dayMap.set(day, (dayMap.get(day) ?? 0) + 1);
  }
  const daily_enrollments = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  return NextResponse.json({
    sequence: {
      id: sequence.id,
      name: sequence.name,
      total_enrolled: sequence.total_enrolled,
      total_completed: sequence.total_completed,
      total_replied: sequence.total_replied,
      reply_rate:
        sequence.total_enrolled > 0
          ? sequence.total_replied / sequence.total_enrolled
          : 0,
    },
    funnel,
    status_breakdown: statusCounts,
    daily_enrollments,
    // A/B variant comparison is not available — sequence steps do not track variants.
    ab_variants: [],
  });
}
