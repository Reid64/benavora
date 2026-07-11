// GET /api/donor-discovery/connectors — list every catalog provider for the
// org, merged with connection status (donor_discovery_connectors) and usage
// telemetry (adapter_usage_log). Always returns one row per catalog provider,
// even if never connected, so the UI can render a full grid.
// POST — save (upsert) an encrypted BYO API key, status='active'.
// DELETE ?provider=... — disconnect (row removed; a later reconnect re-tests
// and re-saves rather than reactivating stale state).
//
// Keys are encrypted with the existing BYO-key infrastructure
// (src/lib/crypto/key-encrypt.ts) and are NEVER returned in plaintext — only
// a masked ****last4 hint (Behavioral Contracts §20).

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { decryptKey, encryptKey, maskKey } from "@/lib/crypto/key-encrypt";
import {
  CONNECTOR_PROVIDERS,
  getConnectorProvider,
  isConnectorProvider,
} from "@/lib/donor-discovery/connector-providers";

export const runtime = "nodejs";

interface ConnectorRow {
  provider: string;
  encrypted_api_key: string;
  status: string;
  activated_at: string | null;
}

interface UsageRow {
  adapter_name: string;
  records_returned: number | null;
  called_at: string;
}

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const providerKeys = CONNECTOR_PROVIDERS.map((p) => p.key);

  const [connectorsRes, usageRes] = await Promise.all([
    supabase
      .from("donor_discovery_connectors")
      .select("provider, encrypted_api_key, status, activated_at")
      .eq("organization_id", organizationId),
    supabase
      .from("adapter_usage_log")
      .select("adapter_name, records_returned, called_at")
      .eq("organization_id", organizationId)
      .in("adapter_name", providerKeys),
  ]);

  if (connectorsRes.error) {
    return NextResponse.json({ error: "Failed to load connectors." }, { status: 500 });
  }

  const usageByProvider = new Map<string, { lastUsedAt: string; recordsEnriched: number }>();
  for (const row of (usageRes.data ?? []) as UsageRow[]) {
    const existing = usageByProvider.get(row.adapter_name) ?? {
      lastUsedAt: row.called_at,
      recordsEnriched: 0,
    };
    existing.recordsEnriched += row.records_returned ?? 0;
    if (row.called_at > existing.lastUsedAt) existing.lastUsedAt = row.called_at;
    usageByProvider.set(row.adapter_name, existing);
  }

  const connectorsByProvider = new Map(
    ((connectorsRes.data ?? []) as ConnectorRow[]).map((row) => [row.provider, row]),
  );

  const connectors = CONNECTOR_PROVIDERS.map((config) => {
    const row = connectorsByProvider.get(config.key);
    const usage = usageByProvider.get(config.key);

    let keyHint: string | null = null;
    if (row) {
      try {
        keyHint = maskKey(decryptKey(row.encrypted_api_key));
      } catch {
        // Auth-tag failure means a different INTEGRATION_KEY_SECRET was used
        // since this key was saved — show a generic mask rather than crash.
        keyHint = "****xxxx";
      }
    }

    return {
      provider: config.key,
      name: config.name,
      connectable: config.connectable,
      status: row?.status ?? null,
      key_hint: keyHint,
      activated_at: row?.activated_at ?? null,
      last_used_at: usage?.lastUsedAt ?? null,
      records_enriched: usage?.recordsEnriched ?? 0,
    };
  });

  return NextResponse.json({ connectors });
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { provider, api_key } = (body ?? {}) as { provider?: unknown; api_key?: unknown };

  if (!isConnectorProvider(provider)) {
    return NextResponse.json(
      { error: `provider must be one of: ${CONNECTOR_PROVIDERS.map((p) => p.key).join(", ")}.` },
      { status: 400 },
    );
  }
  const config = getConnectorProvider(provider);
  if (!config.connectable) {
    return NextResponse.json(
      { error: `${config.name} is coming soon and cannot be connected yet.` },
      { status: 400 },
    );
  }
  if (typeof api_key !== "string" || !api_key.trim()) {
    return NextResponse.json({ error: "api_key is required." }, { status: 400 });
  }

  const encrypted = encryptKey(api_key.trim());

  const { data, error } = await supabase
    .from("donor_discovery_connectors")
    .upsert(
      {
        organization_id: organizationId,
        provider,
        encrypted_api_key: encrypted,
        status: "active",
        activated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,provider" },
    )
    .select("provider, status, activated_at")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Failed to save connector." }, { status: 500 });
  }

  return NextResponse.json({
    connector: { ...data, key_hint: maskKey(api_key.trim()) },
  });
}

export async function DELETE(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const provider = new URL(request.url).searchParams.get("provider");

  if (!isConnectorProvider(provider)) {
    return NextResponse.json(
      { error: `provider must be one of: ${CONNECTOR_PROVIDERS.map((p) => p.key).join(", ")}.` },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from("donor_discovery_connectors")
    .delete()
    .eq("organization_id", organizationId)
    .eq("provider", provider);

  if (error) {
    return NextResponse.json({ error: "Failed to disconnect." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
