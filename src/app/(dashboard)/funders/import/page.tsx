"use client";

import { useState, useCallback, useRef } from "react";
import Link from "next/link";

import { Button } from "@/components/ui";

// ---- Types ----

type WizardStep = "upload" | "map" | "preview" | "importing" | "done";

type FunderFieldKey =
  | "name"
  | "category"
  | "description"
  | "website"
  | "giving_portal_url"
  | "annual_giving_budget"
  | "geographic_focus"
  | "notes";

interface FunderField {
  key: FunderFieldKey;
  label: string;
  required?: boolean;
  hint?: string;
}

interface ImportResult {
  imported: number;
  errors: string[];
}

// ---- Constants ----

const FUNDER_FIELDS: FunderField[] = [
  { key: "name", label: "Name", required: true },
  {
    key: "category",
    label: "Category",
    hint: "e.g. private_foundation, government_grant, corporate_donation",
  },
  { key: "description", label: "Description" },
  { key: "website", label: "Website" },
  { key: "giving_portal_url", label: "Giving Portal URL" },
  { key: "annual_giving_budget", label: "Annual Giving Budget" },
  { key: "geographic_focus", label: "Geographic Focus" },
  { key: "notes", label: "Notes" },
];

// ---- CSV Parser ----

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

// ---- Sub-components ----

