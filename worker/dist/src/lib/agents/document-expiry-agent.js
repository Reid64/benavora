"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentExpiryAgent = void 0;
const autonomous_base_1 = require("@/lib/agents/autonomous-base");
const EXPIRY_WINDOW_DAYS = 30;
const RENOTIFY_SUPPRESSION_DAYS = 7;
function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}
class DocumentExpiryAgent extends autonomous_base_1.AutonomousAgent {
    constructor(orgId, supabase) {
        super(orgId, "ag-10-document-expiry", supabase);
    }
    async wasRecentlyFlagged(documentId) {
        const since = addDays(new Date(), -RENOTIFY_SUPPRESSION_DAYS).toISOString();
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
    async run(triggerSource) {
        const runId = await this.startRun(triggerSource);
        const errors = [];
        const decisions = [];
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
            const documents = (docRows ?? []);
            for (const doc of documents) {
                try {
                    if (await this.wasRecentlyFlagged(doc.id))
                        continue;
                    await this.createNotification("document_expiring", "Document expiring soon", `${doc.file_name} expires on ${doc.expiration_date}. Update this document before it affects your applications.`, { documentId: doc.id, expirationDate: doc.expiration_date });
                    notified++;
                    decisions.push(await this.logDecision({
                        decisionType: "document_expiring_flagged",
                        agentRunId: runId,
                        entityType: "document",
                        entityId: doc.id,
                        reasoning: `${doc.file_name} expires on ${doc.expiration_date}, within the ${EXPIRY_WINDOW_DAYS}-day warning window.`,
                        confidenceScore: 95,
                        actionTaken: "created_expiry_notification",
                        actionPayload: { expirationDate: doc.expiration_date },
                    }));
                }
                catch (err) {
                    const message = err instanceof Error
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
        }
        catch (err) {
            const message = err instanceof Error ? err.message : "Document expiry run failed.";
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
exports.DocumentExpiryAgent = DocumentExpiryAgent;
