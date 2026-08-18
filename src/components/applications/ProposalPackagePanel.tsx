"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Calculator,
  CheckCircle2,
  Download,
  FileText,
  Layers,
  Package,
  XCircle,
} from "lucide-react";

import { Badge, Button, Card } from "@/components/ui";
import { formatCurrency } from "@/lib/utils/formatters";

// Mirrors src/app/api/proposals/generate-package/route.ts's response shape.
// Duplicated rather than imported (same convention AssemblyPanel already uses
// for /api/documents/assemble) - a route.ts file only exports HTTP method
// handlers by Next.js convention, so client components re-declare the shape
// they read rather than importing it.
type StepResult<T> =
  | { status: "success"; data: T }
  | { status: "failed"; error: string; code?: string };

interface NarrativeData {
  content: string;
  confidenceScore: number;
  belowThreshold: boolean;
}

interface BudgetData {
  total_requested: number | null;
  confidence_score: number;
  belowThreshold: boolean;
}

interface LogicModelData {
  logic_model: {
    inputs: string[];
    activities: string[];
    outputs: string[];
    outcomes: string[];
    impact: string[];
    templateBased: boolean;
  };
}

interface ChecklistEntry {
  document_name: string;
  status: "attached" | "missing";
  file_path: string | null;
}

interface AssemblyData {
  checklist: ChecklistEntry[];
  allPresent: boolean;
  downloadUrl: string | null;
}

interface GeneratePackageResponse {
  applicationId: string;
  applicationCreated: boolean;
  availablePrograms?: { id: string; name: string }[];
  steps: {
    narrative: StepResult<NarrativeData>;
    budget: StepResult<BudgetData>;
    logicModel: StepResult<LogicModelData>;
    documentAssembly: StepResult<AssemblyData>;
  };
  summary: { succeeded: number; failed: number; total: number };
}

export type ProposalPackagePanelProps = {
  opportunityId: string;
};

/**
 * One-Click Proposal Package (FEATURE_REGISTRY_v2.md row #116). Calls
 * /api/proposals/generate-package, which orchestrates Narrative, Budget, and
 * Logic Model (concurrently - none reads another's output) followed by
 * Document Assembly (last, since it needs the applications row + required
 * documents). Any step can fail independently; this panel always shows all 4
 * step outcomes rather than a single pass/fail state.
 */
