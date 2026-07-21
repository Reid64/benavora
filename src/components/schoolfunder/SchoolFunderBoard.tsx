"use client";

import { Fragment, useMemo, useState } from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";

import { formatCurrency, formatDate } from "@/lib/utils/formatters";

const GREEN = "#10B981";
const CARD = "#FFFFFF";
const BORDER = "#E2E8F0";

export type StudentWithStats = {
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
  hoursLogged: number;
  fundsEarned: number;
};

export type MaskedDonation = {
  id: string;
  student_id: string | null;
  donor_name: string | null;
  amount: number;
  payment_status: string;
  disbursed: boolean;
  created_at: string;
};

type Props = {
  initialStudents: StudentWithStats[];
  initialDonations: MaskedDonation[];
  canWrite: boolean;
};

type NewStudentForm = {
  first_name: string;
  last_name: string;
  email: string;
  school_name: string;
  grade_level: string;
  target_tuition_amount: string;
};

const EMPTY_STUDENT_FORM: NewStudentForm = {
  first_name: "",
  last_name: "",
  email: "",
  school_name: "",
  grade_level: "",
  target_tuition_amount: "",
};

const inputStyle: CSSProperties = {
  border: `1px solid ${BORDER}`,
  borderRadius: "6px",
  padding: "6px 10px",
  fontSize: "13px",
  width: "100%",
};

function statusColor(status: string): string {
  if (status === "active") return GREEN;
  if (status === "graduated") return "#0077B6";
  if (status === "inactive") return "#94A3B8";
  return "#64748B";
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        fontSize: "11px",
        color: "#64748B",
        fontWeight: 600,
      }}
    >
      {label}
      {children}
    </label>
  );
}

