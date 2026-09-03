"use client";

import { useCallback, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import Link from "next/link";
import { CheckCircle2, Upload } from "lucide-react";

// 3-step CSV import wizard for bulk-loading funders (STANDING_DIRECTIVES §4:
// inline hex styles only, no Tailwind color classes, matching the dashboard
// color system used across funders/page.tsx and the rest of the app).
//   1. Upload — parse the file client-side, preview the first 5 rows.
//   2. Map — match CSV columns to funders fields via dropdowns.
//   3. Confirm & import — POST the raw rows + mapping to /api/import/csv.

type ImportField = "name" | "email" | "website" | "category" | "phone" | "state" | "notes";

const IMPORT_FIELDS: { key: ImportField; label: string; required?: boolean }[] = [
  { key: "name", label: "Name", required: true },
  { key: "email", label: "Email" },
  { key: "website", label: "Website" },
  { key: "category", label: "Category" },
  { key: "phone", label: "Phone" },
  { key: "state", label: "State" },
  { key: "notes", label: "Notes" },
];

interface ImportResult {
  imported: number;
  failed: number;
  errors: string[];
}

// Admin/Platform section treatment — PAGE_TREATMENT_PROTOCOL_V2.md. Frame:
// Deep Navy. Secondary accent: Rich Gold (borders/chips only — its contrast
// as small text or white-on-fill text is too low, so `primary` stays navy).
const COLORS = {
  card: "#F8F5EE",
  border: "#E2E8F0",
  borderStrong: "#CBD5E1",
  sunken: "rgba(44,78,59,0.04)",
  text: "#0F172A",
  textMuted: "#475569",
  textSubtle: "#94A3B8",
  primary: "#2C4E3B",
  primaryHover: "#1B2C47",
  accentGold: "#C49A4F",
  successBg: "#DCFCE7",
  successText: "#15803D",
  errorBg: "#FEE2E2",
  errorText: "#B91C1C",
  warningBg: "#FEF3C7",
  warningText: "#92400E",
};

// Split-newlines-then-commas parser, per the wizard's spec — no quote
// escaping, matching what a plain funders export actually looks like.
function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r\n|\n|\r/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const headerLine = lines[0] ?? "";
  const headers = headerLine.split(",").map((h) => h.trim());
  const rows = lines.slice(1).map((line) => line.split(",").map((cell) => cell.trim()));

  return { headers, rows };
}

function StepIndicator({ current }: { current: 1 | 2 | 3 }) {
  const steps = [
    { n: 1, label: "Upload" },
    { n: 2, label: "Map Columns" },
    { n: 3, label: "Confirm & Import" },
  ] as const;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24 }}>
      {steps.map((s, i) => {
        const done = s.n < current;
        const active = s.n === current;
        return (
          <div key={s.n} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 28,
                height: 28,
                borderRadius: 9999,
                fontSize: 12,
                fontWeight: 700,
                background: done || active ? COLORS.primary : COLORS.card,
                color: done || active ? "#FFFFFF" : COLORS.textSubtle,
                border: done || active ? "none" : `1px solid ${COLORS.borderStrong}`,
              }}
            >
              {done ? <CheckCircle2 size={14} /> : s.n}
            </div>
            <span
              style={{
                fontSize: 14,
                fontWeight: active ? 600 : 500,
                color: active ? COLORS.text : COLORS.textMuted,
              }}
            >
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <div style={{ width: 32, height: 1, background: COLORS.border, marginLeft: 4 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: COLORS.primary,
        borderRadius: 15,
        boxShadow: "0 4px 20px rgba(44,78,59,0.22)",
        padding: 3,
      }}
    >
      <div style={{ background: COLORS.card, borderRadius: 12, padding: 24 }}>{children}</div>
    </div>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        background: disabled ? COLORS.borderStrong : COLORS.primary,
        color: "#FFFFFF",
        border: "none",
        borderRadius: 8,
        padding: "10px 20px",
        fontSize: 14,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        background: COLORS.card,
        color: COLORS.textMuted,
        border: `1px solid ${COLORS.borderStrong}`,
        borderRadius: 8,
        padding: "10px 20px",
        fontSize: 14,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  );
}