function StepIndicator({ current }: { current: WizardStep }) {
  const steps: { id: WizardStep; label: string }[] = [
    { id: "upload", label: "Upload" },
    { id: "map", label: "Map Columns" },
    { id: "preview", label: "Preview" },
    { id: "done", label: "Done" },
  ];
  const activeIndex = steps.findIndex((s) => s.id === current || (current === "importing" && s.id === "preview"));
  return (
    <div className="flex items-center gap-2 mb-8">
      {steps.map((s, i) => (
        <div key={s.id} className="flex items-center gap-2">
          <div
            className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-semibold ${
              i < activeIndex
                ? "bg-blue-600 text-white"
                : i === activeIndex
                  ? "bg-blue-500 text-white"
                  : "bg-white-raised text-text-muted border border-border"
            }`}
          >
            {i < activeIndex ? (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              i + 1
            )}
          </div>
          <span
            className={`text-sm ${
              i === activeIndex ? "text-text" : i < activeIndex ? "text-text-muted" : "text-text-muted"
            }`}
          >
            {s.label}
          </span>
          {i < steps.length - 1 && <div className="w-8 h-px bg-border mx-1" />}
        </div>
      ))}
    </div>
  );
}

// ---- Page ----

export default function FundersImportPage() {
  const [step, setStep] = useState<WizardStep>("upload");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [allRows, setAllRows] = useState<string[][]>([]);
  const [previewRows, setPreviewRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Partial<Record<FunderFieldKey, string>>>({});
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    (file: File) => {
      setUploadError(null);
      if (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv") {
        setUploadError("Please upload a .csv file.");
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        setUploadError("File exceeds the 10 MB limit.");
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result;
        if (typeof text !== "string") {
          setUploadError("Could not read the file.");
          return;
        }
        const { headers: parsedHeaders, rows } = parseCSVText(text);
        if (parsedHeaders.length === 0) {
          setUploadError("No columns found. Ensure the file has a header row.");
          return;
        }

        // Auto-suggest mappings based on header similarity.
        const autoMap: Partial<Record<FunderFieldKey, string>> = {};
        for (const field of FUNDER_FIELDS) {
          const match = parsedHeaders.find((h) => {
            const norm = h.toLowerCase().replace(/[\s_-]+/g, "");
            const keyNorm = field.key.replace(/_/g, "");
            const labelNorm = field.label.toLowerCase().replace(/\s+/g, "");
            return norm === keyNorm || norm === labelNorm;
          });
          if (match) autoMap[field.key] = match;
        }

        setCsvFile(file);
        setHeaders(parsedHeaders);
        setAllRows(rows);
        setPreviewRows(rows.slice(0, 5));
        setMapping(autoMap);
        setUploadError(null);
        setStep("map");
      };
      reader.onerror = () => setUploadError("Could not read the file.");
      reader.readAsText(file);
    },
    [],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  const canProceedFromMap = FUNDER_FIELDS.filter((f) => f.required).every(
    (f) => mapping[f.key],
  );

  const handleImport = useCallback(async () => {
    if (!csvFile) return;
    setImportError(null);
    setStep("importing");
    try {
      const formData = new FormData();
      formData.append("file", csvFile);
      formData.append("mapping", JSON.stringify(mapping));
      const res = await fetch("/api/funders/import", {
        method: "POST",
        body: formData,
      });
      const data = (await res.json()) as {
        imported?: number;
        errors?: string[];
        error?: string;
      };
      if (!res.ok) {
        setImportError(data.error ?? "Import failed. Please try again.");
        setStep("preview");
        return;
      }
      setResult({
        imported: data.imported ?? 0,
        errors: data.errors ?? [],
      });
      setStep("done");
    } catch {
      setImportError("Network error. Please try again.");
      setStep("preview");
    }
  }, [csvFile, mapping]);

  const handleReset = useCallback(() => {
    setStep("upload");
    setCsvFile(null);
    setHeaders([]);
    setAllRows([]);
    setPreviewRows([]);
    setMapping({});
    setUploadError(null);
    setImportError(null);
    setResult(null);
  }, []);

  // ---- Step: Upload ----

  if (step === "upload") {
    return (
      <div className="max-w-2xl mx-auto py-8 px-4">
        <div className="mb-6">
          <Link href="/funders" className="text-sm text-text-muted hover:text-text transition-colors">
            &larr; Back to Funders
          </Link>
          <h1 className="text-2xl font-bold text-primary mt-2">Import Funders from CSV</h1>
          <p className="text-text-muted mt-1">
            Bulk-import funders by uploading a CSV file with a header row.
          </p>
        </div>
        <StepIndicator current="upload" />
        <div className="bg-surface border border-border rounded-lg p-6 shadow-sm">
          <div
            role="button"
            tabIndex={0}
            onDrop={handleDrop}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
            }}
            className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
              dragOver
                ? "border-blue-400 bg-blue-50"
                : "border-border hover:border-text-muted"
            }`}
          >
            <svg
              className="mx-auto h-10 w-10 text-text-muted mb-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            <p className="text-text font-medium">Drag &amp; drop a CSV file here</p>
            <p className="text-text-muted text-sm mt-1">or click to browse</p>
            <p className="text-text-muted text-xs mt-3">
              Max 10 MB &middot; UTF-8 encoding &middot; Must include a header row
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleFileInput}
          />
          {uploadError && (
            <p className="mt-3 text-sm text-red-400">{uploadError}</p>
          )}
          <div className="mt-5 border-t border-border pt-4">
            <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">
              Required columns
            </p>
            <p className="text-xs text-text-muted">
              <span className="text-text font-mono">name</span>
              {" "}(required)
            </p>
            <p className="text-xs text-text-muted mt-1">
              Optional:{" "}
              <span className="text-text-muted font-mono">
                category, description, website, giving_portal_url,
                annual_giving_budget, geographic_focus, notes
              </span>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ---- Step: Map ----

  if (step === "map") {
    return (
      <div className="max-w-2xl mx-auto py-8 px-4">
        <div className="mb-6">
          <button
            onClick={() => setStep("upload")}
            className="text-sm text-text-muted hover:text-text transition-colors"
          >
            &larr; Back
          </button>
          <h1 className="text-2xl font-bold text-primary mt-2">Map Columns</h1>
          <p className="text-text-muted mt-1">
            Match your CSV columns to funder fields.{" "}
            <span className="text-text-muted text-sm font-mono">{csvFile?.name}</span>
          </p>
        </div>
        <StepIndicator current="map" />
        <div className="bg-surface border border-border rounded-lg p-6 shadow-sm">
          <div className="space-y-5">
            {FUNDER_FIELDS.map((field) => (
              <div key={field.key} className="flex items-start gap-4">
                <div className="w-44 flex-shrink-0 pt-2">
                  <span className="text-sm text-text">
                    {field.label}
                    {field.required && (
                      <span className="ml-1 text-red-400 text-xs">*</span>
                    )}
                  </span>
                  {field.hint && (
                    <p className="text-xs text-text-muted mt-0.5 leading-snug">
                      {field.hint}
                    </p>
                  )}
                </div>
                <select
                  value={mapping[field.key] ?? ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    setMapping((prev) => {
                      const next = { ...prev };
                      if (val) {
                        next[field.key] = val;
                      } else {
                        delete next[field.key];
                      }
                      return next;
                    });
                  }}
                  className="flex-1 bg-white-raised border border-border text-text text-sm rounded-md px-3 py-2 focus:outline-none focus:border-blue-500 transition-colors"
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
            <p className="mt-4 text-sm text-yellow-400">
              Map the required &ldquo;Name&rdquo; column to continue.
            </p>
          )}
          <div className="mt-6 pt-5 border-t border-border flex items-center justify-between">
            <p className="text-xs text-text-muted">
              {headers.length} column{headers.length !== 1 ? "s" : ""} detected
              &middot; {allRows.length} data row{allRows.length !== 1 ? "s" : ""}
            </p>
            <button
              onClick={() => setStep("preview")}
              disabled={!canProceedFromMap}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Preview Import
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Step: Preview ----

  if (step === "preview") {
    const mappedFields = FUNDER_FIELDS.filter((f) => mapping[f.key]);
    return (
      <div className="max-w-5xl mx-auto py-8 px-4">
        <div className="mb-6">
          <button
            onClick={() => setStep("map")}
            className="text-sm text-text-muted hover:text-text transition-colors"
          >
            &larr; Back
          </button>
          <h1 className="text-2xl font-bold text-primary mt-2">Preview Import</h1>
          <p className="text-text-muted mt-1">
            First {previewRows.length} row{previewRows.length !== 1 ? "s" : ""} with
            mapping applied. All {allRows.length} rows will be imported.
          </p>
        </div>
        <StepIndicator current="preview" />
        {importError && (
          <div className="mb-4 p-3 bg-red-950/30 border border-red-800 rounded-lg text-red-300 text-sm">
            {importError}
          </div>
        )}
        <div className="bg-surface border border-border rounded-lg overflow-hidden mb-6 shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-sidebar">
                <tr>
                  {mappedFields.map((f) => (
                    <th
                      key={f.key}
                      className="px-4 py-3 text-left text-xs font-medium text-white uppercase tracking-wide whitespace-nowrap"
                    >
                      {f.label}
                      {f.required && <span className="text-red-400 ml-1">*</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {previewRows.map((row, rowIdx) => (
                  <tr key={rowIdx} className="hover:bg-white-raised transition-colors">
                    {mappedFields.map((f) => {
                      const col = mapping[f.key];
                      const idx = col !== undefined ? headers.indexOf(col) : -1;
                      const val = idx >= 0 ? (row[idx] ?? "") : "";
                      return (
                        <td
                          key={f.key}
                          className="px-4 py-2.5 text-text max-w-xs truncate"
                        >
                          {val || (
                            <span className="text-text-muted italic">empty</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={handleImport}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-500 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Import {allRows.length} Funder{allRows.length !== 1 ? "s" : ""}
          </button>
          <p className="text-xs text-text-muted">
            {allRows.length - previewRows.length > 0 &&
              `+${allRows.length - previewRows.length} more rows not shown`}
          </p>
        </div>
      </div>
    );
  }

  // ---- Step: Importing ----

  if (step === "importing") {
    return (
      <div className="max-w-2xl mx-auto py-24 px-4 text-center">
        <div
          className="h-10 w-10 rounded-full border-2 border-border border-t-blue-400 animate-spin mx-auto mb-5"
          aria-hidden="true"
        />
        <p className="text-text text-lg font-medium">Importing funders&hellip;</p>
        <p className="text-text-muted text-sm mt-2">This may take a moment.</p>
      </div>
    );
  }

  // ---- Step: Done ----

  if (step === "done" && result) {
    return (
      <div className="max-w-2xl mx-auto py-8 px-4">
        <h1 className="text-2xl font-bold text-primary mb-6">Import Complete</h1>
        <StepIndicator current="done" />
        <div className="bg-surface border border-border rounded-lg p-6 shadow-sm">
          <div className="flex items-start gap-4 mb-4">
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-green-950/60 border border-green-800 flex items-center justify-center">
              <svg
                className="w-5 h-5 text-green-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <div>
              <p className="text-text font-semibold text-lg">
                {result.imported} funder{result.imported !== 1 ? "s" : ""} imported
                successfully
              </p>
              {result.errors.length > 0 && (
                <p className="text-yellow-400 text-sm mt-0.5">
                  {result.errors.length} row{result.errors.length !== 1 ? "s" : ""}{" "}
                  skipped
                </p>
              )}
            </div>
          </div>
          {result.errors.length > 0 && (
            <div className="mt-4 border-t border-border pt-4">
              <p className="text-sm font-medium text-text-muted mb-2">Skipped rows</p>
              <ul className="space-y-1 max-h-48 overflow-auto pr-1">
                {result.errors.map((err, i) => (
                  <li key={i} className="text-xs text-red-400 font-mono">
                    {err}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-6 pt-5 border-t border-border flex gap-3">
            <Link
              href="/funders"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-500 transition-colors"
            >
              View Funders
            </Link>
            <Button onClick={handleReset} variant="secondary">
              Import Another File
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
