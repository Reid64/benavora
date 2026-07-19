"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logConnectorUsage = logConnectorUsage;
const admin_1 = require("../../../lib/supabase/admin");
/**
 * Shared `adapter_usage_log` (migration 076) writer for §6 BYO-key
 * connectors — same table `google-places-adapter.ts` already logs to, with
 * `adapter_name` set to the connector's provider key ("apollo"/"hunter") so
 * the connectors page's `GET /api/donor-discovery/connectors` route (which
 * already aggregates this table by `adapter_name` for `last_used_at`/
 * `records_enriched`) picks these calls up with no route change needed.
 */
async function logConnectorUsage(params) {
    const supabase = (0, admin_1.createAdminClient)();
    await supabase.from("adapter_usage_log").insert({
        organization_id: params.organizationId,
        adapter_name: params.adapterName,
        api_cost_cents: 0,
        records_returned: params.recordsReturned,
        cache_hit: false,
    });
}