export function ProposalPackagePanel({
  opportunityId,
}: ProposalPackagePanelProps) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GeneratePackageResponse | null>(null);
  const [selectedProgramId, setSelectedProgramId] = useState("");

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/proposals/generate-package", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          opportunityId,
          ...(selectedProgramId ? { programId: selectedProgramId } : {}),
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as
        | GeneratePackageResponse
        | { error?: string };
      if (!res.ok) {
        setError(
          "error" in payload && payload.error
            ? payload.error
            : "Could not generate the proposal package.",
        );
        return;
      }
      setResult(payload as GeneratePackageResponse);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setGenerating(false);
    }
  }

  const draftGeneratorHref = `/draft-generator?opportunity=${opportunityId}`;

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-navy-800">
              One-Click Proposal Package
            </h3>
            <p className="mt-0.5 text-sm text-navy-500">
              Generates a narrative draft, budget, and logic model, then checks
              required documents - each step reports its own success or
              failure.
            </p>
          </div>
          <Button onClick={handleGenerate} isLoading={generating}>
            <Layers className="h-4 w-4" aria-hidden />
            {result ? "Regenerate Full Package" : "Generate Full Package"}
          </Button>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        {result?.availablePrograms && result.availablePrograms.length > 1 && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            <p>
              Multiple programs exist for your organization - the Budget step
              needs to know which one to target.
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <select
                value={selectedProgramId}
                onChange={(e) => setSelectedProgramId(e.target.value)}
                className="block rounded-lg border border-navy-200 bg-surface px-3 py-1.5 text-sm text-navy-900 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
              >
                <option value="">Select a program…</option>
                {result.availablePrograms.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <Button
                variant="secondary"
                onClick={handleGenerate}
                isLoading={generating}
                disabled={!selectedProgramId}
              >
                Regenerate with this program
              </Button>
            </div>
          </div>
        )}

        {result && (
          <p className="mt-4 text-xs text-navy-500">
            {result.summary.succeeded} of {result.summary.total} steps
            succeeded.
            {result.applicationCreated &&
              " A new application was created for this opportunity."}
          </p>
        )}
      </Card>

      {result && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <StepCard
            icon={FileText}
            title="Narrative Draft"
            step={result.steps.narrative}
            renderSuccess={(data: NarrativeData) => (
              <>
                <p className="text-sm text-navy-700">
                  Confidence score:{" "}
                  <span className="font-semibold">
                    {data.confidenceScore}/100
                  </span>
                  {data.belowThreshold && (
                    <Badge variant="warning" className="ml-2">
                      Below threshold
                    </Badge>
                  )}
                </p>
                <Link
                  href={draftGeneratorHref}
                  className="mt-2 inline-block text-sm text-teal-600 hover:text-teal-700"
                >
                  View draft in Draft Generator →
                </Link>
              </>
            )}
          />

          <StepCard
            icon={Calculator}
            title="Budget"
            step={result.steps.budget}
            renderSuccess={(data: BudgetData) => (
              <>
                <p className="text-sm text-navy-700">
                  Total requested:{" "}
                  <span className="font-semibold">
                    {formatCurrency(data.total_requested)}
                  </span>
                </p>
                <p className="mt-1 text-sm text-navy-700">
                  Confidence score:{" "}
                  <span className="font-semibold">
                    {data.confidence_score}/100
                  </span>
                  {data.belowThreshold && (
                    <Badge variant="warning" className="ml-2">
                      Below threshold
                    </Badge>
                  )}
                </p>
                <Link
                  href={draftGeneratorHref}
                  className="mt-2 inline-block text-sm text-teal-600 hover:text-teal-700"
                >
                  View budget in Draft Generator →
                </Link>
              </>
            )}
          />

          <StepCard
            icon={Layers}
            title="Logic Model"
            step={result.steps.logicModel}
            renderSuccess={(data: LogicModelData) => {
              const lm = data.logic_model;
              const total =
                lm.inputs.length +
                lm.activities.length +
                lm.outputs.length +
                lm.outcomes.length +
                lm.impact.length;
              return (
                <>
                  <p className="text-sm text-navy-700">
                    <span className="font-semibold">{total}</span> logic model
                    items generated across inputs, activities, outputs,
                    outcomes, and impact.
                  </p>
                  <Link
                    href={draftGeneratorHref}
                    className="mt-2 inline-block text-sm text-teal-600 hover:text-teal-700"
                  >
                    View logic model in Draft Generator →
                  </Link>
                </>
              );
            }}
          />

          <StepCard
            icon={Package}
            title="Document Checklist"
            step={result.steps.documentAssembly}
            renderSuccess={(data: AssemblyData) => {
              const missing = data.checklist.filter(
                (c) => c.status === "missing",
              ).length;
              return (
                <>
                  <p className="text-sm text-navy-700">
                    {data.allPresent
                      ? "All required documents attached."
                      : `${missing} required document${missing === 1 ? "" : "s"} missing.`}
                  </p>
                  {data.downloadUrl ? (
                    <a
                      href={data.downloadUrl}
                      download
                      className="mt-2 inline-flex items-center gap-1.5 text-sm text-teal-600 hover:text-teal-700"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden />
                      Download package
                    </a>
                  ) : (
                    <p className="mt-2 text-xs text-navy-500">
                      Attach the missing documents, then use the Assembly tab
                      to build the download package.
                    </p>
                  )}
                </>
              );
            }}
          />
        </div>
      )}
    </div>
  );
}

function StepCard<T>({
  icon: Icon,
  title,
  step,
  renderSuccess,
}: {
  icon: typeof FileText;
  title: string;
  step: StepResult<T>;
  renderSuccess: (data: T) => React.ReactNode;
}) {
  const succeeded = step.status === "success";
  return (
    <Card>
      <div className="flex items-start gap-3">
        <div
          className={
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full " +
            (succeeded ? "bg-success-bg" : "bg-red-50")
          }
        >
          <Icon
            className={
              "h-4 w-4 " + (succeeded ? "text-success-text" : "text-red-500")
            }
            aria-hidden
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-navy-800">{title}</h4>
            {succeeded ? (
              <CheckCircle2
                className="h-4 w-4 text-success-text"
                aria-label="Succeeded"
              />
            ) : (
              <XCircle className="h-4 w-4 text-red-500" aria-label="Failed" />
            )}
          </div>
          {succeeded ? (
            renderSuccess(step.data)
          ) : (
            <p className="mt-1 text-sm text-red-700">{step.error}</p>
          )}
        </div>
      </div>
    </Card>
  );
}
