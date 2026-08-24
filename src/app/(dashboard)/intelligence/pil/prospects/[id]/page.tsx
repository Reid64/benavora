"use client";

// PIL prospect dossier — GET /api/pil/prospects/[id] returns the prospect
// row, its evidence (pil_evidence, keyed by entity_table/entity_id — see
// src/lib/pil/evidence.ts), its graph nodes and edges (extended into this
// route for the Graph tab, since the original handler only returned nodes),
// and its research runs. Research run steps are fetched lazily per run from
// GET /api/pil/research/[runId] when a run is expanded, since the dossier
// endpoint intentionally doesn't inline every run's full step history.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FlaskConical, Layers, Network, ScrollText, Sparkles } from "lucide-react";

import { Button } from "@/components/ui";
import { StartResearchModal } from "@/components/pil/StartResearchModal";
import { formatDate, formatRelative, humanizeEnum } from "@/lib/utils/formatters";
import type {
  EvidenceItem,
  GraphEdge,
  GraphNode,
  Prospect,
  ResearchRun,
  ResearchRunStep,
} from "@/lib/pil/types";

const NAVY = "#101B2D";
const GOLD = "#B88A2E";
const PLUM = "#5B21B6";
const CANVAS = "#D8D3C8";
const CARD_BG = "#F8F5EE";
const TEXT_SECONDARY = "#64748B";
const BORDER = "#D9D3C5";

type TabKey = "overview" | "evidence" | "graph" | "research" | "actions";

const TABS: { key: TabKey; label: string; icon: typeof Layers }[] = [
  { key: "overview", label: "Overview", icon: Layers },
  { key: "evidence", label: "Evidence", icon: ScrollText },
  { key: "graph", label: "Graph", icon: Network },
  { key: "research", label: "Research", icon: FlaskConical },
  { key: "actions", label: "Actions", icon: Sparkles },
];

const FRESHNESS_COLOR: Record<string, string> = {
  fresh: "#10B981",
  aging: "#F59E0B",
  stale: "#EF4444",
};

const RUN_STATUS_COLOR: Record<string, string> = {
  planning: "#0EA5E9",
  running: "#F59E0B",
  completed: "#10B981",
  failed: "#EF4444",
  cancelled: "#94A3B8",
};

interface DossierPayload {
  prospect: Prospect;
  evidence: EvidenceItem[];
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  researchRuns: ResearchRun[];
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold"
      style={{ backgroundColor: `${color}1A`, color, borderColor: `${color}40` }}
    >
      {label}
    </span>
  );
}

/** A minimal force-directed layout — no external deps. Runs a handful of
 * repulsion + spring + centering passes over fixed-size SVG viewport
 * coordinates and returns final node positions, keyed by node id. */
function computeForceLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number,
  height: number,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 2.6;

  nodes.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / Math.max(1, nodes.length);
    positions.set(n.id, { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  });

  const REPULSION = 12000;
  const SPRING_LENGTH = 130;
  const SPRING_STRENGTH = 0.02;
  const CENTER_STRENGTH = 0.01;
  const ITERATIONS = 120;

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const forces = new Map<string, { fx: number; fy: number }>();
    nodes.forEach((n) => forces.set(n.id, { fx: 0, fy: 0 }));

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const nodeI = nodes[i]!;
        const nodeJ = nodes[j]!;
        const a = positions.get(nodeI.id)!;
        const b = positions.get(nodeJ.id)!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const distSq = Math.max(dx * dx + dy * dy, 1);
        const force = REPULSION / distSq;
        const dist = Math.sqrt(distSq);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        forces.get(nodeI.id)!.fx += fx;
        forces.get(nodeI.id)!.fy += fy;
        forces.get(nodeJ.id)!.fx -= fx;
        forces.get(nodeJ.id)!.fy -= fy;
      }
    }

    for (const e of edges) {
      const a = positions.get(e.source_node_id);
      const b = positions.get(e.target_node_id);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const displacement = dist - SPRING_LENGTH;
      const fx = (dx / dist) * displacement * SPRING_STRENGTH;
      const fy = (dy / dist) * displacement * SPRING_STRENGTH;
      const sourceForce = forces.get(e.source_node_id);
      const targetForce = forces.get(e.target_node_id);
      if (sourceForce) {
        sourceForce.fx += fx;
        sourceForce.fy += fy;
      }
      if (targetForce) {
        targetForce.fx -= fx;
        targetForce.fy -= fy;
      }
    }

    for (const n of nodes) {
      const pos = positions.get(n.id)!;
      const force = forces.get(n.id)!;
      force.fx += (cx - pos.x) * CENTER_STRENGTH;
      force.fy += (cy - pos.y) * CENTER_STRENGTH;
      const nextX = pos.x + force.fx;
      const nextY = pos.y + force.fy;
      positions.set(n.id, {
        x: Math.min(width - 24, Math.max(24, nextX)),
        y: Math.min(height - 24, Math.max(24, nextY)),
      });
    }
  }

  return positions;
}

