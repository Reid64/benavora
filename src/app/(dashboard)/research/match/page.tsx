"use client";

// Keyword-overlap foundation matcher — POSTs a mission statement (plus an
// optional grant-size/state filter) to /api/match/foundations and lists the
// top-scoring foundation_directory records. Distinct from the AI-scored
// /intelligence/matches page: this one is a plain Jaccard keyword match.
//
// Two-panel layout: this page has one real capability (mission -> ranked
// foundations), not two independent features, so "Funder Search" and
// "Semantic Match Engine" are the same flow split across columns — results
// on the left, the mission-driven match form in the dark AI panel on the
// right — rather than a fabricated second, independent browse/filter panel
// (NTEE/asset-range filters aren't supported by /api/match/foundations).

import { useState, type CSSProperties, type FormEvent } from "react";

import { PageHeader } from "@/components/layout/PageHeader";

interface FoundationMatch {
  id: string;
  name: string;
  ein: string;
  asset_amount: number;
  state: string;
  score: number;
  matchReasons: string[];
}

const US_STATES: { value: string; label: string }[] = [
  { value: "", label: "All states" },
  { value: "AL", label: "AL – Alabama" },
  { value: "AK", label: "AK – Alaska" },
  { value: "AZ", label: "AZ – Arizona" },
  { value: "AR", label: "AR – Arkansas" },
  { value: "CA", label: "CA – California" },
  { value: "CO", label: "CO – Colorado" },
  { value: "CT", label: "CT – Connecticut" },
  { value: "DE", label: "DE – Delaware" },
  { value: "DC", label: "DC – Washington D.C." },
  { value: "FL", label: "FL – Florida" },
  { value: "GA", label: "GA – Georgia" },
  { value: "HI", label: "HI – Hawaii" },
  { value: "ID", label: "ID – Idaho" },
  { value: "IL", label: "IL – Illinois" },
  { value: "IN", label: "IN – Indiana" },
  { value: "IA", label: "IA – Iowa" },
  { value: "KS", label: "KS – Kansas" },
  { value: "KY", label: "KY – Kentucky" },
  { value: "LA", label: "LA – Louisiana" },
  { value: "ME", label: "ME – Maine" },
  { value: "MD", label: "MD – Maryland" },
  { value: "MA", label: "MA – Massachusetts" },
  { value: "MI", label: "MI – Michigan" },
  { value: "MN", label: "MN – Minnesota" },
  { value: "MS", label: "MS – Mississippi" },
  { value: "MO", label: "MO – Missouri" },
  { value: "MT", label: "MT – Montana" },
  { value: "NE", label: "NE – Nebraska" },
  { value: "NV", label: "NV – Nevada" },
  { value: "NH", label: "NH – New Hampshire" },
  { value: "NJ", label: "NJ – New Jersey" },
  { value: "NM", label: "NM – New Mexico" },
  { value: "NY", label: "NY – New York" },
  { value: "NC", label: "NC – North Carolina" },
  { value: "ND", label: "ND – North Dakota" },
  { value: "OH", label: "OH – Ohio" },
  { value: "OK", label: "OK – Oklahoma" },
  { value: "OR", label: "OR – Oregon" },
  { value: "PA", label: "PA – Pennsylvania" },
  { value: "RI", label: "RI – Rhode Island" },
  { value: "SC", label: "SC – South Carolina" },
  { value: "SD", label: "SD – South Dakota" },
  { value: "TN", label: "TN – Tennessee" },
  { value: "TX", label: "TX – Texas" },
  { value: "UT", label: "UT – Utah" },
  { value: "VT", label: "VT – Vermont" },
  { value: "VA", label: "VA – Virginia" },
  { value: "WA", label: "WA – Washington" },
  { value: "WV", label: "WV – West Virginia" },
  { value: "WI", label: "WI – Wisconsin" },
  { value: "WY", label: "WY – Wyoming" },
  { value: "PR", label: "PR – Puerto Rico" },
];

