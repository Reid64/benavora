"use client";

import { useState } from "react";
import { CheckCircle2, FileText } from "lucide-react";

import { DocumentUploader } from "@/components/documents/DocumentUploader";

export type DocumentsStepProps = {
  organizationId: string;
  uploadedBy: string;
  /** Documents already on file (returning user). */
  initialCount: number;
  /** Called after each successful upload so the wizard can mark the step done. */
  onUploaded: () => void;
};

/**
 * Step 3 - stage the documents grant applications ask for most. Reuses the same
 * DocumentUploader as the Documents page (BLUEPRINT §4.6), so files land in the
 * org's Storage bucket through the session-bound client with Storage RLS
 * enforcing tenant isolation. The step is optional - users can upload later.
 */
export function DocumentsStep({
  organizationId,
  uploadedBy,
  initialCount,
  onUploaded,
}: DocumentsStepProps) {
  const [count, setCount] = useState(initialCount);

  function handleUploaded() {
    setCount((c) => c + 1);
    onUploaded();
  }

  const suggestions = [
    {
      title: "501(c)(3) determination letter",
      hint: "Category: Tax documents",
    },
    { title: "W-9", hint: "Category: Financial documents" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2">
        {suggestions.map((s) => (
          <div
            key={s.title}
            className="flex items-start gap-3 rounded-xl border border-navy-100 bg-white p-4 shadow-card"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-plum-50 text-plum-600">
              <FileText className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <p className="text-sm font-medium text-navy-900">{s.title}</p>
              <p className="mt-0.5 text-xs text-navy-500">{s.hint}</p>
            </div>
          </div>
        ))}
      </div>

      {count > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
          <span>
            {count} document{count === 1 ? "" : "s"} on file. Add more or
            continue - you can always upload the rest later.
          </span>
        </div>
      )}

      <DocumentUploader
        organizationId={organizationId}
        uploadedBy={uploadedBy}
        onUploaded={handleUploaded}
      />
    </div>
  );
}
