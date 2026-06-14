// Custom API Research Agent — AGENTS.md Agent 19.
//
// Polls client-configured REST API connections for grant opportunities.
// For each active connection:
//   1. Validates field_mapping includes at least a "name" mapping (Contracts §20)
//   2. Constructs the HTTP request with auth from auth_config
//   3. Fetches the endpoint, normalising the response to an item array
//   4. Applies field_mapping to transform items to opportunity fields
//   5. Deduplicates by (organization_id, name, source) before inserting
//   6. On failure: increments error_count; at 3 consecutive failures auto-pauses
//      the connection and writes an automation_notification for the user
//
// auth_config is read server-side only. Keys are never returned to the client
// in plaintext (BEHAVIORAL_CONTRACTS §20).

import {
  AgentError,
  BaseAgent,
  type AgentExecution,
} from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";

export interface CustomApiInput {
  /** Run only this connection; omit to run all active connections. */
  connectionId?: string;
}

export interface CustomApiResult {
  connectionsRun: number;
  opportunitiesCreated: number;
  connectionsPaused: number;
  errors: { connectionId: string; name: string; message: string }[];
}

type AuthType = "none" | "api_key" | "bearer" | "oauth";

interface ConnectionRow {
  id: string;
  name: string;
  base_url: string;
  auth_type: AuthType;
  auth_config: Record<string, string>;
  field_mapping: Record<string, string>;
  error_count: number;
}

// Opportunity columns the field_mapping is allowed to write to. Prevents an
// attacker-controlled API from overwriting org-scoped columns like organization_id.
const ALLOWED_OPP_FIELDS = new Set([
  "name",
  "description",
  "amount_available",
  "amount_min",
  "amount_max",
  "deadline",
  "url",
  "eligibility_requirements",
  "category",
]);

export class CustomApiResearchAgent extends BaseAgent<
  CustomApiInput,
  CustomApiResult
> {
  readonly agentType: AgentType = "custom_api_research";

  protected async execute(
    input: CustomApiInput,
  ): Promise<AgentExecution<CustomApiResult>> {
    let query = this.client
      .from("custom_api_connections")
      .select(
        "id, name, base_url, auth_type, auth_config, field_mapping, error_count",
      )
      .eq("organization_id", this.organizationId)
      .eq("is_active", true);

    if (input.connectionId) {
      query = query.eq("id", input.connectionId);
    }

    const { data: rows, error: loadError } = await query;
    if (loadError) {
      throw new AgentError(
        "Failed to load custom API connections.",
        "load_failed",
      );
    }
    if (!rows || rows.length === 0) {
      return {
        data: {
          connectionsRun: 0,
          opportunitiesCreated: 0,
          connectionsPaused: 0,
          errors: [],
        },
        outputSummary: "No active custom API connections found.",
        itemsFound: 0,
        itemsProcessed: 0,
        tokensUsed: 0,
      };
    }

    const connections = rows as ConnectionRow[];
    let opportunitiesCreated = 0;
    let connectionsPaused = 0;
    const errors: { connectionId: string; name: string; message: string }[] =
      [];

    for (const conn of connections) {
      try {
        const created = await this.pollConnection(conn);
        opportunitiesCreated += created;

        await this.client
          .from("custom_api_connections")
          .update({
            error_count: 0,
            last_polled_at: new Date().toISOString(),
            last_success_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", conn.id)
          .eq("organization_id", this.organizationId);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error.";
        errors.push({ connectionId: conn.id, name: conn.name, message });

        const newCount = (conn.error_count ?? 0) + 1;
        const shouldPause = newCount >= 3;

        await this.client
          .from("custom_api_connections")
          .update({
            error_count: newCount,
            last_polled_at: new Date().toISOString(),
            is_active: !shouldPause,
            updated_at: new Date().toISOString(),
          })
          .eq("id", conn.id)
          .eq("organization_id", this.organizationId);

        if (shouldPause) {
          connectionsPaused++;
          // Best-effort notification — automation_notifications may not exist
          // until its own migration runs; the returned error is intentionally
          // not checked here so a missing table never blocks the agent result.
          await this.client.from("automation_notifications").insert({
            organization_id: this.organizationId,
            event_type: "target_paused",
            title: `Custom API paused: ${conn.name}`,
            message: `"${conn.name}" was auto-paused after 3 consecutive failures. Last error: ${message}`,
            is_read: false,
            sent_via: "in_app",
          });
        }
      }
    }

    return {
      data: {
        connectionsRun: connections.length,
        opportunitiesCreated,
        connectionsPaused,
        errors,
      },
      outputSummary: `Ran ${connections.length} connection(s): ${opportunitiesCreated} opportunities created, ${connectionsPaused} paused.`,
      itemsFound: connections.length,
      itemsProcessed: opportunitiesCreated,
      tokensUsed: 0,
    };
  }

  private async pollConnection(conn: ConnectionRow): Promise<number> {
    const mapping = (conn.field_mapping ?? {}) as Record<string, string>;

    // Verify at least one API field maps to "name" (Contracts §20).
    const nameApiField = Object.entries(mapping).find(
      ([, v]) => v === "name",
    )?.[0];
    if (!nameApiField) {
      throw new Error(
        'Field mapping must include a mapping to "name" (opportunity name).',
      );
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    this.applyAuth(conn, headers);

    const response = await fetch(conn.base_url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const rawData: unknown = await response.json();
    const items = normalizeItems(rawData);

    let created = 0;
    for (const item of items) {
      const name = String(item[nameApiField] ?? "").trim();
      if (!name) continue;

      // Dedup: skip if this org already has an opportunity with this name from
      // this source (Contracts §20: custom API results use source = connection.name).
      const { data: existing } = await this.client
        .from("opportunities")
        .select("id")
        .eq("organization_id", this.organizationId)
        .eq("name", name)
        .eq("source", conn.name)
        .maybeSingle();

      if (existing) continue;

      // Build opportunity row. Constrained to ALLOWED_OPP_FIELDS to prevent
      // field_mapping from writing to protected columns.
      const opp: Record<string, unknown> = {
        organization_id: this.organizationId,
        source: conn.name,
        status: "open",
        // Default category — overridden if "category" appears in field_mapping.
        category: "government_grant",
      };

      for (const [apiField, oppField] of Object.entries(mapping)) {
        if (!ALLOWED_OPP_FIELDS.has(oppField)) continue;
        const value = item[apiField];
        if (value !== undefined && value !== null && value !== "") {
          opp[oppField] = value;
        }
      }

      const { error: insertError } = await this.client
        .from("opportunities")
        .insert(opp);

      if (!insertError) created++;
    }

    return created;
  }

  private applyAuth(
    conn: ConnectionRow,
    headers: Record<string, string>,
  ): void {
    const cfg = (conn.auth_config ?? {}) as Record<string, string>;

    if (conn.auth_type === "api_key") {
      const headerName = cfg.header_name ?? "X-Api-Key";
      const key = cfg.key ?? "";
      if (key) headers[headerName] = key;
    } else if (conn.auth_type === "bearer" || conn.auth_type === "oauth") {
      const token = cfg.token ?? cfg.key ?? "";
      if (token) headers["Authorization"] = `Bearer ${token}`;
    }
  }
}

// Normalize an arbitrary API response body to an array of objects.
// Checks common envelope keys before falling back to wrapping the root object.
function normalizeItems(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const key of [
      "data",
      "items",
      "results",
      "records",
      "opportunities",
      "grants",
    ]) {
      if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[];
    }
    return [obj];
  }
  return [];
}