function formatAmount(amount: number | null): string {
  if (amount === null) return "—";
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

const fieldStyle: CSSProperties = {
  width: "100%",
  padding: "12px 16px",
  backgroundColor: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: "10px",
  color: "#FFFFFF",
  fontSize: "14px",
  outline: "none",
};

export default function MatchFoundationsPage() {
  const [mission, setMission] = useState("");
  const [minGrant, setMinGrant] = useState("");
  const [maxGrant, setMaxGrant] = useState("");
  const [state, setState] = useState("");
  const [results, setResults] = useState<FoundationMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!mission.trim() || loading) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/match/foundations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mission: mission.trim(),
          minGrant: minGrant ? Number(minGrant) : undefined,
          maxGrant: maxGrant ? Number(maxGrant) : undefined,
          state: state || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { results?: FoundationMatch[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Match failed. Please try again.");
      } else {
        setResults(data.results ?? []);
        setSearched(true);
      }
    } catch {
      setError("Network error. Please try again.");
    }

    setLoading(false);
  }

  return (
    <div style={{ backgroundColor: "#F0EBE0", minHeight: "100vh", padding: "32px" }}>
      <PageHeader
        title="Funder Matching"
        description="Describe your mission and find foundations whose focus areas share the most keyword overlap."
      />

      <div style={{ display: "flex", gap: "24px", alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* LEFT (45%) — Funder Search results */}
        <div style={{ flex: "1 1 420px", minWidth: "320px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#0F172A", margin: "0 0 12px 0" }}>
            Funder Search Results
          </h2>

          {!searched && (
            <div
              style={{
                backgroundColor: "#FFFFFF",
                borderRadius: "12px",
                padding: "32px 24px",
                textAlign: "center",
                boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                border: "1px solid #E2E8F0",
                color: "#64748B",
                fontSize: "13px",
              }}
            >
              Describe your mission in the AI Funder Match panel to see ranked results here.
            </div>
          )}

          {searched && results.length === 0 && !loading && (
            <div
              style={{
                backgroundColor: "#FFFFFF",
                borderRadius: "12px",
                padding: "32px 24px",
                textAlign: "center",
                boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                border: "1px solid #E2E8F0",
                color: "#64748B",
                fontSize: "13px",
              }}
            >
              No foundations matched. Try broadening your mission statement or filters.
            </div>
          )}

          {results.length > 0 && (
            <div style={{ display: "grid", gap: "12px" }}>
              {results.map((f) => {
                const pct = Math.round(f.score * 100);
                return (
                  <div
                    key={f.id}
                    style={{
                      backgroundColor: "#FFFFFF",
                      borderRadius: "12px",
                      padding: "16px 20px",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                      border: "1px solid #E2E8F0",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
                      <div style={{ minWidth: 0 }}>
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
                          {f.name}
                        </p>
                        <p style={{ fontSize: "12px", color: "#64748B", marginTop: "4px" }}>
                          EIN {f.ein} &middot; {f.state || "Unknown state"} &middot; Assets {formatAmount(f.asset_amount)}
                        </p>
                        {f.matchReasons.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "8px" }}>
                            {f.matchReasons.map((reason) => (
                              <span
                                key={reason}
                                style={{
                                  backgroundColor: "#F1F5F9",
                                  color: "#475569",
                                  fontSize: "11px",
                                  fontWeight: 500,
                                  padding: "2px 8px",
                                  borderRadius: "999px",
                                }}
                              >
                                {reason}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <span
                        style={{
                          backgroundColor: "#3D6B50",
                          color: "#FFFFFF",
                          borderRadius: "20px",
                          padding: "4px 12px",
                          fontSize: "12px",
                          fontWeight: 700,
                          whiteSpace: "nowrap",
                          flexShrink: 0,
                        }}
                      >
                        {pct}% match
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* RIGHT (55%) — Semantic Match Engine */}
        <div
          style={{
            flex: "1.3 1 480px",
            minWidth: "340px",
            backgroundColor: "#0F172A",
            borderRadius: "16px",
            padding: "28px",
            color: "#FFFFFF",
            height: "fit-content",
          }}
        >
          <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.15em", color: "#C49A4F", textTransform: "uppercase" }}>
            AI Funder Match
          </div>
          <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.65)", marginTop: "8px", marginBottom: "20px" }}>
            Describe your organization&rsquo;s mission to find foundations whose stated focus areas overlap most closely.
          </p>

          <form onSubmit={(e) => void handleSubmit(e)}>
            <textarea
              value={mission}
              onChange={(e) => setMission(e.target.value)}
              placeholder="We help formerly incarcerated mothers find stable housing in rural Texas…"
              rows={5}
              required
              style={{ ...fieldStyle, resize: "none", marginBottom: "12px" }}
            />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
              <input
                type="number"
                min={0}
                placeholder="Min grant ($)"
                value={minGrant}
                onChange={(e) => setMinGrant(e.target.value)}
                style={fieldStyle}
              />
              <input
                type="number"
                min={0}
                placeholder="Max grant ($)"
                value={maxGrant}
                onChange={(e) => setMaxGrant(e.target.value)}
                style={fieldStyle}
              />
            </div>

            <select
              aria-label="State"
              value={state}
              onChange={(e) => setState(e.target.value)}
              style={{ ...fieldStyle, marginBottom: "16px" }}
            >
              {US_STATES.map((s) => (
                <option key={s.value} value={s.value} style={{ color: "#0F172A" }}>
                  {s.label}
                </option>
              ))}
            </select>

            {error && <p style={{ fontSize: "13px", color: "#FCA5A5", marginBottom: "12px" }}>{error}</p>}

            <button
              type="submit"
              disabled={loading || !mission.trim()}
              style={{
                background: "linear-gradient(135deg,#3D6B50,#C49A4F)",
                color: "#FFFFFF",
                border: "none",
                borderRadius: "10px",
                padding: "12px 24px",
                fontSize: "14px",
                fontWeight: 700,
                cursor: loading || !mission.trim() ? "default" : "pointer",
                width: "100%",
                opacity: loading || !mission.trim() ? 0.7 : 1,
              }}
            >
              {loading ? "Matching…" : "Run Match"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
