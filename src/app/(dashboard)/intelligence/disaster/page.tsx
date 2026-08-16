"use client";

// Disaster Response dashboard (PLATFORM_VISION_ARCHITECTURE.md Pillar 10,
// AGENTS_v2.md AG-25). Reads the shared, non-org-scoped disaster_declarations
// feed via GET /api/agents/disaster (which also polls FEMA for anything new
// on every load), and lets a writer deploy a response for the caller's org
// against any declaration via POST.

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, MapPin } from "lucide-react";

import { Button } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";

interface DisasterDeclaration {
  id: string;
  fema_disaster_number: string;
  disaster_type: string | null;
  incident_type: string | null;
  affected_states: string[] | null;
  declaration_date: string | null;
  incident_begin_date: string | null;
  response_deployed: boolean;
  response_deployed_at: string | null;
}

interface DeployResult {
  declarationId: string;
  orgId: string;
  matchedFunds: number;
  alertCreated: boolean;
}

interface EmergencyFund {
  name: string;
  funder: string;
  typicalAmount: string;
  applyUrl: string;
}

const EMERGENCY_FUNDS: EmergencyFund[] = [
  {
    name: "FEMA BRIC",
    funder: "Building Resilient Infrastructure and Communities (FEMA)",
    typicalAmount: "$1M – $50M mitigation grants",
    applyUrl: "https://www.fema.gov/grants/mitigation/building-resilient-infrastructure-communities",
  },
  {
    name: "HUD CDBG-DR",
    funder: "Community Development Block Grant – Disaster Recovery (HUD)",
    typicalAmount: "Varies by congressional appropriation",
    applyUrl: "https://www.hud.gov/cdbg-dr",
  },
  {
    name: "SBA Disaster Loans",
    funder: "U.S. Small Business Administration",
    typicalAmount: "Up to $2M (business), up to $500K (nonprofit real estate)",
    applyUrl: "https://www.sba.gov/funding-programs/disaster-assistance",
  },
  {
    name: "Red Cross Partnership",
    funder: "American Red Cross",
    typicalAmount: "Varies by disaster scale",
    applyUrl: "https://www.redcross.org/about-us/our-work/disaster-relief/how-red-cross-helps-after-disaster/partner-with-us.html",
  },
  {
    name: "Texas GLO Disaster Recovery",
    funder: "Texas General Land Office",
    typicalAmount: "Varies by allocation",
    applyUrl: "https://recovery.texas.gov/",
  },
  {
    name: "USDA Rural Development Emergency",
    funder: "U.S. Department of Agriculture",
    typicalAmount: "Varies by program",
    applyUrl: "https://www.rd.usda.gov/programs-services/all-programs/emergency-programs",
  },
  {
    name: "SBA Economic Injury Disaster Loans",
    funder: "U.S. Small Business Administration",
    typicalAmount: "Up to $2M working capital",
    applyUrl: "https://www.sba.gov/funding-programs/disaster-assistance/economic-injury-disaster-loans",
  },
  {
    name: "FEMA Hazard Mitigation Grant Program",
    funder: "Federal Emergency Management Agency",
    typicalAmount: "Up to 75% of eligible mitigation costs",
    applyUrl: "https://www.fema.gov/grants/mitigation/hazard-mitigation",
  },
];

function isMajorDisaster(disasterType: string | null): boolean {
  return (disasterType ?? "").toLowerCase().includes("major");
}

function severityColor(disasterType: string | null): string {
  return isMajorDisaster(disasterType) ? "#DC2626" : "#EA580C";
}

function formatDate(value: string | null): string {
  if (!value) return "Date unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", { dateStyle: "medium" });
}

