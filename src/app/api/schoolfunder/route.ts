import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { maskDonorName } from "@/lib/schoolfunder/format";

// GET /api/schoolfunder — students (with computed hours/funds-earned) +
// recent masked donations + program stats, for the SchoolFunder dashboard
// and its client-side refresh after add-student / log-hours actions.
// POST /api/schoolfunder — add a student.

type VolunteerHoursRow = {
  student_id: string;
  hours: number;
  hour_value: number | null;
};

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data: students, error: studentsError } = await supabase
    .from("schoolfunder_students")
    .select(
      "id, first_name, last_name, email, school_name, grade_level, enrollment_year, target_tuition_amount, funded_amount, status, created_at",
    )
    .eq("org_id", organizationId)
    .order("created_at", { ascending: false });

  if (studentsError) {
    return NextResponse.json(
      { error: "Failed to load students.", code: "load_failed" },
      { status: 500 },
    );
  }

  const studentIds = (students ?? []).map((s: { id: string }) => s.id);

  const { data: hours, error: hoursError } = studentIds.length
    ? await supabase
        .from("schoolfunder_volunteer_hours")
        .select("student_id, hours, hour_value")
        .eq("org_id", organizationId)
        .in("student_id", studentIds)
    : { data: [] as VolunteerHoursRow[], error: null };

  if (hoursError) {
    return NextResponse.json(
      { error: "Failed to load volunteer hours.", code: "load_failed" },
      { status: 500 },
    );
  }

  const { data: donations, error: donationsError } = await supabase
    .from("schoolfunder_donations")
    .select("id, student_id, donor_name, amount, payment_status, disbursed, created_at")
    .eq("org_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (donationsError) {
    return NextResponse.json(
      { error: "Failed to load donations.", code: "load_failed" },
      { status: 500 },
    );
  }

  const hoursByStudent = new Map<string, { hours: number; earned: number }>();
  for (const row of (hours ?? []) as VolunteerHoursRow[]) {
    const prev = hoursByStudent.get(row.student_id) ?? { hours: 0, earned: 0 };
    prev.hours += Number(row.hours);
    prev.earned += Number(row.hours) * Number(row.hour_value ?? 25);
    hoursByStudent.set(row.student_id, prev);
  }

  const studentsWithStats = (students ?? []).map((s: { id: string; status: string }) => ({
    ...s,
    hoursLogged: hoursByStudent.get(s.id)?.hours ?? 0,
    fundsEarned: hoursByStudent.get(s.id)?.earned ?? 0,
  }));

  const donationRows = (donations ?? []) as {
    id: string;
    student_id: string | null;
    donor_name: string | null;
    amount: number;
    payment_status: string;
    disbursed: boolean;
    created_at: string;
  }[];

  const stats = {
    activeStudents: studentsWithStats.filter((s: { status: string }) => s.status === "active")
      .length,
    totalHours: Array.from(hoursByStudent.values()).reduce((sum, v) => sum + v.hours, 0),
    fundsRaised: donationRows
      .filter((d) => d.payment_status === "succeeded")
      .reduce((sum, d) => sum + Number(d.amount), 0),
    fundsDisbursed: donationRows
      .filter((d) => d.disbursed)
      .reduce((sum, d) => sum + Number(d.amount), 0),
  };

  const maskedDonations = donationRows.map((d) => ({
    ...d,
    donor_name: maskDonorName(d.donor_name),
  }));

  return NextResponse.json({ students: studentsWithStats, donations: maskedDonations, stats });
}

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

  const firstName = typeof body.first_name === "string" ? body.first_name.trim() : "";
  const lastName = typeof body.last_name === "string" ? body.last_name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";

  if (!firstName || !lastName || !email) {
    return NextResponse.json(
      { error: "first_name, last_name, and email are required.", code: "missing_fields" },
      { status: 400 },
    );
  }

  const targetAmount =
    typeof body.target_tuition_amount === "number"
      ? body.target_tuition_amount
      : typeof body.target_tuition_amount === "string" && body.target_tuition_amount.trim()
        ? Number(body.target_tuition_amount)
        : null;

  const { data, error } = await supabase
    .from("schoolfunder_students")
    .insert({
      org_id: organizationId,
      first_name: firstName,
      last_name: lastName,
      email,
      school_name: typeof body.school_name === "string" ? body.school_name.trim() || null : null,
      grade_level: typeof body.grade_level === "string" ? body.grade_level.trim() || null : null,
      enrollment_year: typeof body.enrollment_year === "number" ? body.enrollment_year : null,
      target_tuition_amount:
        targetAmount !== null && Number.isFinite(targetAmount) ? targetAmount : null,
    })
    .select(
      "id, first_name, last_name, email, school_name, grade_level, enrollment_year, target_tuition_amount, funded_amount, status, created_at",
    )
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Failed to add student.", code: "insert_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ data }, { status: 201 });
}
