import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

// POST /api/schoolfunder/hours — log volunteer hours for a SchoolFunder
// student. Adds hours * hour_value onto the student's funded_amount so the
// dashboard progress bar reflects newly logged hours immediately (see
// src/app/(dashboard)/schoolfunder/page.tsx for the "Funds Earned" column,
// which is computed independently from schoolfunder_volunteer_hours as the
// source of truth — funded_amount here is a denormalized running total).

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body.", code: "invalid_body" },
      { status: 400 },
    );
  }

  const studentId = typeof body.student_id === "string" ? body.student_id : "";
  const hours = typeof body.hours === "number" ? body.hours : Number(body.hours);
  const activityDescription =
    typeof body.activity_description === "string"
      ? body.activity_description.trim() || null
      : null;
  const hourValue =
    typeof body.hour_value === "number" && body.hour_value > 0 ? body.hour_value : 25;

  if (!studentId || !Number.isFinite(hours) || hours <= 0) {
    return NextResponse.json(
      { error: "student_id and a positive hours value are required.", code: "missing_fields" },
      { status: 400 },
    );
  }

  const { data: student, error: studentError } = await supabase
    .from("schoolfunder_students")
    .select("id, funded_amount")
    .eq("id", studentId)
    .eq("org_id", organizationId)
    .single();

  if (studentError || !student) {
    return NextResponse.json(
      { error: "Student not found.", code: "not_found" },
      { status: 404 },
    );
  }

  const { data: hoursRow, error: insertError } = await supabase
    .from("schoolfunder_volunteer_hours")
    .insert({
      student_id: studentId,
      org_id: organizationId,
      hours,
      activity_description: activityDescription,
      hour_value: hourValue,
    })
    .select("id, student_id, hours, activity_description, verified, hour_value, logged_at")
    .single();

  if (insertError) {
    return NextResponse.json(
      { error: "Failed to log hours.", code: "insert_failed" },
      { status: 500 },
    );
  }

  const earned = hours * hourValue;
  const newFunded = Number((student as { funded_amount: number | null }).funded_amount ?? 0) + earned;

  await supabase
    .from("schoolfunder_students")
    .update({ funded_amount: newFunded })
    .eq("id", studentId);

  return NextResponse.json({ data: hoursRow, funded_amount: newFunded }, { status: 201 });
}
