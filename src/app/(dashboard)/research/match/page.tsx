"use client";

// Keyword-overlap foundation matcher — POSTs a mission statement (plus an
// optional grant-size/state filter) to /api/match/foundations and lists the
// top-scoring foundation_directory records. Distinct from the AI-scored
// /intelligence/matches page: this one is a plain Jaccard keyword match.

import { useState } from "react";
import { Search } from "lucide-react";

import { Badge, Button, Card, Input, Select, Textarea } from "@/components/ui";
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

function ScoreBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const variant = pct < 20 ? "neutral" : pct < 50 ? "warning" : "success";
  return <Badge variant={variant}>{pct}% match</Badge>;
}

function formatAmount(amount: number | null): string {
  if (amount === null) return "—";
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export default function MatchFoundationsPage() {
  const [mission, setMission] = useState("");
  const [minGrant, setMinGrant] = useState("");
  const [maxGrant, setMaxGrant] = useState("");
  const [state, setState] = useState("");
  const [results, setResults] = useState<FoundationMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
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
    <div className="min-h-screen bg-[#EEF2F7] p-6">
      <PageHeader
        title="Funder Matching"
        description="Describe your mission and find foundations whose focus areas share the most keyword overlap."
      />

      <div className="max-w-3xl space-y-6">
        <Card>
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <Textarea
              label="Organization mission"
              placeholder="We help formerly incarcerated mothers find stable housing in rural Texas…"
              value={mission}
              onChange={(e) => setMission(e.target.value)}
              required
              rows={5}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Input
                label="Min grant ($)"
                type="number"
                min={0}
                value={minGrant}
                onChange={(e) => setMinGrant(e.target.value)}
              />
              <Input
                label="Max grant ($)"
                type="number"
                min={0}
                value={maxGrant}
                onChange={(e) => setMaxGrant(e.target.value)}
              />
              <Select label="State" options={US_STATES} value={state} onChange={(e) => setState(e.target.value)} />
            </div>
            {error && <p className="text-sm text-[#B91C1C]">{error}</p>}
            <div className="flex justify-end">
              <Button type="submit" disabled={loading || !mission.trim()}>
                <Search className="w-4 h-4" />
                {loading ? "Matching…" : "Find Matches"}
              </Button>
            </div>
          </form>
        </Card>

        {searched && results.length === 0 && !loading && (
          <Card>
            <p className="text-slate-500 text-center py-8">
              No foundations matched. Try broadening your mission statement or filters.
            </p>
          </Card>
        )}

        {results.length > 0 && (
          <div className="space-y-3">
            {results.map((f) => (
              <Card key={f.id}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 truncate">{f.name}</p>
                    <p className="text-sm text-slate-500 mt-1">
                      EIN {f.ein} &middot; {f.state ?? "Unknown state"} &middot; Assets {formatAmount(f.asset_amount)}
                    </p>
                    {f.matchReasons.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {f.matchReasons.map((reason) => (
                          <span
                            key={reason}
                            className="inline-flex items-center rounded-full bg-[#F1F5F9] px-2 py-0.5 text-xs text-slate-600"
                          >
                            {reason}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <ScoreBadge score={f.score} />
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
