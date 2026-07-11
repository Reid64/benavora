"use client";

import { useCallback, useEffect, useState } from "react";
import { AtSign, Building2, Database, Layers3, Loader2, MapPin, Plug, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Badge, Button, Card, Input, Modal } from "@/components/ui";
import type { BadgeVariant } from "@/components/ui";
import { ColorIcon } from "@/components/ui/ColorIcon";
import type { IconHue } from "@/components/ui/ColorIcon";
import { CONNECTOR_PROVIDERS } from "@/lib/donor-discovery/connector-providers";
import type { DdConnectorProvider } from "@/lib/donor-discovery/connector-providers";
import { formatRelative } from "@/lib/utils/formatters";

interface ConnectorRow {
  provider: DdConnectorProvider;
  name: string;
  connectable: boolean;
  status: "pending" | "active" | "invalid" | "revoked" | null;
  key_hint: string | null;
  activated_at: string | null;
  last_used_at: string | null;
  records_enriched: number;
}

const PROVIDER_ICONS: Record<DdConnectorProvider, LucideIcon> = {
  google_places: MapPin,
  apollo: Building2,
  hunter: AtSign,
  zoominfo: Database,
  clay: Layers3,
};

// Donor Discovery's icon hue is emerald (money/giving family per
// DONOR_DISCOVERY_ARCHITECTURE.md §4); disabled "coming soon" cards fall back
// to a neutral treatment via ColorIcon's own connected/disconnected styling.
const CONNECTED_HUE: IconHue = "emerald";

type TestState = { status: "idle" | "testing" | "valid" | "invalid"; message: string | null };

