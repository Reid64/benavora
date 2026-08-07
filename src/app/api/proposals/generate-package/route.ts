// POST /api/proposals/generate-package - One-Click Proposal Package
// (FEATURE_REGISTRY_v2.md row #116).
//
// Orchestrates the 4 real, independently-BUILT generators (rows #112-115) into
// a single call. Per the q33 preflight (STATE_OF_THE_BUILD.md, "q33 preflight"
// session), the 4 generators are NOT uniform:
//   - Narrative (#112, /api/ai/draft) and Budget (#113, /api/ai/budget) and
//     Logic Model (#114, /api/intelligence/logic-model) never read each
//     other's output - they're independent reads, so they run concurrently.
//   - Document Assembly (#115, /api/documents/assemble) hard-requires an
//     existing `applications` row and is the only step that packages already-
//     uploaded files rather than generating new content, so it always runs
//     last, after an application is guaranteed to exist.
//
// Each of the 4 real routes keeps its own auth/tier-gate/rate-limit logic
// (checkTierGate, enforceLimit, withUsageCheck, requireRole, etc.) - this
// route does not reimplement or bypass any of that. It imports each route's
// real POST handler and invokes it directly with a constructed Request, the
// same request-handling path the route already uses when called over HTTP.
// This is a same-process, in-request call (no network round trip); `cookies()`
// inside each handler still resolves correctly because it reads from the
// Next.js per-request context, not from the Request object passed in.
//
// Partial-failure handling is the point of this endpoint: any of the 4 calls
// can fail independently (AI 502, tier-gate 429, an unresolved precondition
// like no programId), and the response always reports per-step
// status/data/error rather than a single opaque failure. HTTP status is 200
// whenever the top-level preconditions (opportunity found, application
// ensured) succeed, even if every one of the 4 steps failed - the caller
// reads `steps[key].status` to know what happened.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { VALID_TEMPLATE_TYPES } from "@/lib/drafts/generator";
import type { DraftTemplateType } from "@/types/ai";

import { POST as generateDraftHandler } from "@/app/api/ai/draft/route";
import { POST as generateBudgetHandler } from "@/app/api/ai/budget/route";
import { POST as generateLogicModelHandler } from "@/app/api/intelligence/logic-model/route";
import { POST as assembleDocumentsHandler } from "@/app/api/documents/assemble/route";

export const runtime = "nodejs";
// Narrative and Budget alone can each take up to ~180s (see their own route
// comments); running them concurrently doesn't add their durations, but
// Document Assembly still runs afterward, so the total ceiling needs headroom
// beyond a single generator's own 300s.
export const maxDuration = 300;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export type PackageStepResult<T = unknown> =
  | { status: "success"; data: T }
  | { status: "failed"; error: string; code?: string };

export interface GeneratePackageResponse {
  applicationId: string;
  applicationCreated: boolean;
  /** Present only when Budget could not auto-resolve a single program. */
  availablePrograms?: { id: string; name: string }[];
  steps: {
    narrative: PackageStepResult;
    budget: PackageStepResult;
    logicModel: PackageStepResult;
    documentAssembly: PackageStepResult;
  };
  summary: { succeeded: number; failed: number; total: number };
}

/**
 * Invokes a sibling route's real POST handler in-process, the same
 * request-handling path it uses over HTTP (auth, tier gates, rate limits,
 * agent_runs logging all still run). Never throws - failures become a
 * `PackageStepResult` so one step's failure never aborts the others.
 */
async function callInternalRoute<T>(
  handler: (request: Request) => Promise<Response>,
  body: unknown,
): Promise<PackageStepResult<T>> {
  try {
    const request = new Request("http://internal.benavora/proposal-package-step", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const response = await handler(request);
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok) {
      return {
        status: "failed",
        error:
          typeof payload.error === "string"
            ? payload.error
            : `Step failed with status ${response.status}.`,
        code: typeof payload.code === "string" ? payload.code : undefined,
      };
    }
    return { status: "success", data: payload as T };
  } catch (err) {
    return {
      status: "failed",
      error: err instanceof Error ? err.message : "Unexpected error.",
    };
  }
}

function failedStep(error: string, code: string): PackageStepResult {
  return { status: "failed", error, code };
}