export default function DisasterResponsePage() {
  const { profile } = useProfile();
  const editable = canEdit(profile?.role);

  const [declarations, setDeclarations] = useState<DisasterDeclaration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pollWarning, setPollWarning] = useState<string | null>(null);

  const [deploying, setDeploying] = useState<Set<string>>(new Set());
  const [deployResults, setDeployResults] = useState<Record<string, DeployResult>>({});
  const [deployErrors, setDeployErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      setPollWarning(null);
      try {
        const res = await fetch("/api/agents/disaster");
        const payload = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok) {
          setError((payload as { error?: string }).error ?? "Could not load disaster declarations.");
          return;
        }
        const body = payload as { declarations?: DisasterDeclaration[]; pollWarning?: string | null };
        setDeclarations(body.declarations ?? []);
        setPollWarning(body.pollWarning ?? null);
      } catch {
        if (active) setError("Could not reach the disaster response service.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function handleDeploy(declarationId: string) {
    setDeploying((prev) => new Set(prev).add(declarationId));
    setDeployErrors((prev) => {
      const next = { ...prev };
      delete next[declarationId];
      return next;
    });

    try {
      const res = await fetch("/api/agents/disaster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ declarationId }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDeployErrors((prev) => ({
          ...prev,
          [declarationId]: (payload as { error?: string }).error ?? "Deployment failed.",
        }));
        return;
      }
      const result = payload as DeployResult;
      setDeployResults((prev) => ({ ...prev, [declarationId]: result }));
      setDeclarations((prev) =>
        prev.map((d) =>
          d.id === declarationId
            ? { ...d, response_deployed: true, response_deployed_at: new Date().toISOString() }
            : d,
        ),
      );
    } catch {
      setDeployErrors((prev) => ({
        ...prev,
        [declarationId]: "Could not reach the disaster response service.",
      }));
    } finally {
      setDeploying((prev) => {
        const next = new Set(prev);
        next.delete(declarationId);
        return next;
      });
    }
  }

  const showEmpty = !loading && !error && declarations.length === 0;

  return (
    <div className="min-h-screen space-y-8 bg-[#EEF2F7] p-6 page-bg">
      <PageHeader
        title="Disaster Response"
        description="Live FEMA disaster declarations matched against emergency funding sources for affected nonprofits."
      />

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {!error && pollWarning && (
        <div
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          {pollWarning}
        </div>
      )}

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Live Declarations</h2>

        {loading ? (
          <div className="flex items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white py-12 text-sm text-slate-500">
            Loading FEMA declarations...
          </div>
        ) : showEmpty ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-6 py-14 text-center">
            <MapPin className="h-16 w-16 text-slate-300" aria-hidden />
            <h3 className="mt-4 text-sm font-semibold text-slate-900">
              No active declarations in your area
            </h3>
            <p className="mt-1 max-w-sm text-sm text-slate-500">
              Benavora checks FEMA for new disaster declarations every time this page loads.
              You&apos;ll see them here as soon as one is issued.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {declarations.map((declaration) => {
              const color = severityColor(declaration.disaster_type);
              const result = deployResults[declaration.id];
              const deployError = deployErrors[declaration.id];
              const isDeploying = deploying.has(declaration.id);

              return (
                <div
                  key={declaration.id}
                  className="flex flex-col overflow-hidden rounded-xl border border-border bg-white shadow-sm"
                >
                  <div className="h-1.5 w-full" style={{ backgroundColor: color }} aria-hidden />
                  <div className="flex flex-1 flex-col gap-3 p-5">
                    <div className="flex items-start justify-between gap-2">
                      <span
                        className="rounded-full px-2.5 py-1 text-xs font-semibold"
                        style={{ backgroundColor: `${color}1A`, color }}
                      >
                        {declaration.disaster_type ?? "Declaration"}
                      </span>
                      <span className="text-xs text-slate-400">#{declaration.fema_disaster_number}</span>
                    </div>

                    <div>
                      <p className="text-sm font-medium text-slate-800">
                        {declaration.incident_type ?? "Incident type unknown"}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Declared {formatDate(declaration.declaration_date)}
                      </p>
                    </div>

                    {declaration.affected_states && declaration.affected_states.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {declaration.affected_states.map((state) => (
                          <span
                            key={state}
                            className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"
                          >
                            {state}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="mt-auto pt-2">
                      {declaration.response_deployed || result ? (
                        <div className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                          <span>
                            Response deployed
                            {result ? ` — ${result.matchedFunds} matching fund${result.matchedFunds !== 1 ? "s" : ""} found.` : "."}
                          </span>
                        </div>
                      ) : editable ? (
                        <Button
                          variant="primary"
                          size="sm"
                          fullWidth
                          isLoading={isDeploying}
                          onClick={() => handleDeploy(declaration.id)}
                        >
                          Deploy Response
                        </Button>
                      ) : null}
                      {deployError && (
                        <p className="mt-2 text-xs text-red-600">{deployError}</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Emergency Funding Database</h2>
          <p className="text-sm text-slate-500">
            Standing sources of disaster and emergency funding, independent of any active declaration.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {EMERGENCY_FUNDS.map((fund) => (
            <div
              key={fund.name}
              className="flex flex-col justify-between rounded-xl border border-border bg-white p-4 shadow-sm"
            >
              <div>
                <h3 className="text-sm font-semibold text-slate-900">{fund.name}</h3>
                <p className="mt-1 text-xs text-slate-500">{fund.funder}</p>
                <p className="mt-2 text-xs font-medium text-slate-700">{fund.typicalAmount}</p>
              </div>
              <a
                href={fund.applyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-[#0077B6] hover:underline"
              >
                Apply
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            </div>
          ))}
        </div>
      </section>

      {!loading &&
        declarations.some((d) => isMajorDisaster(d.disaster_type) && !d.response_deployed) && (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            One or more major disaster declarations have no response deployed yet.
          </div>
        )}
    </div>
  );
}
