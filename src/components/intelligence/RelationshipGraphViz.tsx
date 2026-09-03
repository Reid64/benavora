"use client";

// Row #81 "Relationship Explorer UI" (FEATURE_REGISTRY_v2.md) — a real
// force-directed visualization of pig_nodes/pig_edges, added as a second
// view alongside the existing card-list on
// src/app/(dashboard)/intelligence/relationship-graph/page.tsx (see that
// page's own header comment for why this feature lives there and not at
// the registry's literal, unlinked "/research/graph" path).
//
// `nodes`/`edges` are the exact same pig_nodes/pig_edges rows the card-list
// view's `connections` are built from (same query, same org-scoping join,
// see /api/intelligence/relationship-graph/route.ts's loadRelationshipGraph())
// — no synthetic nodes/edges, no separate fetch. At real-world scale for
// this feature (~20-25 rows per org, confirmed live 2026-08-07) a hand-rolled
// SVG force simulation is a reasonable, dependency-free choice: no
// react-force-graph/d3-force/cytoscape/reactflow is installed in this
// project (confirmed via package.json before writing this), and a few
// hundred iterations of Fruchterman-Reingold over ~25 nodes is trivial —
// adding an ~80KB+ dependency for a graph this small isn't worth it. If
// this feature's data volume grows by an order of magnitude, revisit with
// a real library instead of scaling this simulation further.

import { useMemo, useState } from "react";
import { Loader2, Network, Route as RouteIcon } from "lucide-react";

import { humanizeEnum } from "@/lib/utils/formatters";
import {
  ConnectionCard,
  type Connection,
} from "@/components/intelligence/relationship-graph-shared";
import { findShortestPath } from "@/lib/intelligence/relationship-graph-pathfinder";

export interface GraphNode {
  id: string;
  label: string;
  nodeType: string;
}

export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relationshipType: string;
  weight: number | null;
  verified: boolean;
}

// Row #82 "Path Finder" (FEATURE_REGISTRY_v2.md) — distinct from
// STRENGTH_COLOR (direct/one_hop/two_hop, relationship-graph-shared.tsx)
// and from the verified/unverified edge colors below (#10B981/#94A3B8) and
// the #3D6B50 selection highlight, so a computed path never visually
// collides with the introduction-strength color coding already on this
// page. Magenta isn't used anywhere else in this component or
// relationship-graph-shared.tsx.
const PATH_COLOR = "#EC4899";

const WIDTH = 860;
const HEIGHT = 520;
const MARGIN = 44;
const ITERATIONS = 220;

const NODE_TYPE_COLOR: Record<string, string> = {
  person: "#2C4E3B",
  funder: "#3D6B50",
  foundation: "#0EA5E9",
  business: "#F59E0B",
  nonprofit: "#10B981",
};
const DEFAULT_NODE_COLOR = "#94A3B8";

function nodeColor(nodeType: string): string {
  return NODE_TYPE_COLOR[nodeType] ?? DEFAULT_NODE_COLOR;
}

interface Point {
  x: number;
  y: number;
}

/** Fruchterman-Reingold force-directed layout, run synchronously — cheap
 * (O(n^2) per iteration) at this feature's real data volume. Deterministic
 * per node/edge set: same input always lays out the same way, so the graph
 * doesn't jump around on an unrelated re-render. */