function GraphView({ nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  const width = 800;
  const height = 480;
  const positions = useMemo(() => computeForceLayout(nodes, edges, width, height), [nodes, edges]);

  if (nodes.length === 0) {
    return (
      <p className="py-12 text-center text-sm" style={{ color: TEXT_SECONDARY }}>
        No graph nodes anchored to this prospect yet.
      </p>
    );
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Prospect relationship graph">
      {edges.map((e) => {
        const a = positions.get(e.source_node_id);
        const b = positions.get(e.target_node_id);
        if (!a || !b) return null;
        return (
          <line
            key={e.id}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={PLUM}
            strokeOpacity={0.35}
            strokeWidth={1.5}
          />
        );
      })}
      {nodes.map((n) => {
        const pos = positions.get(n.id);
        if (!pos) return null;
        return (
          <g key={n.id}>
            <circle cx={pos.x} cy={pos.y} r={22} fill={CARD_BG} stroke={GOLD} strokeWidth={2} />
            <text
              x={pos.x}
              y={pos.y + 38}
              textAnchor="middle"
              fontSize={11}
              fontWeight={600}
              fill={NAVY}
            >
              {n.label.length > 22 ? `${n.label.slice(0, 20)}…` : n.label}
            </text>
            <text x={pos.x} y={pos.y + 4} textAnchor="middle" fontSize={9} fill={TEXT_SECONDARY}>
              {humanizeEnum(n.node_type)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function ResearchRunRow({ run }: { run: ResearchRun }) {
  const [expanded, setExpanded] = useState(false);
  const [steps, setSteps] = useState<ResearchRunStep[] | null>(null);
  const [loadingSteps, setLoadingSteps] = useState(false);

  async function toggle() {
    if (!expanded && steps === null) {
      setLoadingSteps(true);
      try {
        const res = await fetch(`/api/pil/research/${run.id}`, { cache: "no-store" });
        if (res.ok) {
          const payload = (await res.json()) as { steps: ResearchRunStep[] };
          setSteps(payload.steps ?? []);
        } else {
          setSteps([]);
        }
      } catch {
        setSteps([]);
      }
      setLoadingSteps(false);
    }
    setExpanded((e) => !e);
  }

  return (
    <div className="rounded-lg border" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
      <button type="button" onClick={() => void toggle()} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <div>
          <p className="text-sm font-semibold" style={{ color: NAVY }}>
            {run.natural_language_query ?? run.goal_id ?? "Untitled research goal"}
          </p>
          <p className="mt-0.5 text-xs" style={{ color: TEXT_SECONDARY }}>
            Started {run.started_at ? formatRelative(run.started_at) : "not yet started"}
          </p>
        </div>
        <Pill label={humanizeEnum(run.status)} color={RUN_STATUS_COLOR[run.status] ?? "#64748B"} />
      </button>
      {expanded && (
        <div className="border-t px-4 py-3" style={{ borderColor: BORDER }}>
          {loadingSteps ? (
            <p className="text-sm" style={{ color: TEXT_SECONDARY }}>
              Loading steps…
            </p>
          ) : steps && steps.length > 0 ? (
            <ol className="space-y-2">
              {steps.map((s) => (
                <li key={s.id} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 font-mono text-xs" style={{ color: GOLD }}>
                    #{s.step_number}
                  </span>
                  <div>
                    <span className="font-medium" style={{ color: NAVY }}>
                      {humanizeEnum(s.loop_phase)}
                    </span>
                    {s.decision && <span style={{ color: TEXT_SECONDARY }}> — {s.decision}</span>}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm" style={{ color: TEXT_SECONDARY }}>
              No steps recorded yet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function PilProspectDossierPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [tab, setTab] = useState<TabKey>("overview");
  const [data, setData] = useState<DossierPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showResearchModal, setShowResearchModal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/pil/prospects/${id}`, { cache: "no-store" });
      if (!res.ok) {
        setError(res.status === 404 ? "Prospect not found." : "Could not load this dossier.");
      } else {
        setData((await res.json()) as DossierPayload);
      }
    } catch {
      setError("Could not reach the server.");
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const avgConfidence = useMemo(() => {
    if (!data || data.evidence.length === 0) return null;
    const sum = data.evidence.reduce((acc, e) => acc + (e.confidence ?? 0), 0);
    return sum / data.evidence.length;
  }, [data]);

  if (loading) {
    return (
      <div className="min-h-screen p-6" style={{ backgroundColor: CANVAS }}>
        <p style={{ color: TEXT_SECONDARY }}>Loading dossier…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen p-6" style={{ backgroundColor: CANVAS }}>
        <Link href="/intelligence/pil/prospects" className="inline-flex items-center gap-1.5 text-sm" style={{ color: PLUM }}>
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to Prospects
        </Link>
        <p className="mt-4 text-sm text-red-600">{error ?? "Prospect not found."}</p>
      </div>
    );
  }

  const { prospect, evidence, graphNodes, graphEdges, researchRuns } = data;

  return (
    <div className="min-h-screen p-6" style={{ backgroundColor: CANVAS }}>
      <Link href="/intelligence/pil/prospects" className="inline-flex items-center gap-1.5 text-sm" style={{ color: PLUM }}>
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to Prospects
      </Link>

      <div className="mb-6 mt-4" style={{ borderLeft: `4px solid ${PLUM}`, paddingLeft: "1rem" }}>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: NAVY }}>
          {prospect.display_name}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Pill label={humanizeEnum(prospect.entity_type)} color={GOLD} />
          <Pill label={humanizeEnum(prospect.status)} color={PLUM} />
          <Pill label={humanizeEnum(prospect.source_of_record)} color={NAVY} />
        </div>
      </div>

      <div className="mb-6 flex flex-wrap gap-1 border-b" style={{ borderColor: BORDER }}>
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold"
              style={{
                color: active ? PLUM : TEXT_SECONDARY,
                borderBottom: active ? `2px solid ${PLUM}` : "2px solid transparent",
              }}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="rounded-xl p-5" style={{ backgroundColor: CARD_BG }}>
        {tab === "overview" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: TEXT_SECONDARY }}>
                Canonical Name
              </p>
              <p className="mt-1 text-sm font-medium" style={{ color: NAVY }}>
                {prospect.canonical_name}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: TEXT_SECONDARY }}>
                Average Evidence Confidence
              </p>
              <p className="mt-1 text-sm font-medium" style={{ color: NAVY }}>
                {avgConfidence === null ? "No evidence yet" : `${Math.round(avgConfidence * 100)}%`}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: TEXT_SECONDARY }}>
                Last Updated
              </p>
              <p className="mt-1 text-sm font-medium" style={{ color: NAVY }}>
                {formatDate(prospect.updated_at)}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: TEXT_SECONDARY }}>
                Created
              </p>
              <p className="mt-1 text-sm font-medium" style={{ color: NAVY }}>
                {formatDate(prospect.created_at)}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: TEXT_SECONDARY }}>
                Evidence Items
              </p>
              <p className="mt-1 text-sm font-medium" style={{ color: NAVY }}>
                {evidence.length}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: TEXT_SECONDARY }}>
                Research Runs
              </p>
              <p className="mt-1 text-sm font-medium" style={{ color: NAVY }}>
                {researchRuns.length}
              </p>
            </div>
          </div>
        )}

        {tab === "evidence" && (
          <div className="space-y-3">
            {evidence.length === 0 ? (
              <p className="text-sm" style={{ color: TEXT_SECONDARY }}>
                No evidence recorded yet.
              </p>
            ) : (
              evidence.map((e) => (
                <div key={e.id} className="rounded-lg border p-3" style={{ borderColor: BORDER, backgroundColor: "#FFFFFF" }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium" style={{ color: NAVY }}>
                      {e.claim}
                    </p>
                    <div className="flex items-center gap-1.5">
                      <Pill
                        label={humanizeEnum(e.freshness_status)}
                        color={FRESHNESS_COLOR[e.freshness_status] ?? "#64748B"}
                      />
                      <Pill label={`${Math.round(e.confidence * 100)}% confidence`} color={GOLD} />
                    </div>
                  </div>
                  <p className="mt-1 text-xs" style={{ color: TEXT_SECONDARY }}>
                    {humanizeEnum(e.verification_status)} · {e.source_title ?? e.source_url ?? humanizeEnum(e.source_type)}
                    {e.publisher ? ` · ${e.publisher}` : ""}
                  </p>
                  {e.evidence_excerpt && (
                    <p className="mt-2 text-xs italic" style={{ color: TEXT_SECONDARY }}>
                      “{e.evidence_excerpt}”
                    </p>
                  )}
                  <p className="mt-2 text-xs" style={{ color: TEXT_SECONDARY }}>
                    Retrieved {formatRelative(e.retrieved_at)}
                    {e.last_verified_at ? ` · Last verified ${formatRelative(e.last_verified_at)}` : ""}
                  </p>
                </div>
              ))
            )}
          </div>
        )}

        {tab === "graph" && <GraphView nodes={graphNodes} edges={graphEdges} />}

        {tab === "research" && (
          <div className="space-y-2">
            {researchRuns.length === 0 ? (
              <p className="text-sm" style={{ color: TEXT_SECONDARY }}>
                No research runs yet for this prospect.
              </p>
            ) : (
              researchRuns.map((run) => <ResearchRunRow key={run.id} run={run} />)
            )}
          </div>
        )}

        {tab === "actions" && (
          <div>
            <p className="mb-4 text-sm" style={{ color: TEXT_SECONDARY }}>
              Start a new research run for {prospect.display_name}. This creates a pil_research_runs
              row and hands it to the workflow engine.
            </p>
            <Button onClick={() => setShowResearchModal(true)} style={{ backgroundColor: PLUM }}>
              Start Research
            </Button>
          </div>
        )}
      </div>

      {showResearchModal && (
        <StartResearchModal
          prospectId={prospect.id}
          prospectName={prospect.display_name}
          onClose={(runId) => {
            setShowResearchModal(false);
            if (runId) {
              setToast("Research started — see the Research monitor for progress.");
              void load();
            }
          }}
        />
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          style={{ backgroundColor: PLUM }}
          className="fixed right-6 top-6 z-50 flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-medium text-white shadow-xl"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
