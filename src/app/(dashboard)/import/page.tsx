"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { Button, Card } from "@/components/ui";

// 3-step CSV import wizard for bulk-loading funders.
//   1. Upload — parse the file client-side, preview the first 5 rows.
//   2. Map — match CSV columns to funders fields via dropdowns.
//   3. Import — POST the mapped rows to /api/import/csv, show the result.

type ImportField = "name" | "email" | "website" | "category" | "phone" | "state" | "notes";

const IMPORT_FIELDS: { key: ImportField; label: string; required?: boolean }[] = [
  { key: "name", label: "Name", required: true },
  { key: "category", label: "Category" },
  { key: "website", label: "Website" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "state", label: "State" },
  { key: "notes", label: "Notes" },
];

interface ImportResult {
  imported: number;
  failed: number;
}

function parseCSVText(text: string): { headers: string[]; rows: string[][] } {
  const result: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i] ?? "";
    if (ch === '"') {
      if (inQuotes && src[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      row.push(field);
      field = "";
    } else if (ch === "\n" && !inQuotes) {
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) result.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field || row.length > 0) {
    row.push(field);
    if (row.some((c) => c.trim() !== "")) result.push(row);
  }

  const headers = (result[0] ?? []).map((h) => h.trim());
  const rows = result.slice(1);
  return { headers, rows };
}