function computeLayout(nodes: GraphNode[], edges: GraphEdge[]): Map<string, Point> {
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

export default function RelationshipGraphViz({
  nodes,
  edges,
  connections,
  onRequestIntroduction,
  requestingId,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  connections: Connection[];
  onRequestIntroduction: (edgeId: string) => void;
  requestingId: string | null;
}) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [pathStartId, setPathStartId] = useState<string>("");
  const [pathEndId, setPathEndId] = useState<string>("");
  const [activePath, setActivePath] = useState<{ startId: string; endId: string } | null>(
    null,
  );

  const positions = useMemo(() => computeLayout(nodes, edges), [nodes, edges]);

  const degreeById = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of edges) {
      map.set(e.sourceId, (map.get(e.sourceId) ?? 0) + 1);
      map.set(e.targetId, (map.get(e.targetId) ?? 0) + 1);
    }
    return map;
  }, [edges]);

  const maxWeight = useMemo(
    () =>
      edges.reduce(
        (max, e) => (typeof e.weight === "number" && e.weight > max ? e.weight : max),
        0.01,
      ),
    [edges],
  );

  const connectionById = useMemo(
    () => new Map(connections.map((c) => [c.id, c])),
    [connections],
  );

  const presentNodeTypes = useMemo(() => {
    const types = new Set<string>();
    for (const n of nodes) types.add(n.nodeType);
    return [...types].sort();
  }, [nodes]);

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) ?? null : null;
  const selectedConnection = selectedEdgeId
    ? connectionById.get(selectedEdgeId) ?? null
    : null;

  const connectedEdgesForNode = selectedNodeId
    ? edges.filter((e) => e.sourceId === selectedNodeId || e.targetId === selectedNodeId)
    : [];

  const sortedNodesForPicker = useMemo(
    () => [...nodes].sort((a, b) => a.label.localeCompare(b.label)),
    [nodes],
  );

  // Row #82 "Path Finder" — computed from the exact nodes/edges this
  // component already has (same org-scoped data the card list is built
  // from), no second fetch. Re-derives whenever the graph itself changes
  // (e.g. after a Discover Connections run) so a stale path never lingers
  // against a graph that's since changed shape.
  const pathResult = useMemo(() => {
    if (!activePath) return null;
    return findShortestPath(nodes, edges, activePath.startId, activePath.endId);
  }, [activePath, nodes, edges]);

  const pathNodeIdSet = useMemo(
    () => new Set(pathResult?.found ? pathResult.nodeIds : []),
    [pathResult],
  );
  const pathEdgeIdSet = useMemo(
    () => new Set(pathResult?.found ? pathResult.edgeIds : []),
    [pathResult],
  );
  const hasActivePath = pathResult?.found === true;

  function handleSelectEdge(edgeId: string) {
    setSelectedEdgeId(edgeId);
    setSelectedNodeId(null);
    setActivePath(null);
  }

  function handleSelectNode(nodeId: string) {
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
    setActivePath(null);
  }

  function handleFindPath() {
    if (!pathStartId || !pathEndId) return;
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setActivePath({ startId: pathStartId, endId: pathEndId });
  }

  function handleClearPath() {
    setActivePath(null);
    setPathStartId("");
    setPathEndId("");
  }

  if (nodes.length === 0) {
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
          No graph to display yet.
        </p>
        <p style={{ fontSize: "13px", color: "#64748B", marginTop: "8px" }}>
          Click Discover Connections above to populate the relationship graph.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
      <div
        style={{
          flex: "2 1 560px",
          backgroundColor: "#FFFFFF",
          borderRadius: "14px",
          padding: "16px",
          boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            flexWrap: "wrap",
            marginBottom: "12px",
            paddingBottom: "12px",
            borderBottom: "1px solid #E2E8F0",
          }}
        >
          <RouteIcon size={15} color="#64748B" style={{ flexShrink: 0 }} />
          <select
            value={pathStartId}
            onChange={(event) => setPathStartId(event.target.value)}
            style={{
              fontSize: "12px",
              fontWeight: 600,
              color: "#2C4E3B",
              border: "1px solid #E2E8F0",
              borderRadius: "7px",
              padding: "6px 8px",
              maxWidth: "180px",
            }}
          >
            <option value="">Start entity…</option>
            {sortedNodesForPicker.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label}
              </option>
            ))}
          </select>
          <span style={{ fontSize: "12px", color: "#94A3B8" }}>&rarr;</span>
          <select
            value={pathEndId}
            onChange={(event) => setPathEndId(event.target.value)}
            style={{
              fontSize: "12px",
              fontWeight: 600,
              color: "#2C4E3B",
              border: "1px solid #E2E8F0",
              borderRadius: "7px",
              padding: "6px 8px",
              maxWidth: "180px",
            }}
          >
            <option value="">End entity…</option>
            {sortedNodesForPicker.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleFindPath}
            disabled={!pathStartId || !pathEndId}
            style={{
              fontSize: "12px",
              fontWeight: 700,
              color: "#FFFFFF",
              backgroundColor: !pathStartId || !pathEndId ? "#CBD5E1" : PATH_COLOR,
              border: "none",
              borderRadius: "7px",
              padding: "7px 14px",
              cursor: !pathStartId || !pathEndId ? "default" : "pointer",
            }}
          >
            Find Path
          </button>
          {activePath && (
            <button
              type="button"
              onClick={handleClearPath}
              style={{
                fontSize: "12px",
                fontWeight: 600,
                color: "#64748B",
                backgroundColor: "transparent",
                border: "1px solid #E2E8F0",
                borderRadius: "7px",
                padding: "7px 12px",
                cursor: "pointer",
              }}
            >
              Clear
            </button>
          )}
        </div>

        {activePath && pathResult && (
          <p
            style={{
              fontSize: "13px",
              fontWeight: 600,
              color: pathResult.found ? "#9D174D" : "#64748B",
              margin: "0 0 12px",
            }}
          >
            {pathResult.found
              ? pathResult.hops === 0
                ? "Start and end are the same entity."
                : `Path found (${pathResult.hops} hop${pathResult.hops === 1 ? "" : "s"}): ` +
                  pathResult.nodeIds
                    .map((id) => nodeById.get(id)?.label ?? "Unknown")
                    .join(" → ")
              : "No path exists between these two entities in this organization's relationship graph today."}
          </p>
        )}

        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          style={{ width: "100%", height: "auto", display: "block" }}
          role="img"
          aria-label="Relationship graph visualization"
        >
          {edges.map((e) => {
            const pa = positions.get(e.sourceId);
            const pb = positions.get(e.targetId);
            if (!pa || !pb) return null;
            const onPath = hasActivePath && pathEdgeIdSet.has(e.id);
            const isSelected = selectedEdgeId === e.id;
            const isTouchingSelectedNode =
              selectedNodeId != null &&
              (e.sourceId === selectedNodeId || e.targetId === selectedNodeId);
            const weightRatio =
              typeof e.weight === "number" ? Math.min(e.weight / maxWeight, 1) : 0.4;
            const strokeWidth = 1.5 + weightRatio * 3.5;
            const baseColor = e.verified ? "#10B981" : "#94A3B8";
            const dimmed = hasActivePath
              ? !onPath
              : (selectedNodeId != null && !isTouchingSelectedNode) ||
                (selectedEdgeId != null && !isSelected);

            return (
              <line
                key={e.id}
                x1={pa.x}
                y1={pa.y}
                x2={pb.x}
                y2={pb.y}
                stroke={
                  onPath
                    ? PATH_COLOR
                    : isSelected || isTouchingSelectedNode
                      ? "#3D6B50"
                      : baseColor
                }
                strokeWidth={onPath ? strokeWidth + 2.5 : isSelected ? strokeWidth + 1.5 : strokeWidth}
                strokeOpacity={dimmed ? 0.15 : onPath ? 1 : 0.75}
                style={{ cursor: "pointer" }}
                onClick={() => handleSelectEdge(e.id)}
              >
                <title>
                  {`${humanizeEnum(e.relationshipType)} — ${
                    e.verified ? "verified" : "unverified"
                  }${typeof e.weight === "number" ? ` — weight ${e.weight}` : ""}${onPath ? " — on found path" : ""}`}
                </title>
              </line>
            );
          })}

          {nodes.map((node) => {
            const p = positions.get(node.id);
            if (!p) return null;
            const onPath = hasActivePath && pathNodeIdSet.has(node.id);
            const degree = degreeById.get(node.id) ?? 0;
            const radius = 9 + Math.min(degree * 2, 14);
            const isSelected = selectedNodeId === node.id;
            const dimmed = hasActivePath ? !onPath : selectedNodeId != null && !isSelected;

            return (
              <g
                key={node.id}
                style={{ cursor: "pointer" }}
                onClick={() => handleSelectNode(node.id)}
                opacity={dimmed ? 0.35 : 1}
              >
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={radius}
                  fill={nodeColor(node.nodeType)}
                  stroke={onPath ? PATH_COLOR : isSelected ? "#0F172A" : "#FFFFFF"}
                  strokeWidth={onPath ? 4 : isSelected ? 3 : 2}
                >
                  <title>{`${node.label} (${humanizeEnum(node.nodeType)}) — ${degree} connection${degree === 1 ? "" : "s"}${onPath ? " — on found path" : ""}`}</title>
                </circle>
                <text
                  x={p.x}
                  y={p.y + radius + 13}
                  textAnchor="middle"
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    fill: "#334155",
                    pointerEvents: "none",
                  }}
                >
                  {node.label.length > 18 ? `${node.label.slice(0, 17)}…` : node.label}
                </text>
              </g>
            );
          })}
        </svg>

        <div
          style={{
            display: "flex",
            gap: "16px",
            flexWrap: "wrap",
            marginTop: "12px",
            paddingTop: "12px",
            borderTop: "1px solid #E2E8F0",
          }}
        >
          {presentNodeTypes.map((type) => (
            <div
              key={type}
              style={{ display: "flex", alignItems: "center", gap: "6px" }}
            >
              <span
                style={{
                  width: "10px",
                  height: "10px",
                  borderRadius: "50%",
                  backgroundColor: nodeColor(type),
                  display: "inline-block",
                }}
                aria-hidden
              />
              <span style={{ fontSize: "12px", color: "#64748B", fontWeight: 600 }}>
                {humanizeEnum(type)}
              </span>
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span
              style={{
                width: "18px",
                height: "2px",
                backgroundColor: "#10B981",
                display: "inline-block",
              }}
              aria-hidden
            />
            <span style={{ fontSize: "12px", color: "#64748B", fontWeight: 600 }}>
              Verified edge
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span
              style={{
                width: "18px",
                height: "2px",
                backgroundColor: "#94A3B8",
                display: "inline-block",
              }}
              aria-hidden
            />
            <span style={{ fontSize: "12px", color: "#64748B", fontWeight: 600 }}>
              Unverified edge
            </span>
          </div>
          {hasActivePath && (
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span
                style={{
                  width: "18px",
                  height: "2px",
                  backgroundColor: PATH_COLOR,
                  display: "inline-block",
                }}
                aria-hidden
              />
              <span style={{ fontSize: "12px", color: "#64748B", fontWeight: 600 }}>
                Found path
              </span>
            </div>
          )}
        </div>
      </div>

      <div style={{ flex: "1 1 300px", minWidth: "280px" }}>
        {selectedConnection ? (
          <ConnectionCard
            connection={selectedConnection}
            onRequestIntroduction={onRequestIntroduction}
            requesting={requestingId === selectedConnection.id}
          />
        ) : selectedNode ? (
          <div
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: "14px",
              padding: "20px",
              boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
            }}
          >
            <span
              style={{
                display: "inline-block",
                fontSize: "11px",
                fontWeight: 700,
                color: "#FFFFFF",
                backgroundColor: nodeColor(selectedNode.nodeType),
                borderRadius: "999px",
                padding: "3px 10px",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                marginBottom: "10px",
              }}
            >
              {humanizeEnum(selectedNode.nodeType)}
            </span>
            <p
              style={{
                fontSize: "16px",
                fontWeight: 800,
                color: "#0F172A",
                margin: "0 0 4px",
              }}
            >
              {selectedNode.label}
            </p>
            <p style={{ fontSize: "13px", color: "#64748B", margin: "0 0 16px" }}>
              {connectedEdgesForNode.length} connection
              {connectedEdgesForNode.length === 1 ? "" : "s"}
            </p>

            {connectedEdgesForNode.map((e) => {
              const otherId = e.sourceId === selectedNode.id ? e.targetId : e.sourceId;
              const other = nodeById.get(otherId);
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => handleSelectEdge(e.id)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    background: "#F8FAFC",
                    border: "1px solid #E2E8F0",
                    borderRadius: "8px",
                    padding: "10px 12px",
                    marginBottom: "8px",
                    cursor: "pointer",
                    fontSize: "12px",
                    color: "#2C4E3B",
                    fontWeight: 600,
                  }}
                >
                  {humanizeEnum(e.relationshipType)} &rarr; {other?.label ?? "Unknown"}
                </button>
              );
            })}
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
              Click a node or connection line to see its detail here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export function GraphViewLoading() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "10px",
        padding: "64px 0",
        color: "#64748B",
        fontSize: "14px",
      }}
    >
      <Loader2 size={18} className="animate-spin" />
      Loading relationship graph...
    </div>
  );
}
