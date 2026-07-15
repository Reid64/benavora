"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Loader2, Power, X } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button, Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

interface ControlStatus {
  id: string;
  control_type: string;
  target_id: string | null;
  paused: boolean;
  paused_by: string | null;
  paused_at: string | null;
  reason: string | null;
  created_at: string;
}

interface OrgOption {
  id: string;
  name: string;
}

interface FunderOption {
  id: string;
  name: string;
}

export default function QueueControlsPage() {
  const [loading, setLoading] = useState(true);
  const [controls, setControls] = useState<ControlStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Platform kill switch state
  const [showKillConfirm, setShowKillConfirm] = useState(false);
  const [killReason, setKillReason] = useState("");
  const [killingPlatform, setKillingPlatform] = useState(false);

  // Pause tenant form
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [tenantReason, setTenantReason] = useState("");
  const [pausingTenant, setPausingTenant] = useState(false);

  // Pause funder form
  const [funderSearch, setFunderSearch] = useState("");
  const [funderResults, setFunderResults] = useState<FunderOption[]>([]);
  const [selectedFunder, setSelectedFunder] = useState<FunderOption | null>(null);
  const [funderReason, setFunderReason] = useState("");
  const [pausingFunder, setPausingFunder] = useState(false);

  // Pause domain form
  const [domainInput, setDomainInput] = useState("");
  const [domainReason, setDomainReason] = useState("");
  const [pausingDomain, setPausingDomain] = useState(false);

  const isPlatformPaused = controls.some(
    (c) => c.control_type === "platform" && c.target_id === "global",
  );

  const loadControls = useCallback(async () => {
    const res = await fetch("/api/autoapply/controls");
    if (res.ok) {
      const json = (await res.json()) as { controls: ControlStatus[] };
      setControls(json.controls);
    }
  }, []);

  useEffect(() => {
    async function init() {
      setLoading(true);
      try {
        await loadControls();
        const supabase = createClient();
        const { data } = await supabase
          .from("organizations")
          .select("id, name")
          .order("name");
        setOrgs((data ?? []) as OrgOption[]);
      } finally {
        setLoading(false);
      }
    }
    void init();
  }, [loadControls]);

  // Funder search (debounced via state)
  useEffect(() => {
    if (funderSearch.length < 2) {
      setFunderResults([]);
      return;
    }
    const timeout = setTimeout(async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("funders")
        .select("id, name")
        .ilike("name", `%${funderSearch}%`)
        .limit(8);
      setFunderResults((data ?? []) as FunderOption[]);
    }, 250);
    return () => clearTimeout(timeout);
  }, [funderSearch]);

  function showFeedback(msg: string, isError = false) {
    if (isError) {
      setError(msg);
      setSuccess(null);
    } else {
      setSuccess(msg);
      setError(null);
    }
    setTimeout(() => {
      setError(null);
      setSuccess(null);
    }, 4000);
  }

  async function applyControl(payload: {
    control_type: string;
    target_id?: string;
    reason: string;
  }) {
    const res = await fetch("/api/autoapply/controls", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? "Failed to apply control.");
    }
    await loadControls();
  }

  async function removeControl(controlType: string, targetId?: string | null) {
    const res = await fetch("/api/autoapply/controls", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ control_type: controlType, target_id: targetId }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      showFeedback(err.error ?? "Failed to resume.", true);
      return;
    }
    await loadControls();
    showFeedback("Control removed — submissions resumed.");
  }

  async function handleKillSwitch() {
    if (!killReason.trim()) return;
    setKillingPlatform(true);
    try {
      await applyControl({ control_type: "platform", reason: killReason.trim() });
      setShowKillConfirm(false);
      setKillReason("");
      showFeedback("PLATFORM PAUSED. All AutoApply submissions are halted.");
    } catch (e) {
      showFeedback(e instanceof Error ? e.message : "Failed.", true);
    } finally {
      setKillingPlatform(false);
    }
  }

  async function handlePauseTenant() {
    if (!selectedOrgId || !tenantReason.trim()) return;
    setPausingTenant(true);
    try {
      await applyControl({
        control_type: "tenant",
        target_id: selectedOrgId,
        reason: tenantReason.trim(),
      });
      setSelectedOrgId("");
      setTenantReason("");
      showFeedback("Organization paused.");
    } catch (e) {
      showFeedback(e instanceof Error ? e.message : "Failed.", true);
    } finally {
      setPausingTenant(false);
    }
  }

  async function handlePauseFunder() {
    if (!selectedFunder || !funderReason.trim()) return;
    setPausingFunder(true);
    try {
      await applyControl({
        control_type: "funder",
        target_id: selectedFunder.id,
        reason: funderReason.trim(),
      });
      setSelectedFunder(null);
      setFunderSearch("");
      setFunderReason("");
      showFeedback(`Funder "${selectedFunder.name}" paused.`);
    } catch (e) {
      showFeedback(e instanceof Error ? e.message : "Failed.", true);
    } finally {
      setPausingFunder(false);
    }
  }

  async function handlePauseDomain() {
    const domain = domainInput.trim().toLowerCase().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
    if (!domain || !domainReason.trim()) return;
    setPausingDomain(true);
    try {
      await applyControl({
        control_type: "domain",
        target_id: domain,
        reason: domainReason.trim(),
      });
      setDomainInput("");
      setDomainReason("");
      showFeedback(`Domain "${domain}" paused.`);
    } catch (e) {
      showFeedback(e instanceof Error ? e.message : "Failed.", true);
    } finally {
      setPausingDomain(false);
    }
  }

  function formatControlLabel(control: ControlStatus): string {
    switch (control.control_type) {
      case "platform":
        return "ALL SUBMISSIONS (Platform)";
      case "tenant":
        return `Org: ${control.target_id ?? ""}`;
      case "funder":
        return `Funder: ${control.target_id ?? ""}`;
      case "domain":
        return `Domain: ${control.target_id ?? ""}`;
      default:
        return control.target_id ?? control.control_type;
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-navy-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading controls…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          href="/autoapply"
          className="flex items-center gap-1.5 text-sm text-navy-400 hover:text-navy-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to AutoApply
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-primary">
          Queue Control Plane
        </h1>
        <p className="mt-1 text-sm text-navy-500">
          Pause and resume AutoApply submissions at the platform, domain, funder, or organization level.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}
      {success && (
        <div
          role="status"
          className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-700"
        >
          {success}
        </div>
      )}

      {/* Platform Kill Switch */}
      <div
        className={`rounded-lg border-2 px-6 py-5 ${
          isPlatformPaused
            ? "border-red-400 bg-red-50"
            : "border-red-200 bg-white shadow-sm"
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Power
              className={`mt-0.5 h-5 w-5 flex-shrink-0 ${
                isPlatformPaused ? "text-red-600" : "text-red-400"
              }`}
            />
            <div>
              <p className="text-sm font-semibold text-navy-900">
                Platform Emergency Kill Switch
              </p>
              <p className="mt-0.5 text-xs text-navy-500">
                {isPlatformPaused
                  ? "ALL AutoApply submissions are currently HALTED across all organizations."
                  : "Immediately stops all AutoApply submissions across every organization. Use in emergencies only."}
              </p>
            </div>
          </div>
          {isPlatformPaused ? (
            <Button
              variant="secondary"
              onClick={() => void removeControl("platform", "global")}
            >
              Resume Platform
            </Button>
          ) : (
            <button
              type="button"
              onClick={() => setShowKillConfirm(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
            >
              <AlertTriangle className="h-4 w-4" />
              Pause All Submissions
            </button>
          )}
        </div>

        {/* Kill switch confirmation */}
        {showKillConfirm && !isPlatformPaused && (
          <div className="mt-5 rounded-md border border-red-300 bg-red-100 p-4">
            <p className="mb-3 text-sm font-semibold text-red-800">
              Confirm: pause ALL AutoApply submissions platform-wide?
            </p>
            <textarea
              value={killReason}
              onChange={(e) => setKillReason(e.target.value)}
              placeholder="Reason for emergency pause (required)…"
              rows={2}
              className="w-full rounded-md border border-red-300 bg-white px-3 py-2 text-sm text-navy-900 placeholder-navy-400 shadow-sm focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-400"
            />
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                disabled={!killReason.trim() || killingPlatform}
                onClick={() => void handleKillSwitch()}
                className="inline-flex items-center gap-1.5 rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-800 disabled:opacity-50"
              >
                {killingPlatform && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Confirm Pause
              </button>
              <Button
                variant="secondary"
                onClick={() => {
                  setShowKillConfirm(false);
                  setKillReason("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Active Pauses Table */}
      <Card
        title="Active Pauses"
        description="Currently paused controls. Click Resume to re-enable."
      >
        {controls.length === 0 ? (
          <p className="py-2 text-sm text-navy-400">
            No active pauses. All submission controls are clear.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-sidebar text-left text-xs font-medium uppercase tracking-wide text-white">
                  <th className="px-2 py-2">Type</th>
                  <th className="px-2 py-2">Target</th>
                  <th className="px-2 py-2">Reason</th>
                  <th className="px-2 py-2">Paused By</th>
                  <th className="px-2 py-2">Paused At</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-50">
                {controls.map((c) => (
                  <tr key={c.id} className={c.control_type === "platform" ? "bg-red-50" : ""}>
                    <td className="py-2.5 pr-4">
                      <Badge
                        variant={
                          c.control_type === "platform"
                            ? "error"
                            : c.control_type === "tenant"
                            ? "info"
                            : c.control_type === "funder"
                            ? "warning"
                            : "info"
                        }
                      >
                        {c.control_type}
                      </Badge>
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-xs text-navy-700">
                      {formatControlLabel(c)}
                    </td>
                    <td className="py-2.5 pr-4 text-navy-600">
                      {c.reason ?? "—"}
                    </td>
                    <td className="py-2.5 pr-4 text-navy-500">
                      {c.paused_by ?? "—"}
                    </td>
                    <td className="py-2.5 pr-4 text-navy-400 whitespace-nowrap">
                      {c.paused_at
                        ? new Date(c.paused_at).toLocaleString()
                        : "—"}
                    </td>
                    <td className="py-2.5">
                      <button
                        type="button"
                        onClick={() => void removeControl(c.control_type, c.target_id)}
                        className="text-xs font-medium text-teal-600 hover:text-teal-800"
                      >
                        Resume
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Pause Tenant */}
        <Card title="Pause Organization">
          <div className="space-y-3">
            <div>
              <label
                htmlFor="orgSelect"
                className="block text-xs font-medium text-navy-700"
              >
                Organization
              </label>
              <select
                id="orgSelect"
                value={selectedOrgId}
                onChange={(e) => setSelectedOrgId(e.target.value)}
                className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
              >
                <option value="">Select organization…</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="tenantReason"
                className="block text-xs font-medium text-navy-700"
              >
                Reason
              </label>
              <input
                id="tenantReason"
                type="text"
                value={tenantReason}
                onChange={(e) => setTenantReason(e.target.value)}
                placeholder="Reason for pause…"
                className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
              />
            </div>
            <Button
              onClick={() => void handlePauseTenant()}
              isLoading={pausingTenant}
              disabled={!selectedOrgId || !tenantReason.trim() || pausingTenant}
              className="w-full"
            >
              Pause Organization
            </Button>
          </div>
        </Card>

        {/* Pause Funder */}
        <Card title="Pause Funder">
          <div className="space-y-3">
            <div className="relative">
              <label
                htmlFor="funderSearch"
                className="block text-xs font-medium text-navy-700"
              >
                Funder
              </label>
              {selectedFunder ? (
                <div className="mt-1 flex items-center justify-between rounded-md border border-navy-200 bg-navy-50 px-3 py-2">
                  <span className="text-sm text-navy-900">{selectedFunder.name}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedFunder(null);
                      setFunderSearch("");
                    }}
                    className="text-navy-400 hover:text-navy-700"
                    aria-label="Clear funder"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <input
                  id="funderSearch"
                  type="text"
                  value={funderSearch}
                  onChange={(e) => setFunderSearch(e.target.value)}
                  placeholder="Search funder name…"
                  className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
                />
              )}
              {funderResults.length > 0 && !selectedFunder && (
                <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-navy-200 bg-white shadow-lg">
                  {funderResults.map((f) => (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedFunder(f);
                          setFunderSearch("");
                          setFunderResults([]);
                        }}
                        className="w-full px-4 py-2.5 text-left text-sm text-navy-700 hover:bg-navy-50"
                      >
                        {f.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <label
                htmlFor="funderReason"
                className="block text-xs font-medium text-navy-700"
              >
                Reason
              </label>
              <input
                id="funderReason"
                type="text"
                value={funderReason}
                onChange={(e) => setFunderReason(e.target.value)}
                placeholder="Reason for pause…"
                className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
              />
            </div>
            <Button
              onClick={() => void handlePauseFunder()}
              isLoading={pausingFunder}
              disabled={!selectedFunder || !funderReason.trim() || pausingFunder}
              className="w-full"
            >
              Pause Funder
            </Button>
          </div>
        </Card>

        {/* Pause Domain */}
        <Card title="Pause Domain">
          <div className="space-y-3">
            <div>
              <label
                htmlFor="domainInput"
                className="block text-xs font-medium text-navy-700"
              >
                Domain
              </label>
              <input
                id="domainInput"
                type="text"
                value={domainInput}
                onChange={(e) => setDomainInput(e.target.value)}
                placeholder="e.g. benevity.com"
                className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
              />
            </div>
            <div>
              <label
                htmlFor="domainReason"
                className="block text-xs font-medium text-navy-700"
              >
                Reason
              </label>
              <input
                id="domainReason"
                type="text"
                value={domainReason}
                onChange={(e) => setDomainReason(e.target.value)}
                placeholder="Reason for pause…"
                className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
              />
            </div>
            <Button
              onClick={() => void handlePauseDomain()}
              isLoading={pausingDomain}
              disabled={!domainInput.trim() || !domainReason.trim() || pausingDomain}
              className="w-full"
            >
              Pause Domain
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