export async function POST(request: Request) {
  // Ensures an application row, resolves a program, and calls 3 AI
  // generators - a write action (Contracts §16).
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const {
    opportunityId,
    templateType,
    programId: requestedProgramId,
  } = (body ?? {}) as {
    opportunityId?: unknown;
    templateType?: unknown;
    programId?: unknown;
  };

  if (typeof opportunityId !== "string" || opportunityId.trim() === "") {
    return jsonError("opportunityId is required.", "invalid_input", 400);
  }

  const template: DraftTemplateType =
    typeof templateType === "string" &&
    VALID_TEMPLATE_TYPES.includes(templateType as DraftTemplateType)
      ? (templateType as DraftTemplateType)
      : "grant_narrative";

  // Opportunity, RLS-scoped (org filter is also explicit, matching the
  // convention in /api/applications/[id]/clone).
  const { data: opportunity, error: oppError } = await supabase
    .from("opportunities")
    .select("id, category, required_documents")
    .eq("id", opportunityId)
    .eq("organization_id", organizationId)
    .single();
  if (oppError || !opportunity) {
    return jsonError("Opportunity not found.", "not_found", 404);
  }

  // --- Step 0: ensure an `applications` row exists -------------------------
  // Per the q33 preflight: Narrative/Budget/Logic Model don't need one, but
  // Document Assembly hard-requires it, and Narrative's own best-effort
  // mirror-onto-application write silently no-ops without one. Ensuring it
  // exists up front (rather than only before Document Assembly) means that
  // mirror write also succeeds.
  let applicationId: string;
  let applicationCreated = false;
  {
    const { data: existing } = await supabase
      .from("applications")
      .select("id")
      .eq("opportunity_id", opportunityId)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      applicationId = existing.id as string;
    } else {
      const { data: created, error: createError } = await supabase
        .from("applications")
        .insert({
          organization_id: organizationId,
          opportunity_id: opportunityId,
          stage: "drafting",
        })
        .select("id")
        .single();
      if (createError || !created) {
        return jsonError(
          "Could not create an application for this opportunity.",
          "application_create_failed",
          500,
        );
      }
      applicationId = created.id as string;
      applicationCreated = true;
    }
  }

  // --- Resolve programId for Budget -----------------------------------------
  // No FK from opportunities/applications to programs (q33 preflight) - only
  // auto-resolve when unambiguous. Never guess when there's more than one.
  let resolvedProgramId: string | null =
    typeof requestedProgramId === "string" && requestedProgramId.trim() !== ""
      ? requestedProgramId.trim()
      : null;
  let programResolutionError: string | null = null;
  let availablePrograms: { id: string; name: string }[] = [];

  if (!resolvedProgramId) {
    const { data: programs } = await supabase
      .from("programs")
      .select("id, name")
      .eq("organization_id", organizationId);
    availablePrograms = (programs ?? []) as { id: string; name: string }[];

    if (availablePrograms.length === 1) {
      resolvedProgramId = availablePrograms[0]!.id;
    } else if (availablePrograms.length === 0) {
      programResolutionError =
        "No programs are configured for this organization. Add a program in Organization Settings, then retry.";
    } else {
      programResolutionError = `${availablePrograms.length} programs exist for this organization - pass a programId to select which one the budget should target.`;
    }
  }

  // --- Resolve program description/geography for Logic Model ---------------
  // Sourced from the org's Knowledge-Base-derived Digital Twin (q33 preflight)
  // rather than asking the user to retype it - never fabricated if absent.
  let programDescription: string | null = null;
  let geography: string | null = null;
  {
    const { data: twin } = await supabase
      .from("organizational_digital_twins")
      .select("programs, service_areas")
      .eq("organization_id", organizationId)
      .maybeSingle();

    const twinPrograms = (twin?.programs ?? []) as {
      title?: string;
      description?: string;
    }[];
    const firstDescribed = twinPrograms.find(
      (p) => typeof p.description === "string" && p.description.trim() !== "",
    );
    programDescription = firstDescribed?.description ?? null;

    const serviceAreas = (twin?.service_areas ?? []) as string[];
    geography = serviceAreas.length > 0 ? serviceAreas.join(", ") : null;
  }
  const logicModelInputError =
    "No program description found in the Knowledge Base (category: program_description) or Digital Twin. Add one on the Knowledge Base page, then retry.";

  // --- Steps 1-3: Narrative, Budget, Logic Model, concurrently -------------
  // Confirmed independent reads (q33 preflight): Budget reads `programs` +
  // opportunity + KB budget_justification entries; Logic Model reads only
  // `organizations.name`; neither reads anything Narrative writes.
  const [narrativeResult, budgetResult, logicModelResult] = await Promise.all([
    callInternalRoute(generateDraftHandler, {
      opportunityId,
      templateType: template,
    }),
    resolvedProgramId
      ? callInternalRoute(generateBudgetHandler, {
          opportunityId,
          programId: resolvedProgramId,
        })
      : Promise.resolve(
          failedStep(programResolutionError!, "program_not_resolved"),
        ),
    programDescription
      ? callInternalRoute(generateLogicModelHandler, {
          category: opportunity.category,
          program_description: programDescription,
          organization_id: organizationId,
          geography: geography ?? undefined,
          save_to_library: false,
        })
      : Promise.resolve(
          failedStep(logicModelInputError, "program_description_missing"),
        ),
  ]);

  // --- Step 4: Document Assembly, last --------------------------------------
  // Needs the applications row (guaranteed above) and reads
  // opportunity.required_documents; its checklist is the "what's left" view
  // once the 3 generated pieces exist, so it runs after them, not alongside.
  const assemblyResult = await callInternalRoute(assembleDocumentsHandler, {
    application_id: applicationId,
  });

  const steps: GeneratePackageResponse["steps"] = {
    narrative: narrativeResult,
    budget: budgetResult,
    logicModel: logicModelResult,
    documentAssembly: assemblyResult,
  };

  const succeeded = Object.values(steps).filter(
    (s) => s.status === "success",
  ).length;

  const result: GeneratePackageResponse = {
    applicationId,
    applicationCreated,
    ...(availablePrograms.length > 1 ? { availablePrograms } : {}),
    steps,
    summary: { succeeded, failed: 4 - succeeded, total: 4 },
  };

  return NextResponse.json(result);
}
