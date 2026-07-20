// AG-07 Compliance Check Agent (AutonomousAgent version) - deterministic,
// no AI. Fired via agent_queue with agent_id "ag-07-compliance-check" and
// input_payload { applicationId: string } (migration 080 infrastructure:
// agent_runs, agent_decisions, agent_queue).
//
// Distinct from the existing src/lib/agents/compliance-checker.ts
// (ComplianceChecker, BaseAgent pattern): that agent does fuzzy
// token-matching against document file_name/description/category plus an
// advisory Claude content review, and returns its ComplianceResult as this
// call's return value only. This agent is the simpler queue-driven
// AutonomousAgent version scoped exactly as given in this build's task
// prompt: match required_documents to attached documents by `category`
// alone (no fuzzy text matching, no AI review).
//
// Deviation from the task-given spec, checked against real schema rather
// than applied literally: `applications` has no `confidence_score` column -
// the real field is `draft_confidence_score`.
//
// Note on compliance_check_result: src/types/database.ts's generated
// applications type did NOT list this column, but migration 080
// (supabase/migrations/080_autonomous_agent_infrastructure.sql line 104)
// adds `compliance_check_result jsonb DEFAULT '{}'`, and a leftover
// migrate-autonomous.json scratch file from an earlier session confirms
// that exact ALTER TABLE was already applied to production via the
// Management API. The generated types were simply stale (also missing
// auto_generated, pending_review, draft_source, budget_data, fit_analysis
// from the same migration) - fixed in database.ts alongside this agent
// rather than routed around.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule" | "event";

interface CompliancePayload {
  applicationId: string;
}

interface ApplicationRow {
  id: string;
  organization_id: string;
  opportunity_id: string;
  draft_content: string | null;
  draft_confidence_score: number | null;
}

interface OpportunityRow {
  name: string | null;
  required_documents: string[] | null;
}

export interface ComplianceCheckResult {
  passed: boolean;
  missingDocuments: string[];
  needsInputCount: number;
  checkedAt: string;
}

