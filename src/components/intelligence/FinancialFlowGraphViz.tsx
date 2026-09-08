"use client";

// Force-directed graph for the 990 Funding Pattern Explorer tool
// (src/app/(dashboard)/intelligence/990-funding-pattern-explorer/page.tsx).
// Renders a foundation node connected to its real 990-PF filing metrics
// (contributions paid, qualifying distributions, total functional expenses,
// total revenue, total assets) — NOT a foundation-to-grantee graph, because
// ProPublica's API does not expose grantee/recipient-level data (see that
// page's header comment and the API route's GRANTEE_DATA_NOTE for the full
// account).
//
// Reuses the same dependency-free Fruchterman-Reingold approach already
// established by RelationshipGraphViz.tsx for the same reason that
// component gives: no react-force-graph/d3-force/cytoscape is installed,
// and a handful of nodes doesn't justify adding one. Built as a separate,
// smaller component rather than extending RelationshipGraphViz because that
// component's props (Connection, onRequestIntroduction, path finder) are
// person-introduction concepts that don't apply to filing-metric nodes.

import { useMemo, useState } from "react";
import { DollarSign, Network } from "lucide-react";

export interface FlowNode {
  id: string;
  label: string;
  kind: "foundation" | "metric";
}

export interface FlowEdge {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
  value: number;
}

const WIDTH = 720;
const HEIGHT = 440;
const MARGIN = 60;
const ITERATIONS = 220;

const NODE_COLOR: Record<FlowNode["kind"], string> = {
  foundation: "#0EA5E9",
  metric: "#2C4E3B",
};

function formatUsd(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

interface Point {
  x: number;
  y: number;
}

/** Deterministic Fruchterman-Reingold layout — same input always lays out
 * the same way, mirrors RelationshipGraphViz.tsx's computeLayout(). */
function computeLayout(nodes: FlowNode[], edges: FlowEdge[]): Map<string, Point> {
  const n = nodes.length;
  const pos = new Map<string, Point>();
  if (n === 0) return pos;

  const area = (WIDTH - 2 * MARGIN) * (HEIGHT - 2 * MARGIN);
  const k = Math.sqrt(area / n);

  nodes.forEach((node, i) => {
    const angle = (i / n) * 2 * Math.PI;
    const radius = Math.min(WIDTH, HEIGHT) / 3;
    pos.set(node.id, {
      x: WIDTH / 2 + radius * Math.cos(angle),
      y: HEIGHT / 2 + radius * Math.sin(angle),
    });
  });

  if (n === 1) return pos;

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const disp = new Map<string, Point>();
    nodes.forEach((node) => disp.set(node.id, { x: 0, y: 0 }));

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        const pa = pos.get(a.id)!;
        const pb = pos.get(b.id)!;
        let dx = pa.x - pb.x;
        let dy = pa.y - pb.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const force = (k * k) / dist;
        dx = (dx / dist) * force;
        dy = (dy / dist) * force;
        const da = disp.get(a.id)!;
        da.x += dx;
        da.y += dy;
        const db = disp.get(b.id)!;
        db.x -= dx;
        db.y -= dy;
      }
    }

    for (const e of edges) {
      const pa = pos.get(e.sourceId);
      const pb = pos.get(e.targetId);
      if (!pa || !pb) continue;
      let dx = pa.x - pb.x;
      let dy = pa.y - pb.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const force = (dist * dist) / k;
      dx = (dx / dist) * force;
      dy = (dy / dist) * force;
      const da = disp.get(e.sourceId)!;
      da.x -= dx;
      da.y -= dy;
      const db = disp.get(e.targetId)!;
      db.x += dx;
      db.y += dy;
    }

    const temp = Math.max(1, 40 * (1 - iter / ITERATIONS));
    nodes.forEach((node) => {
      const d = disp.get(node.id)!;
      const dist = Math.sqrt(d.x * d.x + d.y * d.y) || 0.01;
      const p = pos.get(node.id)!;
      p.x += (d.x / dist) * Math.min(dist, temp);
      p.y += (d.y / dist) * Math.min(dist, temp);
      p.x = Math.min(WIDTH - MARGIN, Math.max(MARGIN, p.x));
      p.y = Math.min(HEIGHT - MARGIN, Math.max(MARGIN, p.y));
    });
  }

  return pos;
}

