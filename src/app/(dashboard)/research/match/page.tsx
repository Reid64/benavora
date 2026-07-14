"use client";

// Keyword-overlap foundation matcher — POSTs a mission statement (plus an
// optional grant-size/state filter) to /api/match/foundations and lists the
// top-scoring foundation_directory records. Distinct from the AI-scored
// /intelligence/matches page: this one is a plain Jaccard keyword match.

import { useState } from "react";
import { Search } from "lucide-react";

import { Badge, Button, Card, Input, Textarea } from "@/components/ui";

interface FoundationMatch {
  id: string;
  name: string;
  ein: string;
  asset_amount: number | null;
  state: string | null;
  score: number;
}

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
          state: state.trim() || undefined,
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
    <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-primary">Foundation Matcher</h1>
        <p className="text-text-muted mt-1">
          Describe your mission and find foundations whose names share the most keyword overlap.
        </p>
      </div>

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
          <div className="grid grid-cols-3 gap-4">
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
            <Input
              label="State"
              placeholder="TX"
              maxLength={2}
              value={state}
              onChange={(e) => setState(e.target.value.toUpperCase())}
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex justify-end">
            <Button type="submit" disabled={loading || !mission.trim()}>
              <Search className="w-4 h-4" />
              {loading ? "Matching…" : "Find Foundations"}
            </Button>
          </div>
        </form>
      </Card>

      {searched && results.length === 0 && !loading && (
        <Card>
          <p className="text-text-muted text-center py-8">
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
                  <p className="font-semibold text-text truncate">{f.name}</p>
                  <p className="text-sm text-text-muted mt-1">
                    EIN {f.ein} &middot; {f.state ?? "Unknown state"} &middot; Assets {formatAmount(f.asset_amount)}
                  </p>
                </div>
                <ScoreBadge score={f.score} />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
