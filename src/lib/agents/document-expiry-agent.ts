// AG-10 Document Expiry Agent (AutonomousAgent, migration 080
// infrastructure). Runs nightly - registered unconditionally in
// worker/autonomous-orchestrator.ts's runOrgPipeline (every 2AM run).
//
// Deviation from the task-given spec, checked against the real schema
// (src/types/database.ts): `documents` has no `is_active` column - there is
// no soft-delete/active concept on this table, so that filter is dropped.
//
// Not in the task spec but added to prevent alert spam: this agent runs
// every night, and the same expiring document would otherwise re-notify on
// every run until it's updated. Before notifying, it checks agent_decisions
// for a 'document_expiring_flagged' decision already logged for this
// document in the last 7 days and skips if found - agent_decisions doubles
// as the dedup ledger so no new table/column is needed.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule" | "event";

const EXPIRY_WINDOW_DAYS = 30;
const RENOTIFY_SUPPRESSION_DAYS = 7;

interface DocumentRow {
  id: string;
  file_name: string;
  expiration_date: string;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export class DocumentExpiryAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-10-document-expiry", supabase);
  }

  private async wasRecentlyFlagged(documentId: string): Promise<boolean> {
    const since = addDays(
      new Date(),
      -RENOTIFY_SUPPRESSION_DAYS,
    ).toISOString();

    const { data } = await this.supabase
      .from("agent_decisions")
      .select("id")
      .eq("org_id", this.orgId)
      .eq("agent_id", this.agentId)
      .eq("decision_type", "document_expiring_flagged")
      .eq("entity_id", documentId)
      .gte("created_at", since)
      .limit(1)
      .maybeSingle();

    return Boolean(data);
  }

  override async run(
    triggerSource: TriggerSource,
  ): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource);
    const errors: string[] = [];
    const decisions: string[] = [];
    let notified = 0;

    try {
      const cutoff = addDays(new Date(), EXPIRY_WINDOW_DAYS)
        .toISOString()
        .slice(0, 10);

      const { data: docRows, error: docsError } = await this.supabase
        .from("documents")
        .select("id, file_name, expiration_date")
        .eq("organization_id", this.orgId)
        .not("expiration_date", "is", null)
        .lte("expiration_date", cutoff);

      if (docsError) {
        throw new Error(`Failed to load documents: ${docsError.message}`);
      }

      const documents = (docRows ?? []) as DocumentRow[];

      for (const doc of documents) {
        try {
          if (await this.wasRecentlyFlagged(doc.id)) continue;

          await this.createNotification(
            "document_expiring",
            "Document expiring soon",
            `${doc.file_name} expires on ${doc.expiration_date}. Update this document before it affects your applications.`,
            { documentId: doc.id, expirationDate: doc.expiration_date },
          );
          notified++;

          decisions.push(
            await this.logDecision({
              decisionType: "document_expiring_flagged",
              agentRunId: runId,
              entityType: "document",
              entityId: doc.id,
              reasoning:
                `Document "${doc.file_name}" (id ${doc.id}) has an expiration_date of ${doc.expiration_date}, which falls within the ${EXPIRY_WINDOW_DAYS}-day advance-warning window checked on every nightly run. ` +
                `An expired document attached to a compliance-required category can silently break an in-progress application, so this agent surfaces it proactively as an in-app notification rather than waiting for a submission to fail. ` +
                `Before notifying, this agent checked agent_decisions for a "document_expiring_flagged" entry against this same document id within the last ${RENOTIFY_SUPPRESSION_DAYS} days and found none, so this is not a repeat notification for the same expiring document. ` +
                "This is a deterministic date comparison - no AI model is used - and it only creates a notification, never modifies or deletes the document itself.",
              confidenceScore: 95,
              actionTaken: "created_expiry_notification",
              actionPayload: { expirationDate: doc.expiration_date },
            }),
          );
        } catch (err) {
          const message =
            err instanceof Error
              ? err.message
              : "Failed to process expiring document.";
          errors.push(`document ${doc.id}: ${message}`);
        }
      }

      await this.completeRun(runId, {
        outputSummary: `${notified}/${documents.length} expiring document(s) notified.`,
        itemsFound: documents.length,
        itemsProcessed: documents.length,
        itemsQueued: notified,
      });

      return {
        success: true,
        itemsFound: documents.length,
        itemsProcessed: documents.length,
        itemsQueued: notified,
        decisions,
        nextActions: [],
        errors,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Document expiry run failed.";
      await this.failRun(runId, message);
      return {
        success: false,
        itemsFound: 0,
        itemsProcessed: 0,
        itemsQueued: notified,
        decisions,
        nextActions: [],
        errors: [...errors, message],
      };
    }
  }
}
