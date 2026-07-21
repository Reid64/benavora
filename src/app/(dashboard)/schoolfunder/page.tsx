import { redirect } from "next/navigation";
import { GraduationCap } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { hasRequiredRole } from "@/lib/auth/role-gate";
import { formatCurrency } from "@/lib/utils/formatters";
import { maskDonorName } from "@/lib/schoolfunder/format";
import { SchoolFunderBoard } from "@/components/schoolfunder/SchoolFunderBoard";
import type { Enums } from "@/types/database";

// SchoolFunder — a Faith Foundation program (BLUEPRINT §1) where students earn
// donor-funded tuition assistance by volunteering with local nonprofits.
// Reflects live org-scoped data; never cache.
export const dynamic = "force-dynamic";

type StudentRow = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  school_name: string | null;
  grade_level: string | null;
  enrollment_year: number | null;
  target_tuition_amount: number | null;
  funded_amount: number | null;
  status: string;
  created_at: string;
};

type VolunteerHoursRow = {
  student_id: string;
  hours: number;
  hour_value: number | null;
};

type DonationRow = {
  id: string;
  student_id: string | null;
  donor_name: string | null;
  amount: number;
  payment_status: string;
  disbursed: boolean;
  created_at: string;
};

const CANVAS = "#D6E4F0";
const CARD = "#FFFFFF";
const GREEN = "#10B981";

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        backgroundColor: CARD,
        borderRadius: "12px",
        borderLeft: `4px solid ${GREEN}`,
        padding: "18px 20px",
        boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
      }}
    >
      <div
        style={{
          fontSize: "11px",
          fontWeight: 700,
          color: "#64748B",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: "28px", fontWeight: 800, color: "#0F172A", marginTop: "6px" }}>
        {value}
      </div>
    </div>
  );
}

export default async function SchoolFunderPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id, role")
    .eq("id", user.id)
    .single();

  if (!profile?.organization_id) {
    return (
      <div
        style={{
          backgroundColor: "#FEF2F2",
          border: "1px solid #FECACA",
          borderRadius: "8px",
          padding: "12px 16px",
          fontSize: "14px",
          color: "#B91C1C",
        }}
      >
        We couldn&rsquo;t resolve your organization. Please sign in again.
      </div>
    );
  }

  const orgId = profile.organization_id as string;
  const role = profile.role as Enums<"user_role">;

  const [studentsRes, donationsRes] = await Promise.all([
    supabase
      .from("schoolfunder_students")
      .select(
        "id, first_name, last_name, email, school_name, grade_level, enrollment_year, target_tuition_amount, funded_amount, status, created_at",
      )
      .eq("org_id", orgId)
      .order("created_at", { ascending: false }),
    supabase
      .from("schoolfunder_donations")
      .select("id, student_id, donor_name, amount, payment_status, disbursed, created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const students = (studentsRes.data ?? []) as StudentRow[];
  const donations = (donationsRes.data ?? []) as DonationRow[];

  const studentIds = students.map((s) => s.id);
  const hoursRes = studentIds.length
    ? await supabase
        .from("schoolfunder_volunteer_hours")
        .select("student_id, hours, hour_value")
        .eq("org_id", orgId)
        .in("student_id", studentIds)
    : { data: [] as VolunteerHoursRow[], error: null };

  const hours = (hoursRes.data ?? []) as VolunteerHoursRow[];

  const loadError =
    studentsRes.error || donationsRes.error || hoursRes.error
      ? "Some SchoolFunder data failed to load. This likely means the schoolfunder_* tables have not been created yet in this environment — see the migration this task generated (supabase/migrations/103_schoolfunder.sql) and apply it via the Supabase SQL editor."
      : null;

  const hoursByStudent = new Map<string, { hours: number; earned: number }>();
  for (const row of hours) {
    const prev = hoursByStudent.get(row.student_id) ?? { hours: 0, earned: 0 };
    prev.hours += Number(row.hours);
    prev.earned += Number(row.hours) * Number(row.hour_value ?? 25);
    hoursByStudent.set(row.student_id, prev);
  }

  const studentsWithStats = students.map((s) => ({
    ...s,
    hoursLogged: hoursByStudent.get(s.id)?.hours ?? 0,
    fundsEarned: hoursByStudent.get(s.id)?.earned ?? 0,
  }));

  const totalHours = Array.from(hoursByStudent.values()).reduce((sum, v) => sum + v.hours, 0);
  const fundsRaised = donations
    .filter((d) => d.payment_status === "succeeded")
    .reduce((sum, d) => sum + Number(d.amount), 0);
  const fundsDisbursed = donations
    .filter((d) => d.disbursed)
    .reduce((sum, d) => sum + Number(d.amount), 0);

  const stats = {
    activeStudents: students.filter((s) => s.status === "active").length,
    totalHours,
    fundsRaised,
    fundsDisbursed,
  };

  const maskedDonations = donations.map((d) => ({
    ...d,
    donor_name: maskDonorName(d.donor_name),
  }));

  return (
    <div style={{ backgroundColor: CANVAS, minHeight: "100vh", padding: "32px" }}>
      <div style={{ marginBottom: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              width: "40px",
              height: "40px",
              borderRadius: "10px",
              backgroundColor: GREEN,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <GraduationCap size={22} color="#FFFFFF" aria-hidden />
          </div>
          <h1
            style={{
              fontSize: "28px",
              fontWeight: 800,
              color: "#0F172A",
              letterSpacing: "-0.02em",
              margin: 0,
            }}
          >
            SchoolFunder
          </h1>
        </div>
        <p style={{ fontSize: "14px", color: "#64748B", marginTop: "4px" }}>
          Students earn tuition assistance through nonprofit volunteering
        </p>
      </div>

      {loadError && (
        <div
          style={{
            backgroundColor: "#FEF2F2",
            border: "1px solid #FECACA",
            borderRadius: "8px",
            padding: "12px 16px",
            fontSize: "13px",
            color: "#B91C1C",
            marginBottom: "20px",
          }}
        >
          {loadError}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "16px",
          marginBottom: "24px",
        }}
      >
        <StatCard label="Active Students" value={String(stats.activeStudents)} />
        <StatCard label="Total Hours Logged" value={stats.totalHours.toLocaleString()} />
        <StatCard label="Funds Raised" value={formatCurrency(stats.fundsRaised)} />
        <StatCard label="Funds Disbursed" value={formatCurrency(stats.fundsDisbursed)} />
      </div>

      <SchoolFunderBoard
        initialStudents={studentsWithStats}
        initialDonations={maskedDonations}
        canWrite={hasRequiredRole(role, "writer")}
      />
    </div>
  );
}