function StepIndicator({ current }: { current: 1 | 2 | 3 }) {
  const steps = [
    { n: 1, label: "Upload" },
    { n: 2, label: "Map Columns" },
    { n: 3, label: "Import" },
  ] as const;
  return (
    <div className="flex items-center gap-2 mb-6">
      {steps.map((s, i) => (
        <div key={s.n} className="flex items-center gap-2">
          <div
            className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-semibold ${
              s.n < current
                ? "bg-blue-600 text-white"
                : s.n === current
                  ? "bg-blue-500 text-white"
                  : "bg-surface-raised text-text-muted border border-border"
            }`}
          >
            {s.n < current ? (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              s.n
            )}
          </div>
          <span className={`text-sm ${s.n === current ? "text-text" : "text-text-muted"}`}>{s.label}</span>
          {i < steps.length - 1 && <div className="w-8 h-px bg-border mx-1" />}
        </div>
      ))}
    </div>
  );
}

export default function ImportPage() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [fileName, setFileName] = useState<string>("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [allRows, setAllRows] = useState<string[][]>([]);
  const [previewRows, setPreviewRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Partial<Record<ImportField, string>>>({});
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setUploadError("Please upload a .csv file.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text !== "string") {
        setUploadError("Could not read the file.");
        return;
      }
      const { headers: parsedHeaders, rows } = parseCSVText(text);
      if (parsedHeaders.length === 0) {
        setUploadError("No columns found. Ensure the file has a header row.");
        return;
      }

      const autoMap: Partial<Record<ImportField, string>> = {};
      for (const field of IMPORT_FIELDS) {
        const match = parsedHeaders.find((h) => h.toLowerCase().replace(/[\s_-]+/g, "") === field.key);
        if (match) autoMap[field.key] = match;
      }

      setFileName(file.name);
      setHeaders(parsedHeaders);
      setAllRows(rows);
      setPreviewRows(rows.slice(0, 5));
      setMapping(autoMap);
    };
    reader.onerror = () => setUploadError("Could not read the file.");
    reader.readAsText(file);
  }, []);

  const canProceedFromMap = useMemo(
    () => IMPORT_FIELDS.filter((f) => f.required).every((f) => mapping[f.key]),
    [mapping],
  );

  const handleImport = useCallback(async () => {
    setImportError(null);
    setImporting(true);
    try {
      const mappedRows = allRows.map((row) => {
        const record: Record<string, string> = {};
        for (const field of IMPORT_FIELDS) {
          const col = mapping[field.key];
          const idx = col ? headers.indexOf(col) : -1;
          if (idx >= 0) record[field.key] = (row[idx] ?? "").trim();
        }
        return record;
      });

      const res = await fetch("/api/import/csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mappedRows),
      });
      const data = (await res.json()) as { imported?: number; failed?: number; error?: string };
      if (!res.ok) {
        setImportError(data.error ?? "Import failed. Please try again.");
        setImporting(false);
        return;
      }
      setResult({ imported: data.imported ?? 0, failed: data.failed ?? 0 });
      setImporting(false);
    } catch {
      setImportError("Network error. Please try again.");
      setImporting(false);
    }
  }, [allRows, headers, mapping]);

  const handleReset = useCallback(() => {
    setStep(1);
    setFileName("");
    setHeaders([]);
    setAllRows([]);
    setPreviewRows([]);
    setMapping({});
    setUploadError(null);
    setImportError(null);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="mb-6">
        <Link href="/funders" className="text-sm text-text-muted hover:text-text transition-colors">
          &larr; Back to Funders
        </Link>
        <h1 className="text-2xl font-bold text-primary mt-2">Import Funders from CSV</h1>
        <p className="text-text-muted mt-1">Upload a CSV, map its columns, then import.</p>
      </div>

      <StepIndicator current={step} />

      {step === 1 && (
        <Card>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileInput}
            className="block w-full text-sm text-text file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-600 file:text-white hover:file:bg-blue-500 file:cursor-pointer"
          />
          {uploadError && <p className="mt-3 text-sm text-red-400">{uploadError}</p>}

          {previewRows.length > 0 && (
            <div className="mt-6">
              <p className="text-sm font-medium text-text mb-2">
                Preview — first {previewRows.length} of {allRows.length} rows
              </p>
              <div className="overflow-x-auto border border-border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-sidebar">
                    <tr>
                      {headers.map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-xs font-medium text-white uppercase whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {previewRows.map((row, i) => (
                      <tr key={i}>
                        {row.map((cell, j) => (
                          <td key={j} className="px-3 py-2 text-text max-w-xs truncate">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex justify-end">
                <Button onClick={() => setStep(2)}>Next: Map Columns</Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {step === 2 && (
        <Card>
          <p className="text-text-muted text-sm mb-4">
            <span className="font-mono">{fileName}</span> &middot; {allRows.length} rows
          </p>
          <div className="space-y-4">
            {IMPORT_FIELDS.map((field) => (
              <div key={field.key} className="flex items-center gap-4">
                <label className="w-32 flex-shrink-0 text-sm text-text">
                  {field.label}
                  {field.required && <span className="ml-1 text-red-400">*</span>}
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
                  className="flex-1 bg-surface-raised border border-border text-text text-sm rounded-md px-3 py-2 focus:outline-none focus:border-blue-500"
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
            <p className="mt-4 text-sm text-yellow-400">Map the required &ldquo;Name&rdquo; column to continue.</p>
          )}
          <div className="mt-6 pt-4 border-t border-border flex justify-between">
            <Button variant="secondary" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button onClick={() => setStep(3)} disabled={!canProceedFromMap}>
              Next: Import
            </Button>
          </div>
        </Card>
      )}

      {step === 3 && (
        <Card>
          {!result && (
            <>
              <p className="text-text mb-1">
                Ready to import <span className="font-semibold">{allRows.length}</span> row
                {allRows.length !== 1 ? "s" : ""} into Funders.
              </p>
              {importError && <p className="mt-3 text-sm text-red-400">{importError}</p>}
              <div className="mt-6 pt-4 border-t border-border flex justify-between">
                <Button variant="secondary" onClick={() => setStep(2)} disabled={importing}>
                  Back
                </Button>
                <Button onClick={handleImport} disabled={importing}>
                  {importing ? "Importing…" : "Import"}
                </Button>
              </div>
            </>
          )}

          {result && (
            <>
              <p className="text-text font-semibold text-lg">
                {result.imported} row{result.imported !== 1 ? "s" : ""} imported
              </p>
              {result.failed > 0 && (
                <p className="text-yellow-400 text-sm mt-1">
                  {result.failed} row{result.failed !== 1 ? "s" : ""} failed (missing name)
                </p>
              )}
              <div className="mt-6 pt-4 border-t border-border flex gap-3">
                <Link
                  href="/funders"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-500 transition-colors"
                >
                  View Funders
                </Link>
                <Button variant="secondary" onClick={handleReset}>
                  Import Another File
                </Button>
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