export function SchoolFunderBoard({ initialStudents, initialDonations, canWrite }: Props) {
  const [students, setStudents] = useState(initialStudents);
  const [donations] = useState(initialDonations);

  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<NewStudentForm>(EMPTY_STUDENT_FORM);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSubmitting, setAddSubmitting] = useState(false);

  const [hoursFormStudentId, setHoursFormStudentId] = useState<string | null>(null);
  const [hoursValue, setHoursValue] = useState("");
  const [hoursActivity, setHoursActivity] = useState("");
  const [hoursError, setHoursError] = useState<string | null>(null);
  const [hoursSubmitting, setHoursSubmitting] = useState(false);

  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null);

  const studentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of students) map.set(s.id, `${s.first_name} ${s.last_name}`);
    return map;
  }, [students]);

  async function refreshFromServer() {
    try {
      const res = await fetch("/api/schoolfunder", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.students)) setStudents(data.students as StudentWithStats[]);
    } catch {
      // Non-fatal — local state stays as-is.
    }
  }

  async function handleAddStudent(e: FormEvent) {
    e.preventDefault();
    setAddError(null);

    if (!addForm.first_name.trim() || !addForm.last_name.trim() || !addForm.email.trim()) {
      setAddError("First name, last name, and email are required.");
      return;
    }

    setAddSubmitting(true);
    try {
      const res = await fetch("/api/schoolfunder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: addForm.first_name.trim(),
          last_name: addForm.last_name.trim(),
          email: addForm.email.trim(),
          school_name: addForm.school_name.trim() || undefined,
          grade_level: addForm.grade_level.trim() || undefined,
          target_tuition_amount: addForm.target_tuition_amount
            ? Number(addForm.target_tuition_amount)
            : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddError(data.error ?? "Failed to add student.");
        return;
      }
      setAddForm(EMPTY_STUDENT_FORM);
      setShowAddForm(false);
      await refreshFromServer();
    } catch {
      setAddError("Failed to add student. Please try again.");
    } finally {
      setAddSubmitting(false);
    }
  }

  async function handleLogHours(studentId: string, e: FormEvent) {
    e.preventDefault();
    setHoursError(null);

    const hoursNum = Number(hoursValue);
    if (!Number.isFinite(hoursNum) || hoursNum <= 0) {
      setHoursError("Enter a positive number of hours.");
      return;
    }

    setHoursSubmitting(true);
    try {
      const res = await fetch("/api/schoolfunder/hours", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student_id: studentId,
          hours: hoursNum,
          activity_description: hoursActivity.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setHoursError(data.error ?? "Failed to log hours.");
        return;
      }
      setHoursValue("");
      setHoursActivity("");
      setHoursFormStudentId(null);
      await refreshFromServer();
    } catch {
      setHoursError("Failed to log hours. Please try again.");
    } finally {
      setHoursSubmitting(false);
    }
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "2fr 1fr",
        gap: "20px",
        alignItems: "start",
      }}
    >
      <div>
        {canWrite && (
          <div style={{ marginBottom: "16px" }}>
            <button
              type="button"
              onClick={() => setShowAddForm((v) => !v)}
              style={{
                backgroundColor: GREEN,
                color: "#FFFFFF",
                fontWeight: 700,
                fontSize: "13px",
                padding: "10px 18px",
                borderRadius: "8px",
                border: "none",
                cursor: "pointer",
              }}
            >
              {showAddForm ? "Cancel" : "+ Add Student"}
            </button>

            {showAddForm && (
              <form
                onSubmit={handleAddStudent}
                style={{
                  backgroundColor: CARD,
                  borderRadius: "12px",
                  padding: "16px",
                  marginTop: "12px",
                  boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                  gap: "10px",
                }}
              >
                <Field label="First Name">
                  <input
                    value={addForm.first_name}
                    onChange={(e) => setAddForm((f) => ({ ...f, first_name: e.target.value }))}
                    style={inputStyle}
                  />
                </Field>
                <Field label="Last Name">
                  <input
                    value={addForm.last_name}
                    onChange={(e) => setAddForm((f) => ({ ...f, last_name: e.target.value }))}
                    style={inputStyle}
                  />
                </Field>
                <Field label="Email">
                  <input
                    type="email"
                    value={addForm.email}
                    onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                    style={inputStyle}
                  />
                </Field>
                <Field label="School">
                  <input
                    value={addForm.school_name}
                    onChange={(e) => setAddForm((f) => ({ ...f, school_name: e.target.value }))}
                    style={inputStyle}
                  />
                </Field>
                <Field label="Grade Level">
                  <input
                    value={addForm.grade_level}
                    onChange={(e) => setAddForm((f) => ({ ...f, grade_level: e.target.value }))}
                    style={inputStyle}
                  />
                </Field>
                <Field label="Target Amount ($)">
                  <input
                    type="number"
                    min="0"
                    value={addForm.target_tuition_amount}
                    onChange={(e) =>
                      setAddForm((f) => ({ ...f, target_tuition_amount: e.target.value }))
                    }
                    style={inputStyle}
                  />
                </Field>
                <div style={{ gridColumn: "1 / -1" }}>
                  {addError && (
                    <p style={{ color: "#B91C1C", fontSize: "12px", marginBottom: "8px" }}>
                      {addError}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={addSubmitting}
                    style={{
                      backgroundColor: GREEN,
                      color: "#FFFFFF",
                      fontWeight: 700,
                      fontSize: "13px",
                      padding: "8px 16px",
                      borderRadius: "8px",
                      border: "none",
                      cursor: addSubmitting ? "not-allowed" : "pointer",
                      opacity: addSubmitting ? 0.6 : 1,
                    }}
                  >
                    {addSubmitting ? "Saving…" : "Save Student"}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        <div
          style={{
            backgroundColor: CARD,
            borderRadius: "12px",
            boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
            overflow: "hidden",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr style={{ backgroundColor: "#F8FAFC", textAlign: "left" }}>
                {[
                  "Name",
                  "School",
                  "Hours Logged",
                  "Funds Earned",
                  "Target Amount",
                  "Progress",
                  "Status",
                  "Actions",
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "10px 14px",
                      fontSize: "11px",
                      fontWeight: 700,
                      color: "#64748B",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      borderBottom: `1px solid ${BORDER}`,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {students.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: "24px", textAlign: "center", color: "#94A3B8" }}>
                    No students yet. Add the first SchoolFunder student to get started.
                  </td>
                </tr>
              )}
              {students.map((s) => {
                const target = s.target_tuition_amount ?? 0;
                const funded = s.funded_amount ?? 0;
                const pct = target > 0 ? Math.min(100, Math.round((funded / target) * 100)) : 0;
                const expanded = expandedStudentId === s.id;
                const loggingHours = hoursFormStudentId === s.id;
                return (
                  <Fragment key={s.id}>
                    <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                      <td style={{ padding: "10px 14px", fontWeight: 600, color: "#0F172A" }}>
                        {s.first_name} {s.last_name}
                      </td>
                      <td style={{ padding: "10px 14px", color: "#475569" }}>
                        {s.school_name ?? "-"}
                      </td>
                      <td style={{ padding: "10px 14px", color: "#475569" }}>{s.hoursLogged}</td>
                      <td style={{ padding: "10px 14px", color: "#475569" }}>
                        {formatCurrency(s.fundsEarned)}
                      </td>
                      <td style={{ padding: "10px 14px", color: "#475569" }}>
                        {s.target_tuition_amount ? formatCurrency(s.target_tuition_amount) : "-"}
                      </td>
                      <td style={{ padding: "10px 14px", minWidth: "120px" }}>
                        <div
                          style={{
                            backgroundColor: "#E2E8F0",
                            borderRadius: "999px",
                            height: "8px",
                            overflow: "hidden",
                          }}
                        >
                          <div style={{ backgroundColor: GREEN, width: `${pct}%`, height: "100%" }} />
                        </div>
                        <span style={{ fontSize: "11px", color: "#64748B" }}>{pct}%</span>
                      </td>
                      <td style={{ padding: "10px 14px" }}>
                        <span
                          style={{
                            backgroundColor: `${statusColor(s.status)}1A`,
                            color: statusColor(s.status),
                            fontSize: "11px",
                            fontWeight: 700,
                            padding: "3px 10px",
                            borderRadius: "999px",
                            textTransform: "capitalize",
                          }}
                        >
                          {s.status}
                        </span>
                      </td>
                      <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                        {canWrite && (
                          <button
                            type="button"
                            onClick={() => {
                              setHoursFormStudentId(loggingHours ? null : s.id);
                              setHoursError(null);
                            }}
                            style={{
                              fontSize: "12px",
                              color: GREEN,
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              fontWeight: 600,
                              marginRight: "10px",
                            }}
                          >
                            Log Hours
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setExpandedStudentId(expanded ? null : s.id)}
                          style={{
                            fontSize: "12px",
                            color: "#0077B6",
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            fontWeight: 600,
                          }}
                        >
                          {expanded ? "Hide Details" : "View Details"}
                        </button>
                      </td>
                    </tr>
                    {loggingHours && (
                      <tr>
                        <td colSpan={8} style={{ padding: "12px 14px", backgroundColor: "#F8FAFC" }}>
                          <form
                            onSubmit={(e) => handleLogHours(s.id, e)}
                            style={{ display: "flex", gap: "10px", alignItems: "flex-end", flexWrap: "wrap" }}
                          >
                            <Field label="Hours">
                              <input
                                type="number"
                                min="0.25"
                                step="0.25"
                                value={hoursValue}
                                onChange={(e) => setHoursValue(e.target.value)}
                                style={{ ...inputStyle, width: "90px" }}
                              />
                            </Field>
                            <Field label="Activity">
                              <input
                                value={hoursActivity}
                                onChange={(e) => setHoursActivity(e.target.value)}
                                style={{ ...inputStyle, width: "240px" }}
                                placeholder="e.g. Food pantry sorting"
                              />
                            </Field>
                            <button
                              type="submit"
                              disabled={hoursSubmitting}
                              style={{
                                backgroundColor: GREEN,
                                color: "#FFFFFF",
                                fontWeight: 700,
                                fontSize: "12px",
                                padding: "8px 16px",
                                borderRadius: "8px",
                                border: "none",
                                cursor: hoursSubmitting ? "not-allowed" : "pointer",
                                opacity: hoursSubmitting ? 0.6 : 1,
                              }}
                            >
                              {hoursSubmitting ? "Saving…" : "Save Hours"}
                            </button>
                            {hoursError && (
                              <p style={{ color: "#B91C1C", fontSize: "12px", margin: 0 }}>
                                {hoursError}
                              </p>
                            )}
                          </form>
                        </td>
                      </tr>
                    )}
                    {expanded && (
                      <tr>
                        <td
                          colSpan={8}
                          style={{
                            padding: "12px 14px",
                            backgroundColor: "#F8FAFC",
                            fontSize: "12px",
                            color: "#475569",
                          }}
                        >
                          <div>
                            <strong>Email:</strong> {s.email}
                          </div>
                          <div>
                            <strong>Grade Level:</strong> {s.grade_level ?? "-"}
                          </div>
                          <div>
                            <strong>Enrollment Year:</strong> {s.enrollment_year ?? "-"}
                          </div>
                          <div>
                            <strong>Student since:</strong> {formatDate(s.created_at)}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div
        style={{
          backgroundColor: CARD,
          borderRadius: "12px",
          padding: "18px",
          boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
        }}
      >
        <h2
          style={{
            fontSize: "13px",
            fontWeight: 700,
            color: "#0F172A",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            marginBottom: "14px",
          }}
        >
          Recent Donations
        </h2>
        {donations.length === 0 && (
          <p style={{ fontSize: "13px", color: "#94A3B8" }}>No donations yet.</p>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {donations.map((d) => (
            <div key={d.id} style={{ borderBottom: `1px solid ${BORDER}`, paddingBottom: "10px" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "#0F172A",
                }}
              >
                <span>{d.donor_name}</span>
                <span>{formatCurrency(d.amount)}</span>
              </div>
              <div style={{ fontSize: "11px", color: "#64748B", marginTop: "2px" }}>
                {d.student_id ? studentNameById.get(d.student_id) ?? "Unknown student" : "General fund"}
                {" · "}
                {formatDate(d.created_at)}
              </div>
              <div style={{ marginTop: "4px" }}>
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: "999px",
                    backgroundColor: d.disbursed ? "#10B9811A" : "#F59E0B1A",
                    color: d.disbursed ? GREEN : "#F59E0B",
                  }}
                >
                  {d.disbursed ? "Disbursed" : "Pending Disbursement"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