export default function DonorDiscoveryConnectorsPage() {
  const [connectors, setConnectors] = useState<ConnectorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [connectTarget, setConnectTarget] = useState<ConnectorRow | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [testState, setTestState] = useState<TestState>({ status: "idle", message: null });
  const [saving, setSaving] = useState(false);

  const [disconnectTarget, setDisconnectTarget] = useState<ConnectorRow | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/donor-discovery/connectors", { cache: "no-store" });
      if (!res.ok) {
        setError("Could not load connectors.");
        return;
      }
      const body = (await res.json()) as { connectors: ConnectorRow[] };
      setConnectors(body.connectors ?? []);
    } catch {
      setError("Could not load connectors.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openConnect(row: ConnectorRow) {
    setConnectTarget(row);
    setApiKey("");
    setTestState({ status: "idle", message: null });
  }

  function closeConnect() {
    if (saving || testState.status === "testing") return;
    setConnectTarget(null);
    setApiKey("");
    setTestState({ status: "idle", message: null });
  }

  async function handleTest() {
    if (!connectTarget || !apiKey.trim()) return;
    setTestState({ status: "testing", message: null });
    try {
      const res = await fetch("/api/donor-discovery/connectors/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: connectTarget.provider, api_key: apiKey.trim() }),
      });
      const body = (await res.json()) as { valid?: boolean; message?: string; error?: string };
      if (!res.ok) {
        setTestState({ status: "invalid", message: body.error ?? "Test failed." });
        return;
      }
      setTestState({
        status: body.valid ? "valid" : "invalid",
        message: body.message ?? (body.valid ? "Key verified." : "Key could not be verified."),
      });
    } catch {
      setTestState({ status: "invalid", message: "Could not reach the test endpoint." });
    }
  }

  async function handleSave() {
    if (!connectTarget || !apiKey.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/donor-discovery/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: connectTarget.provider, api_key: apiKey.trim() }),
      });
      if (res.ok) {
        setConnectTarget(null);
        setApiKey("");
        setTestState({ status: "idle", message: null });
        void load();
      } else {
        const body = (await res.json()) as { error?: string };
        setTestState({ status: "invalid", message: body.error ?? "Failed to save key." });
      }
    } catch {
      setTestState({ status: "invalid", message: "Failed to save key." });
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    if (!disconnectTarget) return;
    setDisconnecting(true);
    try {
      await fetch(`/api/donor-discovery/connectors?provider=${disconnectTarget.provider}`, {
        method: "DELETE",
      });
      setDisconnectTarget(null);
      void load();
    } finally {
      setDisconnecting(false);
    }
  }

  const rows: ConnectorRow[] = connectors.length > 0
    ? connectors
    : CONNECTOR_PROVIDERS.map((c) => ({
        provider: c.key,
        name: c.name,
        connectable: c.connectable,
        status: null,
        key_hint: null,
        activated_at: null,
        last_used_at: null,
        records_enriched: 0,
      }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Connectors"
        description="Connect your own API keys for deeper prospect enrichment."
      />

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-sm text-text-muted">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          Loading…
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {rows.map((row) => {
            const Icon = PROVIDER_ICONS[row.provider];
            const connected = row.status === "active";
            const comingSoon = !row.connectable;
            const badgeVariant: BadgeVariant = comingSoon
              ? "neutral"
              : connected
                ? "success"
                : "neutral";

            return (
              <Card key={row.provider} noPadding>
                <div className="flex flex-col gap-4 p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <ColorIcon
                        icon={Icon}
                        hue={connected ? CONNECTED_HUE : "cyan"}
                        className={comingSoon ? "opacity-50" : undefined}
                      />
                      <div className="space-y-0.5">
                        <p className="text-sm font-semibold text-text">{row.name}</p>
                        <Badge variant={badgeVariant} withDot={connected}>
                          {comingSoon ? "Coming Soon" : connected ? "Connected" : "Not Connected"}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <p className="text-xs leading-relaxed text-text-muted">
                    {CONNECTOR_PROVIDERS.find((c) => c.key === row.provider)?.description}
                  </p>

                  {connected && (
                    <div className="space-y-1.5 rounded-md border border-border bg-surface-sunken px-3 py-2 text-xs text-text-muted">
                      {row.key_hint && (
                        <div className="flex items-center justify-between">
                          <span>Key</span>
                          <span className="font-mono text-text">{row.key_hint}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <span>Last used</span>
                        <span className="text-text">
                          {row.last_used_at ? formatRelative(row.last_used_at) : "Never"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Records enriched</span>
                        <span className="text-text">{row.records_enriched.toLocaleString()}</span>
                      </div>
                    </div>
                  )}

                  <p className="text-xs text-text-muted">Your key, billed to your account.</p>

                  <div>
                    {comingSoon ? (
                      <Button size="sm" variant="secondary" disabled>
                        <Plug className="h-3.5 w-3.5" aria-hidden />
                        Coming Soon
                      </Button>
                    ) : connected ? (
                      <Button size="sm" variant="danger" onClick={() => setDisconnectTarget(row)}>
                        Disconnect
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => openConnect(row)}>
                        <Plug className="h-3.5 w-3.5" aria-hidden />
                        Connect
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Connect modal */}
      <Modal
        isOpen={!!connectTarget}
        onClose={closeConnect}
        title={connectTarget ? `Connect ${connectTarget.name}` : ""}
        description="Your key is encrypted at rest and never shown again after saving."
        size="sm"
      >
        {connectTarget && (
          <div className="space-y-4">
            <Input
              label="API Key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setTestState({ status: "idle", message: null });
              }}
              placeholder={`Paste your ${connectTarget.name} API key…`}
            />

            {testState.message && (
              <div
                className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${
                  testState.status === "valid"
                    ? "border-success-border bg-success-bg text-success-text"
                    : "border-error-border bg-error-bg text-error-text"
                }`}
              >
                <span>{testState.message}</span>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleTest()}
                disabled={!apiKey.trim() || testState.status === "testing" || saving}
                isLoading={testState.status === "testing"}
              >
                Test
              </Button>
              <Button
                size="sm"
                onClick={() => void handleSave()}
                disabled={testState.status !== "valid" || saving}
                isLoading={saving}
              >
                Save
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Disconnect confirmation */}
      <Modal
        isOpen={!!disconnectTarget}
        onClose={() => setDisconnectTarget(null)}
        title={disconnectTarget ? `Disconnect ${disconnectTarget.name}?` : ""}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-text-muted">
            This removes the stored key. Enrichment runs that rely on {disconnectTarget?.name} will
            stop until you reconnect.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setDisconnectTarget(null)}
              disabled={disconnecting}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => void handleDisconnect()}
              isLoading={disconnecting}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              Disconnect
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