export default function ImportPage() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Partial<Record<ImportField, string>>>({});
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const previewRows = useMemo(() => rows.slice(0, 5), [rows]);

  const handleFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setUploadError("Please select a .csv file.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text !== "string") {
        setUploadError("Could not read the file.");
        return;
      }

      const { headers: parsedHeaders, rows: parsedRows } = parseCSV(text);
      if (parsedHeaders.length === 0 || parsedRows.length === 0) {
        setUploadError("No data rows found. Make sure the file has a header row and at least one data row.");
        return;
      }

      const autoMap: Partial<Record<ImportField, string>> = {};
      for (const field of IMPORT_FIELDS) {
        const match = parsedHeaders.find(
          (h) => h.toLowerCase().replace(/[\s_-]+/g, "") === field.key,
        );
        if (match) autoMap[field.key] = match;
      }

      setFileName(file.name);
      setHeaders(parsedHeaders);
      setRows(parsedRows);
      setMapping(autoMap);
    };
    reader.onerror = () => setUploadError("Could not read the file.");
    reader.readAsText(file);
  }, []);

  const canProceedFromMap = Boolean(mapping.name);

  const handleImport = useCallback(async () => {
    setImportError(null);
    setImporting(true);

    const records = rows.map((row) => {
      const record: Record<string, string> = {};
      headers.forEach((h, i) => {
        record[h] = row[i] ?? "";
      });
      return record;
    });

    const mappingPayload: Record<string, string> = {};
    (Object.keys(mapping) as ImportField[]).forEach((key) => {
      const value = mapping[key];
      if (value) mappingPayload[key] = value;
    });

    try {
      const res = await fetch("/api/import/csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records, mapping: mappingPayload }),
      });
      const data = (await res.json()) as {
        imported?: number;
        failed?: number;
        errors?: string[];
        error?: string;
      };

      if (!res.ok) {
        setImportError(data.error ?? "Import failed. Please try again.");
        setImporting(false);
        return;
      }

      setResult({ imported: data.imported ?? 0, failed: data.failed ?? 0, errors: data.errors ?? [] });
      setImporting(false);
    } catch {
      setImportError("Network error. Please try again.");
      setImporting(false);
    }
  }, [rows, headers, mapping]);

  const handleReset = useCallback(() => {
    setStep(1);
    setFileName("");
    setHeaders([]);
    setRows([]);
    setMapping({});
    setUploadError(null);
    setImportError(null);
    setResult(null);
  }, []);

  return (
    <div style={{ minHeight: "100vh", padding: 24 }}>
      <div style={{ maxWidth: 880, margin: "0 auto" }}>
        <div style={{ marginBottom: 24 }}>
          <Link
            href="/funders"
            style={{ fontSize: 14, color: COLORS.textMuted, textDecoration: "none" }}
          >
            &larr; Back to Funders
          </Link>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: COLORS.text,
              marginTop: 8,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <Upload size={22} color={COLORS.primary} aria-hidden />
            Import Funders from CSV
          </h1>
          <p style={{ fontSize: 14, color: COLORS.textMuted, marginTop: 4 }}>
            Upload a CSV, map its columns to funder fields, then import.
          </p>
        </div>

        <StepIndicator current={step} />

        {step === 1 && (
          <Card>
            <label style={{ display: "block", fontSize: 14, fontWeight: 600, color: COLORS.text, marginBottom: 8 }}>
              CSV file
            </label>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              style={{
                display: "block",
                width: "100%",
                fontSize: 14,
                color: COLORS.text,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 8,
                padding: 10,
                background: COLORS.sunken,
              }}
            />
            {uploadError && (
              <p style={{ marginTop: 12, fontSize: 13, color: COLORS.errorText }}>{uploadError}</p>
            )}

            {previewRows.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: COLORS.text, marginBottom: 8 }}>
                  Preview — first {previewRows.length} of {rows.length} row{rows.length !== 1 ? "s" : ""}
                </p>
                <div style={{ overflowX: "auto", border: `1px solid ${COLORS.border}`, borderRadius: 8 }}>
                  <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                    <thead style={{ background: COLORS.sunken }}>
                      <tr>
                        {headers.map((h) => (
                          <th
                            key={h}
                            style={{
                              padding: "8px 12px",
                              textAlign: "left",
                              fontSize: 11,
                              fontWeight: 700,
                              color: COLORS.textMuted,
                              textTransform: "uppercase",
                              letterSpacing: "0.03em",
                              whiteSpace: "nowrap",
                              borderBottom: `1px solid ${COLORS.border}`,
                            }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, i) => (
                        <tr key={i} style={{ borderTop: i === 0 ? "none" : `1px solid ${COLORS.border}` }}>
                          {headers.map((_, j) => (
                            <td
                              key={j}
                              style={{
                                padding: "8px 12px",
                                color: COLORS.text,
                                maxWidth: 220,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {row[j] ?? ""}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
                  <PrimaryButton onClick={() => setStep(2)}>Next: Map Columns</PrimaryButton>
                </div>
              </div>
            )}
          </Card>
        )}

        {step === 2 && (
          <Card>
            <p style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 4 }}>
              <span style={{ fontFamily: "monospace" }}>{fileName}</span> &middot; {rows.length} row
              {rows.length !== 1 ? "s" : ""}
            </p>

            <div style={{ marginTop: 16, marginBottom: 20 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 8 }}>
                Detected columns
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {headers.map((h) => (
                  <span
                    key={h}
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: COLORS.primary,
                      background: COLORS.sunken,
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: 9999,
                      padding: "3px 10px",
                    }}
                  >
                    {h}
                  </span>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {IMPORT_FIELDS.map((field) => (
                <div key={field.key} style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <label style={{ width: 110, flexShrink: 0, fontSize: 14, color: COLORS.text }}>
                    {field.label}
                    {field.required && <span style={{ marginLeft: 4, color: COLORS.errorText }}>*</span>}
                  </label>
                  <select
                    value={mapping[field.key] ?? ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      setMapping((prev) => {
                        const next = { ...prev };
                        if (val) next[field.key] = val;
                        else delete next[field.key];
                        return next;
                      });
                    }}
                    style={{
                      flex: 1,
                      background: COLORS.card,
                      border: `1px solid ${COLORS.border}`,
                      color: COLORS.text,
                      fontSize: 14,
                      borderRadius: 8,
                      padding: "8px 12px",
                    }}
                  >
                    <option value="">— not mapped —</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            {!canProceedFromMap && (
              <p style={{ marginTop: 16, fontSize: 13, color: COLORS.warningText }}>
                Map the required &ldquo;Name&rdquo; field to continue.
              </p>
            )}

            <div
              style={{
                marginTop: 24,
                paddingTop: 16,
                borderTop: `1px solid ${COLORS.border}`,
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <SecondaryButton onClick={() => setStep(1)}>Back</SecondaryButton>
              <PrimaryButton onClick={() => setStep(3)} disabled={!canProceedFromMap}>
                Next: Confirm &amp; Import
              </PrimaryButton>
            </div>
          </Card>
        )}

        {step === 3 && (
          <Card>
            {!result && (
              <>
                <p style={{ fontSize: 14, color: COLORS.text, marginBottom: 16 }}>
                  Ready to import <strong>{rows.length}</strong> record{rows.length !== 1 ? "s" : ""} into
                  Funders.
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
                  {IMPORT_FIELDS.filter((f) => mapping[f.key]).map((f) => (
                    <div key={f.key} style={{ fontSize: 13, color: COLORS.textMuted, display: "flex", gap: 6 }}>
                      <span style={{ fontWeight: 600, color: COLORS.text, width: 80, flexShrink: 0 }}>
                        {f.label}
                      </span>
                      <span>&rarr; {mapping[f.key]}</span>
                    </div>
                  ))}
                </div>

                {importError && (
                  <p style={{ marginTop: 12, fontSize: 13, color: COLORS.errorText }}>{importError}</p>
                )}

                <div
                  style={{
                    marginTop: 24,
                    paddingTop: 16,
                    borderTop: `1px solid ${COLORS.border}`,
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
                  <SecondaryButton onClick={() => setStep(2)} disabled={importing}>
                    Back
                  </SecondaryButton>
                  <PrimaryButton onClick={handleImport} disabled={importing}>
                    {importing ? "Importing…" : "Import"}
                  </PrimaryButton>
                </div>
              </>
            )}

            {result && (
              <>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 14,
                    fontWeight: 700,
                    color: COLORS.successText,
                    background: COLORS.successBg,
                    borderRadius: 8,
                    padding: "10px 14px",
                  }}
                >
                  <CheckCircle2 size={16} />
                  {result.imported} record{result.imported !== 1 ? "s" : ""} imported
                </div>

                {result.failed > 0 && (
                  <p style={{ marginTop: 12, fontSize: 13, color: COLORS.warningText }}>
                    {result.failed} record{result.failed !== 1 ? "s" : ""} failed (missing name or invalid row)
                  </p>
                )}

                {result.errors.length > 0 && (
                  <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 12, color: COLORS.textMuted }}>
                    {result.errors.slice(0, 10).map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                )}

                <div style={{ marginTop: 24, paddingTop: 16, borderTop: `1px solid ${COLORS.border}`, display: "flex", gap: 12 }}>
                  <Link
                    href="/funders"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      background: COLORS.primary,
                      color: "#FFFFFF",
                      borderRadius: 8,
                      padding: "10px 20px",
                      fontSize: 14,
                      fontWeight: 600,
                      textDecoration: "none",
                    }}
                  >
                    View Funders
                  </Link>
                  <SecondaryButton onClick={handleReset}>Import Another File</SecondaryButton>
                </div>
              </>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
