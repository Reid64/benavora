"use client";

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import {
  AlertTriangle,
  Eye,
  Loader2,
  Scissors,
  ShieldAlert,
  Sparkles,
  TrendingDown,
  UserPlus,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";

// AG-41 Impact Simulation Agent UI (AGENTS_v2.md §5, AG-41 — renumbered from
// AG-28 2026-08-02). Talks to /api/agents/simulate ONLY — do not confuse
// with the different, already-BUILT AG-37 Predictive Fundraising Simulator
// at /reports/simulate (backed by /api/reports/simulate, a different agent
// and a different table, simulation_scenarios). This page reads/writes
// impact_simulations via AG-41's ImpactSimulationAgent.
//
// Layout/styling conventions (card shell, header, confidence badge colors)
// deliberately match /reports/simulate and /reports/roi — the two real
// scenario-builder-plus-results pages already in this codebase. Every color
// is an inline hex value per BLUEPRINT_v2.md §7.5 — no Tailwind color
// classes, no CSS variables.
//
// scenario_type/scenario_params shape and the 4 real SCENARIO_TYPES come
// directly from src/app/api/agents/simulate/route.ts's own
// validateScenarioParams() — one form per scenario type, collecting only
// its real required fields, no generic free-form JSON box.
//
// "Past Simulations" reads impact_simulations directly via the RLS-scoped
// client (no GET route exists on /api/agents/simulate — it's POST-only),
// the same direct-client-read pattern already used elsewhere in this
// codebase (e.g. src/app/(dashboard)/funders/page.tsx) when no dedicated
// list API exists.

type ScenarioType =
  | "lose_funder"
  | "gain_funder"
  | "program_expansion"
  | "budget_cut";

interface DeterministicImpact {
  min: number;
  max: number;
  mostLikely: number;
}

interface ExposedProgram {
  programName: string;
  reasoning: string;
}

interface SimulationResult {
  baselineUsed: "forecast" | "fallback";
  deterministicImpact: DeterministicImpact;
  keyRisks: string[];
  keyOpportunities: string[];
  narrative: string;
  exposedPrograms?: ExposedProgram[];
  narrativeUnavailable?: string;
}

interface ImpactSimulation {
  id: string;
  org_id: string;
  scenario_type: ScenarioType;
  scenario_params: Record<string, unknown>;
  simulation_result: SimulationResult;
  confidence: "high" | "medium" | "low" | null;
  created_by: string | null;
  generated_at?: string;
  created_at?: string;
}

interface ScenarioConfig {
  key: ScenarioType;
  label: string;
  description: string;
  color: string;
  icon: typeof TrendingDown;
}

const SCENARIOS: ScenarioConfig[] = [
  {
    key: "lose_funder",
    label: "Lose a Funder",
    description: "Model the impact of losing a specific funder on file.",
    color: "#EF4444",
    icon: TrendingDown,
  },
  {
    key: "gain_funder",
    label: "Gain a Funder",
    description: "Model a new funder at an estimated annual amount.",
    color: "#10B981",
    icon: UserPlus,
  },
  {
    key: "program_expansion",
    label: "Program Expansion",
    description: "Model launching a new program with added staff.",
    color: "#8B5CF6",
    icon: Sparkles,
  },
  {
    key: "budget_cut",
    label: "Budget Cut",
    description: "Model a percentage cut against your funding baseline.",
    color: "#F59E0B",
    icon: Scissors,
  },
];

const CONFIDENCE_COLOR: Record<string, string> = {
  high: "#10B981",
  medium: "#F59E0B",
  low: "#EF4444",
};

const cardStyle: CSSProperties = {
  backgroundColor: "#FFFFFF",
  borderRadius: "14px",
  padding: "28px",
  boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
};

const sectionLabelStyle: CSSProperties = {
  fontSize: "11px",
  fontWeight: 700,
  color: "#64748B",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  margin: 0,
};

const labelStyle: CSSProperties = {
  display: "block",
  fontSize: "12px",
  fontWeight: 700,
  color: "#334155",
  marginBottom: "8px",
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: "8px",
  border: "1px solid #B8C9D9",
  fontSize: "14px",
  color: "#0F172A",
  backgroundColor: "#FFFFFF",
};

function scenarioConfig(type: ScenarioType): ScenarioConfig {
  return SCENARIOS.find((s) => s.key === type) ?? SCENARIOS[0]!;
}

function formatCurrency(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

interface FunderOption {
  id: string;
  name: string;
}

export default function ImpactSimulatorPage() {
  const [scenarioType, setScenarioType] = useState<ScenarioType>("lose_funder");

  // lose_funder
  const [funders, setFunders] = useState<FunderOption[]>([]);
  const [fundersLoading, setFundersLoading] = useState(true);
  const [funderId, setFunderId] = useState("");

  // gain_funder
  const [estimatedAnnualAmount, setEstimatedAnnualAmount] = useState("");

  // program_expansion
  const [newProgramAnnualBudget, setNewProgramAnnualBudget] = useState("");
  const [additionalStaffCount, setAdditionalStaffCount] = useState("");

  // budget_cut
  const [cutPercentage, setCutPercentage] = useState(10);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImpactSimulation | null>(null);

  const [pastSimulations, setPastSimulations] = useState<ImpactSimulation[]>([]);
  const [loadingPast, setLoadingPast] = useState(true);

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    (async () => {
      setFundersLoading(true);
      const { data } = await supabase
        .from("funders")
        .select("id, name")
        .order("name", { ascending: true })
        .limit(500);
      if (!active) return;
      setFunders((data ?? []) as FunderOption[]);
      setFundersLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const loadPastSimulations = useCallback(async () => {
    setLoadingPast(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("impact_simulations")
      .select("id, org_id, scenario_type, scenario_params, simulation_result, confidence, created_by, generated_at")
      .order("generated_at", { ascending: false })
      .limit(20);
    setPastSimulations((data ?? []) as ImpactSimulation[]);
    setLoadingPast(false);
  }, []);

  useEffect(() => {
    void loadPastSimulations();
  }, [loadPastSimulations]);

  function buildParams(): { params: Record<string, unknown>; clientError: string | null } {
    switch (scenarioType) {
      case "lose_funder":
        if (!funderId) {
          return { params: {}, clientError: "Select a funder to model losing." };
        }
        return { params: { funderId }, clientError: null };
      case "gain_funder": {
        const amount = Number(estimatedAnnualAmount);
        if (!estimatedAnnualAmount || !Number.isFinite(amount) || amount <= 0) {
          return { params: {}, clientError: "Enter a positive estimated annual amount." };
        }
        return { params: { estimatedAnnualAmount: amount }, clientError: null };
      }
      case "program_expansion": {
        const budget = Number(newProgramAnnualBudget);
        const staff = Number(additionalStaffCount);
        if (!newProgramAnnualBudget || !Number.isFinite(budget) || budget <= 0) {
          return { params: {}, clientError: "Enter a positive new program annual budget." };
        }
        if (additionalStaffCount === "" || !Number.isFinite(staff) || staff < 0) {
          return { params: {}, clientError: "Enter a non-negative additional staff count." };
        }
        return {
          params: { newProgramAnnualBudget: budget, additionalStaffCount: staff },
          clientError: null,
        };
      }
      case "budget_cut":
        if (cutPercentage <= 0 || cutPercentage > 100) {
          return { params: {}, clientError: "Cut percentage must be in (0, 100]." };
        }
        return { params: { cutPercentage }, clientError: null };
    }
  }

  async function runSimulation() {
    const { params, clientError } = buildParams();
    if (clientError) {
      setError(clientError);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/agents/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario_type: scenarioType, scenario_params: params }),
      });
      const data = (await res.json()) as { simulation?: ImpactSimulation; error?: string };
      if (!res.ok || !data.simulation) {
        setError(data.error ?? "Simulation failed. Please try again.");
        return;
      }
      setResult(data.simulation);
      void loadPastSimulations();
    } catch {
      setError("Network error running the simulation.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ backgroundColor: "#D6E4F0", minHeight: "100%", padding: "32px" }}>
      <div style={{ marginBottom: "28px" }}>
        <h1
          style={{
            fontSize: "28px",
            fontWeight: 800,
            color: "#0F172A",
            letterSpacing: "-0.02em",
            margin: 0,
          }}
        >
          Impact Simulator
        </h1>
        <p style={{ fontSize: "14px", color: "#64748B", marginTop: "6px" }}>
          Model what-if strategic scenarios grounded in your real funding data before making a
          decision.
        </p>
      </div>

      {/* Scenario Builder */}
      <div style={{ ...cardStyle, marginBottom: "28px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#0F172A", marginBottom: "16px" }}>
          Scenario Builder
        </h2>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: "12px",
            marginBottom: "24px",
          }}
        >
          {SCENARIOS.map((s) => {
            const active = scenarioType === s.key;
            const Icon = s.icon;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => {
                  setScenarioType(s.key);
                  setError(null);
                }}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "10px",
                  padding: "14px 16px",
                  borderRadius: "10px",
                  border: active ? `2px solid ${s.color}` : "1px solid #B8C9D9",
                  backgroundColor: active ? `${s.color}1A` : "#FFFFFF",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "32px",
                    height: "32px",
                    borderRadius: "8px",
                    backgroundColor: s.color,
                    flexShrink: 0,
                  }}
                >
                  <Icon size={16} color="#FFFFFF" />
                </span>
                <span>
                  <span
                    style={{
                      display: "block",
                      fontSize: "13px",
                      fontWeight: 700,
                      color: "#0F172A",
                    }}
                  >
                    {s.label}
                  </span>
                  <span style={{ display: "block", fontSize: "11px", color: "#64748B", marginTop: "2px" }}>
                    {s.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ borderTop: "1px solid #E2E8F0", paddingTop: "20px" }}>
          {scenarioType === "lose_funder" && (
            <div>
              <label style={labelStyle}>Funder</label>
              {fundersLoading ? (
                <p style={{ fontSize: "13px", color: "#64748B" }}>Loading funders...</p>
              ) : funders.length === 0 ? (
                <p style={{ fontSize: "13px", color: "#64748B" }}>
                  No funders on file yet. Add a funder before running this scenario.
                </p>
              ) : (
                <select
                  value={funderId}
                  onChange={(e) => setFunderId(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">Select a funder...</option>
                  {funders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {scenarioType === "gain_funder" && (
            <div>
              <label style={labelStyle}>Estimated annual amount ($)</label>
              <input
                type="number"
                min={1}
                value={estimatedAnnualAmount}
                onChange={(e) => setEstimatedAnnualAmount(e.target.value)}
                placeholder="50000"
                style={inputStyle}
              />
              <p style={{ fontSize: "12px", color: "#94A3B8", marginTop: "8px" }}>
                This scenario has no real funder on file to derive numbers from — it always runs at
                low confidence and is automatically flagged for human review.
              </p>
            </div>
          )}

          {scenarioType === "program_expansion" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
              <div>
                <label style={labelStyle}>New program annual budget ($)</label>
                <input
                  type="number"
                  min={1}
                  value={newProgramAnnualBudget}
                  onChange={(e) => setNewProgramAnnualBudget(e.target.value)}
                  placeholder="120000"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Additional staff count</label>
                <input
                  type="number"
                  min={0}
                  value={additionalStaffCount}
                  onChange={(e) => setAdditionalStaffCount(e.target.value)}
                  placeholder="2"
                  style={inputStyle}
                />
              </div>
            </div>
          )}

          {scenarioType === "budget_cut" && (
            <div>
              <label style={labelStyle}>
                Cut percentage <strong>{cutPercentage}%</strong>
              </label>
              <input
                type="range"
                min={1}
                max={100}
                step={1}
                value={cutPercentage}
                onChange={(e) => setCutPercentage(Number(e.target.value))}
                style={{ width: "100%", accentColor: "#F59E0B" }}
              />
            </div>
          )}
        </div>

        {error && <p style={{ color: "#EF4444", fontSize: "13px", marginTop: "16px" }}>{error}</p>}

        <button
          type="button"
          onClick={() => void runSimulation()}
          disabled={loading}
          style={{
            marginTop: "24px",
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            backgroundColor: scenarioConfig(scenarioType).color,
            color: "#FFFFFF",
            fontSize: "14px",
            fontWeight: 700,
            padding: "12px 24px",
            borderRadius: "10px",
            border: "none",
            cursor: loading ? "default" : "pointer",
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading && <Loader2 size={16} className="animate-spin" />}
          {loading ? "Running Simulation..." : "Run Simulation"}
        </button>
      </div>

      {result && <ResultsPanel result={result} />}

      {/* Past Simulations */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#0F172A", marginBottom: "16px" }}>
          Past Simulations
        </h2>
        {loadingPast ? (
          <p style={{ fontSize: "13px", color: "#64748B" }}>Loading...</p>
        ) : pastSimulations.length === 0 ? (
          <p style={{ fontSize: "13px", color: "#64748B" }}>
            No simulations yet. Run one above to see it here.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {pastSimulations.map((sim) => {
              const config = scenarioConfig(sim.scenario_type);
              const confidence = sim.confidence ?? "low";
              const generatedAt = sim.generated_at ?? sim.created_at;
              return (
                <div
                  key={sim.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "16px",
                    padding: "14px 16px",
                    borderRadius: "10px",
                    border: "1px solid #E2E8F0",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ flex: 1, minWidth: "160px" }}>
                    <p
                      style={{
                        fontSize: "14px",
                        fontWeight: 700,
                        color: "#0F172A",
                        margin: 0,
                      }}
                    >
                      {config.label}
                    </p>
                    <p style={{ fontSize: "12px", color: "#64748B", margin: "4px 0 0" }}>
                      {generatedAt
                        ? new Date(generatedAt).toLocaleDateString("en-US", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })
                        : "—"}
                    </p>
                  </div>
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      color: "#FFFFFF",
                      backgroundColor: config.color,
                      padding: "4px 10px",
                      borderRadius: "999px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {config.label}
                  </span>
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      color: "#FFFFFF",
                      backgroundColor: CONFIDENCE_COLOR[confidence] ?? "#64748B",
                      padding: "4px 10px",
                      borderRadius: "999px",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {confidence}
                  </span>
                  <span
                    style={{
                      fontSize: "14px",
                      fontWeight: 700,
                      color:
                        sim.simulation_result?.deterministicImpact?.mostLikely >= 0
                          ? "#10B981"
                          : "#EF4444",
                      minWidth: "110px",
                      textAlign: "right",
                    }}
                  >
                    {formatCurrency(sim.simulation_result?.deterministicImpact?.mostLikely)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setResult(sim)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      backgroundColor: "#F1F5F9",
                      color: "#0F172A",
                      fontSize: "12px",
                      fontWeight: 700,
                      padding: "8px 14px",
                      borderRadius: "8px",
                      border: "1px solid #B8C9D9",
                      cursor: "pointer",
                    }}
                  >
                    <Eye size={14} />
                    View
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ResultsPanel({ result }: { result: ImpactSimulation }) {
  const config = scenarioConfig(result.scenario_type);
  const sr = result.simulation_result;
  const confidence = result.confidence ?? "low";
  const impact = sr?.deterministicImpact;
  const isCost = (impact?.mostLikely ?? 0) < 0;
  const requiresHumanReview = confidence === "low";

  return (
    <div style={{ ...cardStyle, marginBottom: "28px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "20px",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "28px",
              height: "28px",
              borderRadius: "8px",
              backgroundColor: config.color,
            }}
          >
            <config.icon size={14} color="#FFFFFF" />
          </span>
          <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#0F172A", margin: 0 }}>
            {config.label}
          </h2>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "#FFFFFF",
              backgroundColor: CONFIDENCE_COLOR[confidence] ?? "#64748B",
              padding: "4px 12px",
              borderRadius: "999px",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            {confidence} confidence
          </span>
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "#334155",
              backgroundColor: "#F1F5F9",
              padding: "4px 12px",
              borderRadius: "999px",
              border: "1px solid #E2E8F0",
            }}
          >
            baseline: {sr?.baselineUsed === "forecast" ? "AG-26 forecast" : "trailing 12-mo outcomes"}
          </span>
        </div>
      </div>

      {requiresHumanReview && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "8px",
            backgroundColor: "#FEF3C7",
            border: "1px solid #FDE68A",
            borderRadius: "10px",
            padding: "12px 14px",
            marginBottom: "20px",
          }}
        >
          <ShieldAlert size={16} color="#B45309" style={{ flexShrink: 0, marginTop: "1px" }} />
          <p style={{ fontSize: "13px", color: "#92400E", margin: 0, lineHeight: 1.5 }}>
            Low-confidence decisions are automatically flagged for human review — never acted on
            autonomously.{" "}
            {result.scenario_type === "gain_funder" &&
              "This is by design for gain_funder: the amount is a human estimate, not real platform data."}
          </p>
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "16px",
          marginBottom: "28px",
        }}
      >
        <div>
          <p style={sectionLabelStyle}>Deterministic Impact (Most Likely)</p>
          <p
            style={{
              fontSize: "32px",
              fontWeight: 900,
              color: isCost ? "#EF4444" : "#10B981",
              margin: "4px 0 0",
            }}
          >
            {formatCurrency(impact?.mostLikely)}
          </p>
        </div>
        <div>
          <p style={sectionLabelStyle}>Range</p>
          <p style={{ fontSize: "16px", fontWeight: 700, color: "#0F172A", margin: "8px 0 0" }}>
            {formatCurrency(impact?.min)} – {formatCurrency(impact?.max)}
          </p>
        </div>
      </div>

      <div style={{ marginBottom: "24px" }}>
        <p style={{ ...sectionLabelStyle, marginBottom: "10px" }}>Key Risks</p>
        {(sr?.keyRisks ?? []).length === 0 ? (
          <p style={{ fontSize: "13px", color: "#64748B" }}>No specific risks identified.</p>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "8px" }}>
            {sr!.keyRisks.map((risk, i) => (
              <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: "8px", fontSize: "13px", color: "#0F172A" }}>
                <AlertTriangle size={16} color="#F59E0B" style={{ flexShrink: 0, marginTop: "2px" }} />
                <span>{risk}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ marginBottom: "24px" }}>
        <p style={{ ...sectionLabelStyle, marginBottom: "10px" }}>Key Opportunities</p>
        {(sr?.keyOpportunities ?? []).length === 0 ? (
          <p style={{ fontSize: "13px", color: "#64748B" }}>No mitigating factors identified.</p>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "8px" }}>
            {sr!.keyOpportunities.map((opp, i) => (
              <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: "8px", fontSize: "13px", color: "#0F172A" }}>
                <Sparkles size={16} color="#10B981" style={{ flexShrink: 0, marginTop: "2px" }} />
                <span>{opp}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {sr?.exposedPrograms && sr.exposedPrograms.length > 0 && (
        <div style={{ marginBottom: "24px" }}>
          <p style={{ ...sectionLabelStyle, marginBottom: "10px" }}>Exposed Programs</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {sr.exposedPrograms.map((p, i) => (
              <div
                key={i}
                style={{
                  backgroundColor: "#FEF2F2",
                  border: "1px solid #FECACA",
                  borderRadius: "10px",
                  padding: "12px 14px",
                }}
              >
                <p style={{ fontSize: "13px", fontWeight: 700, color: "#991B1B", margin: 0 }}>
                  {p.programName}
                </p>
                <p style={{ fontSize: "13px", color: "#7F1D1D", margin: "4px 0 0", lineHeight: 1.5 }}>
                  {p.reasoning}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {sr?.narrativeUnavailable ? (
        <p style={{ fontSize: "13px", color: "#94A3B8", fontStyle: "italic", margin: 0 }}>
          {sr.narrativeUnavailable}
        </p>
      ) : sr?.narrative ? (
        <p style={{ fontSize: "13px", fontStyle: "italic", color: "#475569", lineHeight: 1.6, margin: 0 }}>
          {sr.narrative}
        </p>
      ) : null}
    </div>
  );
}
