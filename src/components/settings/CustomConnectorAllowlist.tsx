"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Globe, Shield, Trash2, X } from "lucide-react";

type AllowlistDomain = {
  id: string;
  domain: string;
  label: string | null;
  created_at: string;
};

/**
 * Org-admin-managed domain allowlist for Custom API Connectors and Scraping
 * Targets (rows #59/#60 SSRF hardening). A writer can create a connector,
 * but only against a domain already listed here — deliberately not something
 * an end user configures on their own. Shared by both settings pages.
 *
 * Inline hex per the One UI Rule (STANDING_DIRECTIVES Directive 4) — this is
 * a net-new component, not a restyle of the existing Tailwind-token settings
 * pages it's mounted into.
 */
export function CustomConnectorAllowlist({
  canManage,
}: {
  canManage: boolean;
}) {
  const [domains, setDomains] = useState<AllowlistDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [newDomain, setNewDomain] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [removing, setRemoving] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/integrations/custom-api/allowlist");
      if (res.ok) {
        const body = (await res.json()) as { domains: AllowlistDomain[] };
        setDomains(body.domains ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!newDomain.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/custom-api/allowlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: newDomain, label: newLabel || undefined }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Failed to add the domain.");
        return;
      }
      setNewDomain("");
      setNewLabel("");
      await load();
    } catch {
      setError("Failed to add the domain.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove(id: string) {
    setRemoving((r) => ({ ...r, [id]: true }));
    try {
      await fetch(`/api/integrations/custom-api/allowlist/${id}`, { method: "DELETE" });
      await load();
    } finally {
      setRemoving((r) => ({ ...r, [id]: false }));
    }
  }

  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid #E2E8F0",
        borderRadius: 12,
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        marginBottom: 20,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 20px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Shield size={18} color="#3D6B50" />
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#0F172A" }}>
              Allowed Domains
            </div>
            <div style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>
              {loading
                ? "Loading…"
                : `${domains.length} domain${domains.length === 1 ? "" : "s"} allowlisted — connectors and scraping targets can only target these.`}
            </div>
          </div>
        </div>
        <span style={{ fontSize: 12, color: "#3D6B50", fontWeight: 600 }}>
          {expanded ? "Hide" : "Manage"}
        </span>
      </button>

      {expanded && (
        <div style={{ padding: "0 20px 20px", borderTop: "1px solid #E2E8F0" }}>
          {domains.length === 0 && !loading && (
            <div style={{ fontSize: 13, color: "#94A3B8", padding: "16px 0" }}>
              No domains allowlisted yet. {canManage ? "Add one below." : "Ask an admin to add one."}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
            {domains.map((d) => (
              <div
                key={d.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 12px",
                  background: "#F8FAFC",
                  border: "1px solid #E2E8F0",
                  borderRadius: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Globe size={14} color="#C49A4F" />
                  <span style={{ fontSize: 13, fontWeight: 500, color: "#0F172A" }}>
                    {d.domain}
                  </span>
                  {d.label && (
                    <span style={{ fontSize: 12, color: "#94A3B8" }}>— {d.label}</span>
                  )}
                </div>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => void handleRemove(d.id)}
                    disabled={removing[d.id]}
                    style={{
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      color: "#EF4444",
                      display: "flex",
                      alignItems: "center",
                      padding: 4,
                      opacity: removing[d.id] ? 0.5 : 1,
                    }}
                    aria-label={`Remove ${d.domain}`}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {canManage && (
            <form
              onSubmit={handleAdd}
              style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}
            >
              <input
                type="text"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                placeholder="api.grants.gov"
                style={{
                  flex: "1 1 180px",
                  padding: "8px 12px",
                  fontSize: 13,
                  border: "1px solid #E2E8F0",
                  borderRadius: 8,
                  color: "#0F172A",
                }}
              />
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Label (optional)"
                style={{
                  flex: "1 1 140px",
                  padding: "8px 12px",
                  fontSize: 13,
                  border: "1px solid #E2E8F0",
                  borderRadius: 8,
                  color: "#0F172A",
                }}
              />
              <button
                type="submit"
                disabled={submitting || !newDomain.trim()}
                style={{
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#FFFFFF",
                  background: submitting ? "#94A3B8" : "linear-gradient(135deg,#3D6B50,#C49A4F)",
                  border: "none",
                  borderRadius: 8,
                  cursor: submitting ? "default" : "pointer",
                }}
              >
                {submitting ? "Adding…" : "Add Domain"}
              </button>
            </form>
          )}

          {error && (
            <div
              style={{
                marginTop: 10,
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: "#EF4444",
              }}
            >
              <X size={12} />
              {error}
            </div>
          )}

          {!canManage && (
            <div style={{ fontSize: 12, color: "#94A3B8", marginTop: 12 }}>
              Only admins and owners can manage the domain allowlist.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