export default function FinancialFlowGraphViz({
  nodes,
  edges,
}: {
  nodes: FlowNode[];
  edges: FlowEdge[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const positions = useMemo(() => computeLayout(nodes, edges), [nodes, edges]);
  const maxValue = useMemo(
    () => edges.reduce((max, e) => Math.max(max, e.value), 1),
    [edges],
  );
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const edgeById = useMemo(() => new Map(edges.map((e) => [e.id, e])), [edges]);

  const selectedNode = selectedId ? (nodeById.get(selectedId) ?? null) : null;
  const selectedEdge = selectedId ? (edgeById.get(selectedId) ?? null) : null;

  if (nodes.length <= 1) {
    return (
      <div
        style={{
          backgroundColor: "#FFFFFF",
          borderRadius: "14px",
          padding: "56px 24px",
          textAlign: "center",
          boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
        }}
      >
        <Network size={32} color="#94A3B8" style={{ margin: "0 auto 12px" }} />
        <p style={{ fontSize: "14px", fontWeight: 700, color: "#2C4E3B", margin: 0 }}>
          No real filing metrics returned for this foundation.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
      <div
        style={{
          flex: "2 1 480px",
          backgroundColor: "#FFFFFF",
          borderRadius: "14px",
          padding: "16px",
          boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
        }}
      >
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          style={{ width: "100%", height: "auto", display: "block" }}
          role="img"
          aria-label="990 filing financial flow graph"
        >
          {edges.map((e) => {
            const pa = positions.get(e.sourceId);
            const pb = positions.get(e.targetId);
            if (!pa || !pb) return null;
            const isSelected = selectedId === e.id;
            const isTouchingSelectedNode =
              selectedId != null && (e.sourceId === selectedId || e.targetId === selectedId);
            const weightRatio = Math.min(e.value / maxValue, 1);
            const strokeWidth = 1.5 + weightRatio * 5.5;
            const dimmed = selectedId != null && !isSelected && !isTouchingSelectedNode;

            return (
              <g key={e.id}>
                <line
                  x1={pa.x}
                  y1={pa.y}
                  x2={pb.x}
                  y2={pb.y}
                  stroke={isSelected || isTouchingSelectedNode ? "#0EA5E9" : "#94A3B8"}
                  strokeWidth={isSelected ? strokeWidth + 2 : strokeWidth}
                  strokeOpacity={dimmed ? 0.15 : 0.8}
                  style={{ cursor: "pointer" }}
                  onClick={() => setSelectedId(e.id)}
                >
                  <title>{`${e.label} — ${formatUsd(e.value)}`}</title>
                </line>
                <text
                  x={(pa.x + pb.x) / 2}
                  y={(pa.y + pb.y) / 2 - 6}
                  textAnchor="middle"
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    fill: "#475569",
                    pointerEvents: "none",
                    opacity: dimmed ? 0.2 : 1,
                  }}
                >
                  {formatUsd(e.value)}
                </text>
              </g>
            );
          })}

          {nodes.map((node) => {
            const p = positions.get(node.id);
            if (!p) return null;
            const isSelected = selectedId === node.id;
            const radius = node.kind === "foundation" ? 22 : 14;
            const dimmed = selectedId != null && !isSelected;

            return (
              <g
                key={node.id}
                style={{ cursor: "pointer" }}
                onClick={() => setSelectedId(node.id)}
                opacity={dimmed ? 0.4 : 1}
              >
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={radius}
                  fill={NODE_COLOR[node.kind]}
                  stroke={isSelected ? "#0F172A" : "#FFFFFF"}
                  strokeWidth={isSelected ? 3 : 2}
                >
                  <title>{node.label}</title>
                </circle>
                <text
                  x={p.x}
                  y={p.y + radius + 14}
                  textAnchor="middle"
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    fill: "#334155",
                    pointerEvents: "none",
                  }}
                >
                  {node.label.length > 22 ? `${node.label.slice(0, 21)}…` : node.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div style={{ flex: "1 1 260px", minWidth: "240px" }}>
        {selectedEdge ? (
          <div
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: "14px",
              padding: "20px",
              boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
            }}
          >
            <DollarSign size={18} color="#0EA5E9" style={{ marginBottom: "8px" }} />
            <p style={{ fontSize: "15px", fontWeight: 800, color: "#0F172A", margin: "0 0 4px" }}>
              {selectedEdge.label}
            </p>
            <p style={{ fontSize: "20px", fontWeight: 800, color: "#0EA5E9", margin: 0 }}>
              {formatUsd(selectedEdge.value)}
            </p>
            <p style={{ fontSize: "12px", color: "#64748B", marginTop: "8px" }}>
              From the foundation's most recent 990-PF filing on file with ProPublica.
            </p>
          </div>
        ) : selectedNode ? (
          <div
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: "14px",
              padding: "20px",
              boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
            }}
          >
            <p style={{ fontSize: "16px", fontWeight: 800, color: "#0F172A", margin: "0 0 4px" }}>
              {selectedNode.label}
            </p>
            <p style={{ fontSize: "13px", color: "#64748B", margin: 0 }}>
              {selectedNode.kind === "foundation"
                ? "Click a connected line to see the real dollar value for that metric."
                : "A real aggregate filing total, not a specific grantee."}
            </p>
          </div>
        ) : (
          <div
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: "14px",
              padding: "24px 20px",
              boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
              textAlign: "center",
            }}
          >
            <Network size={24} color="#94A3B8" style={{ margin: "0 auto 10px" }} />
            <p style={{ fontSize: "13px", color: "#64748B", margin: 0 }}>
              Click a node or connection line to see its real value here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
