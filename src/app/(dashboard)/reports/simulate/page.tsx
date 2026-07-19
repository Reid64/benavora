"use client";

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import {
  AlertTriangle,
  Eye,
  Handshake,
  Loader2,
  MapPin,
  Sparkles,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react";

// AG-37 Simulation Agent UI (AUTONOMOUS_PLATFORM_VISION.md Phase 4,
// "Predictive Fundraising Simulator"). Talks to /api/reports/simulate, which
// wraps src/lib/agents/simulation-agent.ts's SimulationAgent. Every color in
// this page is an inline hex value per BLUEPRINT_v2.md §7.5 — no CSS
// variables, no Tailwind color classes.

type ScenarioType =
  | "board_expansion"
  | "staff_hire"
  | "geographic_expansion"
  | "new_program"
  | "budget_increase"
  | "partnership";

interface ProjectionDetail {
  reasoning: string | null;
  year_1: number | null;
  year_2: number | null;
  year_3: number | null;
}

interface SimulationScenario {
  id: string;
  scenario_name: string;
  scenario_type: ScenarioType;
  variables: Record<string, unknown> & { projection_detail?: ProjectionDetail };
  projected_revenue: number | null;
  projected_grants: number | null;
  probability_improvement: number | null;
  cost_estimate: number | null;
  roi_multiple: number | null;
  payback_months: number | null;
  risk_factors: string[] | null;
  confidence: "high" | "medium" | "low" | null;
  generated_at: string;
}

interface ScenarioConfig {
  key: ScenarioType;
  label: string;
  color: string;
  icon: typeof Users;
}

const SCENARIOS: ScenarioConfig[] = [
  { key: "board_expansion", label: "Board Expansion", color: "#0077B6", icon: Users },
  { key: "staff_hire", label: "Staff Hire", color: "#10B981", icon: UserPlus },
  { key: "geographic_expansion", label: "Geographic Expansion", color: "#F59E0B", icon: MapPin },
  { key: "new_program", label: "New Program", color: "#8B5CF6", icon: Sparkles },
  { key: "budget_increase", label: "Budget Increase", color: "#00B4D8", icon: TrendingUp },
  { key: "partnership", label: "Partnership", color: "#EF4444", icon: Handshake },
];

const SECTOR_OPTIONS = ["corporate", "legal", "finance", "nonprofit"];
const STAFF_ROLE_OPTIONS = ["grant writer", "development director", "program manager"];

const CONFIDENCE_COLOR: Record<string, string> = {
  high: "#10B981",
  medium: "#F59E0B",
  low: "#EF4444",
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

function formatCurrency(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function scenarioConfig(type: ScenarioType): ScenarioConfig {
  return SCENARIOS.find((s) => s.key === type) ?? SCENARIOS[0]!;
}

export default function SimulatorPage() {
  const [scenarioType, setScenarioType] = useState<ScenarioType>("board_expansion");

  // Board Expansion
  const [numBoardMembers, setNumBoardMembers] = useState(3);
  const [expectedSectors, setExpectedSectors] = useState<string[]>([]);

  // Staff Hire
  const [staffRole, setStaffRole] = useState(STAFF_ROLE_OPTIONS[0]!);
  const [salaryMin, setSalaryMin] = useState("");
  const [salaryMax, setSalaryMax] = useState("");

  // Geographic Expansion
  const [targetLocation, setTargetLocation] = useState("");
  const [distanceMiles, setDistanceMiles] = useState(50);

  // New Program
  const [programType, setProgramType] = useState("");
  const [targetPopulation, setTargetPopulation] = useState("");
  const [estimatedParticipants, setEstimatedParticipants] = useState("");

  // Budget Increase
  const [budgetIncreasePercent, setBudgetIncreasePercent] = useState(10);

  // Partnership
  const [partnerOrgName, setPartnerOrgName] = useState("");
  const [partnershipType, setPartnershipType] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SimulationScenario | null>(null);
  const [pastSimulations, setPastSimulations] = useState<SimulationScenario[]>([]);
  const [loadingPast, setLoadingPast] = useState(true);

  const loadPastSimulations = useCallback(async () => {
    setLoadingPast(true);
    try {
      const res = await fetch("/api/reports/simulate", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { scenarios: SimulationScenario[] };
        setPastSimulations(data.scenarios ?? []);
      }
    } catch {
      // Non-fatal — the list simply stays empty.
    } finally {
      setLoadingPast(false);
    }
  }, []);

  useEffect(() => {
    void loadPastSimulations();
  }, [loadPastSimulations]);

  function buildVariables(): Record<string, unknown> {
    switch (scenarioType) {
      case "board_expansion":
        return { numBoardMembers, expectedSectors };
      case "staff_hire":
        return {
          role: staffRole,
          salaryMin: salaryMin ? Number(salaryMin) : null,
          salaryMax: salaryMax ? Number(salaryMax) : null,
        };
      case "geographic_expansion":
        return { targetLocation, distanceMiles };
      case "new_program":
        return {
          programType,
          targetPopulation,
          estimatedParticipants: estimatedParticipants ? Number(estimatedParticipants) : null,
        };
      case "budget_increase":
        return { budgetIncreasePercent };
      case "partnership":
        return { partnerOrgName, partnershipType };
      default:
        return {};
    }
  }

  async function runSimulation() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/reports/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioType, variables: buildVariables() }),
      });
      const data = (await res.json()) as { scenario?: SimulationScenario; error?: string };
      if (!res.ok || !data.scenario) {
        setError(data.error ?? "Simulation failed. Please try again.");
        return;
      }
      setResult(data.scenario);
      void loadPastSimulations();
    } catch {
      setError("Network error running the simulation.");
    } finally {
      setLoading(false);
    }
  }

  function toggleSector(sector: string) {
    setExpectedSectors((prev) =>
      prev.includes(sector) ? prev.filter((s) => s !== sector) : [...prev, sector],
    );
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
          Fundraising Simulator
        </h1>
        <p style={{ fontSize: "14px", color: "#64748B", marginTop: "6px" }}>
          Model the financial impact of strategic decisions.
        </p>
      </div>

      {/* Scenario Builder */}
      <div
        style={{
          backgroundColor: "#FFFFFF",
          borderRadius: "14px",
          padding: "28px",
          boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
          marginBottom: "28px",
        }}
      >
        <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#0F172A", marginBottom: "16px" }}>
          Scenario Builder
        </h2>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
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
                onClick={() => setScenarioType(s.key)}
                style={{
                  display: "flex",
                  alignItems: "center",
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
                <span style={{ fontSize: "13px", fontWeight: 700, color: "#0F172A" }}>
                  {s.label}
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ borderTop: "1px solid #E2E8F0", paddingTop: "20px" }}>
          {scenarioType === "board_expansion" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
              <div>
                <label style={labelStyle}>
                  How many board members? <strong>{numBoardMembers}</strong>
                </label>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={numBoardMembers}
                  onChange={(e) => setNumBoardMembers(Number(e.target.value))}
                  style={{ width: "100%", accentColor: "#8B5CF6" }}
                />
              </div>
              <div>
                <label style={labelStyle}>Expected sectors</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "8px" }}>
                  {SECTOR_OPTIONS.map((sector) => {
                    const active = expectedSectors.includes(sector);
                    return (
                      <button
                        key={sector}
                        type="button"
                        onClick={() => toggleSector(sector)}
                        style={{
                          padding: "6px 14px",
                          borderRadius: "999px",
                          border: active ? "2px solid #8B5CF6" : "1px solid #B8C9D9",
                          backgroundColor: active ? "#8B5CF61A" : "#FFFFFF",
                          fontSize: "12px",
                          fontWeight: 600,
                          color: "#0F172A",
                          textTransform: "capitalize",
                          cursor: "pointer",
                        }}
                      >
                        {sector}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {scenarioType === "staff_hire" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
              <div>
                <label style={labelStyle}>Role</label>
                <select
                  value={staffRole}
                  onChange={(e) => setStaffRole(e.target.value)}
                  style={inputStyle}
                >
                  {STAFF_ROLE_OPTIONS.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: "flex", gap: "16px" }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Salary min</label>
                  <input
                    type="number"
                    value={salaryMin}
                    onChange={(e) => setSalaryMin(e.target.value)}
                    placeholder="45000"
                    style={inputStyle}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Salary max</label>
                  <input
                    type="number"
                    value={salaryMax}
                    onChange={(e) => setSalaryMax(e.target.value)}
                    placeholder="65000"
                    style={inputStyle}
                  />
                </div>
              </div>
            </div>
          )}

          {scenarioType === "geographic_expansion" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
              <div>
                <label style={labelStyle}>Target city/state</label>
                <input
                  type="text"
                  value={targetLocation}
                  onChange={(e) => setTargetLocation(e.target.value)}
                  placeholder="Lubbock, TX"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>
                  Distance from current area <strong>{distanceMiles} mi</strong>
                </label>
                <input
                  type="range"
                  min={0}
                  max={500}
                  step={10}
                  value={distanceMiles}
                  onChange={(e) => setDistanceMiles(Number(e.target.value))}
                  style={{ width: "100%", accentColor: "#8B5CF6" }}
                />
              </div>
            </div>
          )}

          {scenarioType === "new_program" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
              <div>
                <label style={labelStyle}>Program type</label>
                <input
                  type="text"
                  value={programType}
                  onChange={(e) => setProgramType(e.target.value)}
                  placeholder="Emergency rental assistance"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Target population</label>
                <input
                  type="text"
                  value={targetPopulation}
                  onChange={(e) => setTargetPopulation(e.target.value)}
                  placeholder="Families facing eviction"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Estimated participants</label>
                <input
                  type="number"
                  value={estimatedParticipants}
                  onChange={(e) => setEstimatedParticipants(e.target.value)}
                  placeholder="150"
                  style={inputStyle}
                />
              </div>
            </div>
          )}

          {scenarioType === "budget_increase" && (
            <div>
              <label style={labelStyle}>
                Budget increase <strong>{budgetIncreasePercent}%</strong>
              </label>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={budgetIncreasePercent}
                onChange={(e) => setBudgetIncreasePercent(Number(e.target.value))}
                style={{ width: "100%", accentColor: "#8B5CF6" }}
              />
            </div>
          )}

          {scenarioType === "partnership" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
              <div>
                <label style={labelStyle}>Partner organization</label>
                <input
                  type="text"
                  value={partnerOrgName}
                  onChange={(e) => setPartnerOrgName(e.target.value)}
                  placeholder="Name of prospective partner org"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Partnership type</label>
                <input
                  type="text"
                  value={partnershipType}
                  onChange={(e) => setPartnershipType(e.target.value)}
                  placeholder="Joint program, shared grant application, referral network..."
                  style={inputStyle}
                />
              </div>
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
            backgroundColor: "#8B5CF6",
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
      <div
        style={{
          backgroundColor: "#FFFFFF",
          borderRadius: "14px",
          padding: "28px",
          boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
        }}
      >
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
            {pastSimulations.map((sim) => (
              <div
                key={sim.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "16px",
                  padding: "14px 16px",
                  borderRadius: "10px",
                  border: "1px solid #E2E8F0",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p
                    style={{
                      fontSize: "14px",
                      fontWeight: 700,
                      color: "#0F172A",
                      margin: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {sim.scenario_name}
                  </p>
                  <p style={{ fontSize: "12px", color: "#64748B", margin: "4px 0 0" }}>
                    {new Date(sim.generated_at).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                </div>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    color: "#FFFFFF",
                    backgroundColor: scenarioConfig(sim.scenario_type).color,
                    padding: "4px 10px",
                    borderRadius: "999px",
                    whiteSpace: "nowrap",
                  }}
                >
                  {scenarioConfig(sim.scenario_type).label}
                </span>
                <span
                  style={{
                    fontSize: "14px",
                    fontWeight: 700,
                    color: "#10B981",
                    minWidth: "100px",
                    textAlign: "right",
                  }}
                >
                  {formatCurrency(sim.projected_revenue)}
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
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ResultsPanel({ result }: { result: SimulationScenario }) {
  const detail = result.variables.projection_detail;
  const year1 = detail?.year_1 ?? 0;
  const year2 = detail?.year_2 ?? 0;
  const year3 = detail?.year_3 ?? 0;
  const maxYear = Math.max(year1, year2, year3, 1);
  const confidence = result.confidence ?? "low";
  const riskFactors = result.risk_factors ?? [];

  const bars = [
    { label: "Year 1", value: year1, color: "#0077B6" },
    { label: "Year 2", value: year2, color: "#00B4D8" },
    { label: "Year 3", value: year3, color: "#8B5CF6" },
  ];
  const barWidth = 80;
  const gap = 40;
  const chartHeight = 160;

  return (
    <div
      style={{
        backgroundColor: "#FFFFFF",
        borderRadius: "14px",
        padding: "28px",
        boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
        marginBottom: "28px",
      }}
    >
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
        <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#0F172A", margin: 0 }}>
          {result.scenario_name}
        </h2>
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
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: "16px",
          marginBottom: "28px",
        }}
      >
        <div>
          <p
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "#64748B",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              margin: 0,
            }}
          >
            Revenue Projection
          </p>
          <p style={{ fontSize: "32px", fontWeight: 900, color: "#10B981", margin: "4px 0 0" }}>
            {formatCurrency(result.projected_revenue)}
          </p>
        </div>
        <div>
          <p
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "#64748B",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              margin: 0,
            }}
          >
            Probability Improvement
          </p>
          <span
            style={{
              display: "inline-block",
              marginTop: "6px",
              fontSize: "16px",
              fontWeight: 800,
              color: "#FFFFFF",
              backgroundColor: "#0077B6",
              padding: "4px 12px",
              borderRadius: "8px",
            }}
          >
            {result.probability_improvement != null ? `+${result.probability_improvement}%` : "—"}
          </span>
        </div>
        <div>
          <p
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "#64748B",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              margin: 0,
            }}
          >
            ROI Multiple
          </p>
          <span
            style={{
              display: "inline-block",
              marginTop: "6px",
              fontSize: "16px",
              fontWeight: 800,
              color: "#FFFFFF",
              backgroundColor: "#8B5CF6",
              padding: "4px 12px",
              borderRadius: "8px",
            }}
          >
            {result.roi_multiple != null ? `${result.roi_multiple}x` : "—"}
          </span>
        </div>
        <div>
          <p
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "#64748B",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              margin: 0,
            }}
          >
            Payback Period
          </p>
          <p style={{ fontSize: "20px", fontWeight: 800, color: "#0F172A", margin: "6px 0 0" }}>
            {result.payback_months != null ? `${result.payback_months} months` : "—"}
          </p>
        </div>
      </div>

      <div style={{ marginBottom: "28px" }}>
        <p
          style={{
            fontSize: "11px",
            fontWeight: 700,
            color: "#64748B",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: "12px",
          }}
        >
          3-Year Projection
        </p>
        <svg
          width={bars.length * (barWidth + gap)}
          height={chartHeight + 40}
          role="img"
          aria-label="3-year revenue projection bar chart"
        >
          {bars.map((bar, i) => {
            const barHeight = maxYear > 0 ? Math.max(4, (bar.value / maxYear) * chartHeight) : 4;
            const x = i * (barWidth + gap) + gap / 2;
            const y = chartHeight - barHeight;
            return (
              <g key={bar.label}>
                <rect x={x} y={y} width={barWidth} height={barHeight} rx={6} fill={bar.color} />
                <text
                  x={x + barWidth / 2}
                  y={y - 8}
                  textAnchor="middle"
                  fontSize="12"
                  fontWeight={700}
                  fill="#0F172A"
                >
                  {formatCurrency(bar.value)}
                </text>
                <text
                  x={x + barWidth / 2}
                  y={chartHeight + 20}
                  textAnchor="middle"
                  fontSize="12"
                  fontWeight={600}
                  fill="#64748B"
                >
                  {bar.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div style={{ marginBottom: "20px" }}>
        <p
          style={{
            fontSize: "11px",
            fontWeight: 700,
            color: "#64748B",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: "10px",
          }}
        >
          Risk Factors
        </p>
        {riskFactors.length === 0 ? (
          <p style={{ fontSize: "13px", color: "#64748B" }}>No significant risks identified.</p>
        ) : (
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: "none",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            {riskFactors.map((risk, i) => (
              <li
                key={i}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "8px",
                  fontSize: "13px",
                  color: "#0F172A",
                }}
              >
                <AlertTriangle
                  size={16}
                  color="#F59E0B"
                  style={{ flexShrink: 0, marginTop: "2px" }}
                />
                <span>{risk}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {detail?.reasoning && (
        <p
          style={{
            fontSize: "13px",
            fontStyle: "italic",
            color: "#475569",
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          {detail.reasoning}
        </p>
      )}
    </div>
  );
}