export class ComplianceCheckAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-07-compliance-check", supabase);
  }

  /**
   * Reads the agent_queue row the worker marked "processing" for this
   * org/agent this run - AutonomousAgent has no queue-item id passed into
   * run(), so the currently-processing row is the only way to recover the
   * event payload (mirrors FollowupGeneratorAgent.loadTriggerPayload).
   */
  private async loadPayload(): Promise<CompliancePayload | null> {
    const { data: queueRow } = await this.supabase
      .from("agent_queue")
      .select("input_payload")
      .eq("org_id", this.orgId)
      .eq("agent_id", this.agentId)
      .eq("status", "processing")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const payload = (queueRow?.input_payload ?? {}) as Partial<CompliancePayload>;
    if (typeof payload.applicationId !== "string") return null;
    return { applicationId: payload.applicationId };
  }

  override async run(
    triggerSource: TriggerSource,
  ): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource);
    const errors: string[] = [];
    const decisions: string[] = [];

    try {
      const payload = await this.loadPayload();
      if (!payload) {
        await this.completeRun(runId, {
          outputSummary: "No valid compliance check payload found on the currently processing queue item.",
          itemsFound: 0,
          itemsProcessed: 0,
        });
        return {
          success: true,
          itemsFound: 0,
          itemsProcessed: 0,
          itemsQueued: 0,
          decisions,
          nextActions: [],
          errors,
        };
      }

      const { applicationId } = payload;

      const { data: appRow, error: appError } = await this.supabase
        .from("applications")
        .select("id, organization_id, opportunity_id, draft_content, draft_confidence_score")
        .eq("id", applicationId)
        .eq("organization_id", this.orgId)
        .maybeSingle();

      if (appError) {
        throw new Error(`Failed to load application: ${appError.message}`);
      }
      if (!appRow) {
        throw new Error(`Application ${applicationId} not found.`);
      }
      const application = appRow as ApplicationRow;

      const { data: oppRow, error: oppError } = await this.supabase
        .from("opportunities")
        .select("name, required_documents")
        .eq("id", application.opportunity_id)
        .eq("organization_id", this.orgId)
        .maybeSingle();

      if (oppError) {
        throw new Error(`Failed to load opportunity: ${oppError.message}`);
      }
      const opportunity = (oppRow ?? { name: null, required_documents: null }) as OpportunityRow;
      const opportunityName = opportunity.name ?? "this opportunity";

      const { data: linkRows, error: linkError } = await this.supabase
        .from("application_documents")
        .select("document_id")
        .eq("application_id", applicationId);

      if (linkError) {
        throw new Error(`Failed to load attached documents: ${linkError.message}`);
      }

      const documentIds = (linkRows ?? []).map((r) => r.document_id as string);
      let attachedCategories = new Set<string>();
      if (documentIds.length > 0) {
        const { data: docRows, error: docError } = await this.supabase
          .from("documents")
          .select("category")
          .eq("organization_id", this.orgId)
          .in("id", documentIds);

        if (docError) {
          throw new Error(`Failed to load document categories: ${docError.message}`);
        }
        attachedCategories = new Set(
          (docRows ?? []).map((d) => (d.category as string).toLowerCase().trim()),
        );
      }

      const requiredDocuments = (opportunity.required_documents ?? []).filter(
        (d) => typeof d === "string" && d.trim() !== "",
      );
      const missingDocuments = requiredDocuments.filter(
        (d) => !attachedCategories.has(d.toLowerCase().trim()),
      );

      const draftContent = application.draft_content ?? "";
      const needsInputCount = (draftContent.match(/\[NEEDS INPUT/gi) ?? []).length;
      const confidenceScore = application.draft_confidence_score ?? 100;

      const blockers: string[] = [
        ...missingDocuments.map((d) => `Missing: ${d}`),
        ...(needsInputCount > 0
          ? [`Draft has ${needsInputCount} unresolved [NEEDS INPUT] flags`]
          : []),
        ...(confidenceScore < 70
          ? ["Draft confidence score below 70% -- review required"]
          : []),
      ];

      const passed = blockers.length === 0;

      const result: ComplianceCheckResult = {
        passed,
        missingDocuments,
        needsInputCount,
        checkedAt: new Date().toISOString(),
      };

      const { error: updateError } = await this.supabase
        .from("applications")
        .update({ compliance_check_result: result })
        .eq("id", applicationId)
        .eq("organization_id", this.orgId);

      if (updateError) {
        throw new Error(
          `Failed to persist compliance_check_result: ${updateError.message}`,
        );
      }

      decisions.push(
        await this.logDecision({
          decisionType: passed ? "compliance_passed" : "compliance_blocked",
          agentRunId: runId,
          entityType: "application",
          entityId: applicationId,
          reasoning: passed
            ? `Application ${applicationId} for "${opportunityName}" passed every automated compliance check: all ${requiredDocuments.length} required document categor${requiredDocuments.length === 1 ? "y is" : "ies are"} attached, the draft narrative has no unresolved [NEEDS INPUT] flags, and the draft confidence score (${confidenceScore}%) is at or above the 70% review threshold. ` +
              "This check is deterministic - it matches attached document categories against the opportunity's required_documents list and scans the draft narrative text - and does not itself submit or advance the application; it only clears it for the next stage."
            : `Application ${applicationId} for "${opportunityName}" was blocked by automated compliance check(s): ${blockers.join("; ")}. ` +
              `Of ${requiredDocuments.length} required document categor${requiredDocuments.length === 1 ? "y" : "ies"}, ${missingDocuments.length} ${missingDocuments.length === 1 ? "is" : "are"} still missing, and the draft narrative was scanned for unresolved [NEEDS INPUT: ...] placeholders and a draft confidence score below 70%. ` +
              "This is a deterministic gate, not an AI judgment call - it flags the application for human review rather than allowing it to advance until every blocker above is resolved.",
          confidenceScore: passed ? 95 : 30,
          actionTaken: passed ? "compliance_cleared" : "compliance_blocked",
          actionPayload: { ...result },
          requiredHumanReview: !passed,
        }),
      );

      if (!passed) {
        await this.createNotification(
          "compliance_blocked",
          "Application has compliance issues",
          `Your application for ${opportunityName} cannot be submitted yet.`,
          { applicationId, blockers },
        );
      }

      await this.completeRun(runId, {
        outputSummary: passed
          ? `"${opportunityName}" passed compliance.`
          : `"${opportunityName}" blocked: ${blockers.join("; ")}`,
        itemsFound: 1,
        itemsProcessed: 1,
      });

      return {
        success: true,
        itemsFound: 1,
        itemsProcessed: 1,
        itemsQueued: 0,
        decisions,
        nextActions: [],
        errors,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Compliance check run failed.";
      await this.failRun(runId, message);
      return {
        success: false,
        itemsFound: 0,
        itemsProcessed: 0,
        itemsQueued: 0,
        decisions,
        nextActions: [],
        errors: [...errors, message],
      };
    }
  }
}
