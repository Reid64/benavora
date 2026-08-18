"use client";

// AG-32 Relationship Graph Builder UI (AUTONOMOUS_PLATFORM_VISION.md §7
// "Corporate Relationship Graph"; src/lib/agents/relationship-graph-builder-agent.ts).
// Talks to /api/intelligence/relationship-graph, which reads real pig_nodes/
// pig_edges rows reshaped into connection objects — there is no
// `corporate_relationships` table in the live schema, see the route's own
// header comment for the full account. Every color on this page is an
// inline hex value per BLUEPRINT_v2.md §7.5 — no CSS variables, no Tailwind
// color classes.

import { useCallback, useEffect, useState } from "react";
import { Loader2, Network, Sparkles } from "lucide-react";

import { humanizeEnum } from "@/lib/utils/formatters";
import {
  ConnectionCard,
  StatTile,
  type Connection,
} from "@/components/intelligence/relationship-graph-shared";
import RelationshipGraphViz, {
  type GraphEdge,
  type GraphNode,
} from "@/components/intelligence/RelationshipGraphViz";

interface NodeCount {
  nodeType: string;
  count: number;
}

interface EdgeCount {
  relationshipType: string;
  count: number;
}

interface TopConnectedNode {
  id: string;
  label: string;
  nodeType: string;
  edgeCount: number;
}

interface TopFoundation {
  id: string;
  label: string;
  edgeCount: number;
  avgWeight: number;
  topRelationshipType: string;
}

interface Cluster {
  relationshipTypes: string[];
  foundationCount: number;
  foundationNames: string[];
  description: string;
  strength: number;
}

interface GraphAnalytics {
  totalNodes: number;
  totalEdges: number;
  avgConnectionsPerFoundation: number;
  strongestPathScore: number;
  nodeCounts: NodeCount[];
  edgeCounts: EdgeCount[];
  topConnectedNodes: TopConnectedNode[];
  topFoundations: TopFoundation[];
  clusters: Cluster[];
}

export default function RelationshipGraphPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([]);
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);
  const [viewMode, setViewMode] = useState<"list" | "graph">("list");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runNotice, setRunNotice] = useState<string | null>(null);
  const [requestingId, setRequestingId] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<GraphAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);

  const loadAnalytics = useCallback(async () => {
    setAnalyticsError(null);
    try {
      const res = await fetch("/api/intelligence/relationship-graph/analytics", {
        cache: "no-store",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAnalyticsError(
          (payload as { error?: string }).error ??
            "Could not load graph analytics.",
        );
        return;
      }
      setAnalytics(payload as GraphAnalytics);
    } catch {
      setAnalyticsError("Could not reach the graph analytics service.");
    }
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/intelligence/relationship-graph", {
        cache: "no-store",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          (payload as { error?: string }).error ??
            "Could not load the relationship graph.",
        );
        return;
      }
      const data = payload as {
        connections?: Connection[];
        nodes?: GraphNode[];
        edges?: GraphEdge[];
      };
      setConnections(data.connections ?? []);
      setGraphNodes(data.nodes ?? []);
      setGraphEdges(data.edges ?? []);
    } catch {
      setError("Could not reach the relationship graph service.");
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      await load();
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [load]);

  useEffect(() => {
    let active = true;
    (async () => {
      setAnalyticsLoading(true);
      await loadAnalytics();
      if (active) setAnalyticsLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [loadAnalytics]);

  async function handleDiscoverConnections() {
    setRunning(true);
    setRunNotice(null);
    setError(null);
    try {
      const res = await fetch("/api/intelligence/relationship-graph", {
        method: "POST",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          (payload as { error?: string }).error ??
            "Relationship graph discovery failed.",
        );
        return;
      }
      const data = payload as {
        connections?: Connection[];
        nodes?: GraphNode[];
        edges?: GraphEdge[];
        itemsProcessed?: number;
        errors?: string[];
      };
      setConnections(data.connections ?? []);
      setGraphNodes(data.nodes ?? []);
      setGraphEdges(data.edges ?? []);
      if (data.errors && data.errors.length > 0) {
        setRunNotice(data.errors[0] ?? "Discovery reported an issue.");
      } else {
        setRunNotice(
          data.itemsProcessed && data.itemsProcessed > 0
            ? `Analyzed ${data.itemsProcessed} board member${
                data.itemsProcessed !== 1 ? "s" : ""
              } for new connections.`
            : "No board members on file yet — add board members under Governance to discover connections.",
        );
      }
      void loadAnalytics();
    } catch {
      setError("Could not reach the relationship graph service.");
    } finally {
      setRunning(false);
    }
  }

  async function handleRequestIntroduction(edgeId: string) {
    setRequestingId(edgeId);
    setError(null);
    try {
      const res = await fetch("/api/intelligence/relationship-graph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request_introduction", edgeId }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          (payload as { error?: string }).error ??
            "Could not request an introduction.",
        );
        return;
      }
      const data = payload as {
        connections?: Connection[];
        nodes?: GraphNode[];
        edges?: GraphEdge[];
      };
      setConnections(data.connections ?? []);
      setGraphNodes(data.nodes ?? []);
      setGraphEdges(data.edges ?? []);
    } catch {
      setError("Could not reach the relationship graph service.");
    } finally {
      setRequestingId(null);
    }
  }

  const totalConnections = connections.length;
  const directCount = connections.filter(
    (c) => c.introductionStrength === "direct",
  ).length;
  const oneHopCount = connections.filter(
    (c) => c.introductionStrength === "one_hop",
  ).length;
  const twoHopCount = connections.filter(
    (c) => c.introductionStrength === "two_hop",
  ).length;

  const showEmpty = !loading && connections.length === 0;

  return (
    <div style={{ backgroundColor: "#D8D3C8", minHeight: "100vh", padding: "32px" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "16px",
          flexWrap: "wrap",
          marginBottom: "28px",
        }}
      >
        <div style={{ borderLeft: "4px solid #7A5980", paddingLeft: "16px" }}>
          <h1
            style={{
              fontSize: "28px",
              fontWeight: 800,
              color: "#101B2D",
              letterSpacing: "-0.02em",
              margin: 0,
            }}
          >
            Relationship Intelligence Graph
          </h1>
          <p style={{ fontSize: "14px", color: "#64748B", marginTop: "6px" }}>
            Discover hidden connections between your board and funders.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleDiscoverConnections()}
          disabled={running}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            backgroundColor: "#7A5980",
            color: "#FFFFFF",
            fontSize: "14px",
            fontWeight: 700,
            padding: "12px 24px",
            borderRadius: "10px",
            border: "none",
            cursor: running ? "default" : "pointer",
            opacity: running ? 0.7 : 1,
            boxShadow: "0 4px 16px rgba(122,89,128,0.25)",
          }}
        >
          {running ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Sparkles size={16} />
          )}
          {running ? "Discovering Connections..." : "Discover Connections"}
        </button>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            backgroundColor: "#FEF2F2",
            border: "1px solid #FECACA",
            borderRadius: "10px",
            padding: "12px 16px",
            marginBottom: "20px",
            fontSize: "13px",
            color: "#B91C1C",
          }}
        >
          {error}
        </div>
      )}

      {runNotice && !error && (
        <div
          style={{
            backgroundColor: "#F0FDFA",
            border: "1px solid #99F6E4",
            borderRadius: "10px",
            padding: "12px 16px",
            marginBottom: "20px",
            fontSize: "13px",
            color: "#0F766E",
          }}
        >
          {runNotice}
        </div>
      )}

      {/* Stats row */}
      <div
        style={{
          display: "flex",
          gap: "16px",
          flexWrap: "wrap",
          marginBottom: "28px",
        }}
      >
        <StatTile
          label="Total Connections"
          value={String(totalConnections)}
          color="#1A2B3C"
        />
        <StatTile
          label="Direct Introductions"
          value={String(directCount)}
          color="#10B981"
        />
        <StatTile label="One-Hop" value={String(oneHopCount)} color="#0EA5E9" />
        <StatTile label="Two-Hop" value={String(twoHopCount)} color="#F59E0B" />
      </div>

      {/* List / Graph view toggle */}
      <div
        style={{
          display: "inline-flex",
          backgroundColor: "#F8F5EE",
          borderRadius: "10px",
          padding: "4px",
          marginBottom: "20px",
          boxShadow: "0 2px 8px rgba(122,89,128,0.14)",
        }}
      >
        {(["list", "graph"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setViewMode(mode)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "13px",
              fontWeight: 700,
              padding: "8px 18px",
              borderRadius: "7px",
              border: "none",
              cursor: "pointer",
              backgroundColor: viewMode === mode ? "#7A5980" : "transparent",
              color: viewMode === mode ? "#FFFFFF" : "#64748B",
            }}
          >
            {mode === "graph" ? <Network size={14} /> : null}
            {mode === "list" ? "List View" : "Graph View"}
          </button>
        ))}
      </div>

      {loading ? (
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
      ) : viewMode === "graph" ? (
        <RelationshipGraphViz
          nodes={graphNodes}
          edges={graphEdges}
          connections={connections}
          onRequestIntroduction={(edgeId) => void handleRequestIntroduction(edgeId)}
          requestingId={requestingId}
        />
      ) : showEmpty ? (
        <div
          style={{
            backgroundColor: "#F8F5EE",
            borderRadius: "14px",
            padding: "56px 24px",
            textAlign: "center",
            boxShadow: "0 4px 20px rgba(122,89,128,0.18)",
          }}
        >
          <Network size={32} color="#94A3B8" style={{ margin: "0 auto 12px" }} />
          <p style={{ fontSize: "14px", fontWeight: 700, color: "#1A2B3C", margin: 0 }}>
            No connections discovered yet.
          </p>
          <p style={{ fontSize: "13px", color: "#64748B", marginTop: "8px" }}>
            Click Discover Connections to search your board members&rsquo;
            professional histories for warm introduction pathways.
          </p>
        </div>
      ) : (
        <div>
          {connections.map((connection) => (
            <ConnectionCard
              key={connection.id}
              connection={connection}
              onRequestIntroduction={(edgeId) =>
                void handleRequestIntroduction(edgeId)
              }
              requesting={requestingId === connection.id}
            />
          ))}
        </div>
      )}

      {/* Analytics panel */}
      <div
        style={{
          backgroundColor: "#F8F5EE",
          borderRadius: "14px",
          padding: "24px",
          marginTop: "28px",
          boxShadow: "0 4px 20px rgba(122,89,128,0.18)",
        }}
      >
        <h2
          style={{
            fontSize: "18px",
            fontWeight: 800,
            color: "#101B2D",
            letterSpacing: "-0.01em",
            margin: "0 0 18px",
          }}
        >
          Graph Analytics
        </h2>

        {analyticsError && (
          <div
            role="alert"
            style={{
              backgroundColor: "#FEF2F2",
              border: "1px solid #FECACA",
              borderRadius: "10px",
              padding: "12px 16px",
              marginBottom: "18px",
              fontSize: "13px",
              color: "#B91C1C",
            }}
          >
            {analyticsError}
          </div>
        )}

        {analyticsLoading ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "10px",
              padding: "40px 0",
              color: "#64748B",
              fontSize: "14px",
            }}
          >
            <Loader2 size={18} className="animate-spin" />
            Loading graph analytics...
          </div>
        ) : analytics ? (
          <>
            <div
              style={{
                display: "flex",
                gap: "16px",
                flexWrap: "wrap",
                marginBottom: "24px",
              }}
            >
              <StatTile
                label="Total Nodes"
                value={String(analytics.totalNodes)}
                color="#1A2B3C"
              />
              <StatTile
                label="Total Edges"
                value={String(analytics.totalEdges)}
                color="#4F6D8F"
              />
              <StatTile
                label="Avg Connections Per Foundation"
                value={analytics.avgConnectionsPerFoundation.toFixed(2)}
                color="#0EA5E9"
              />
              <StatTile
                label="Strongest Path Score"
                value={analytics.strongestPathScore.toFixed(2)}
                color="#10B981"
              />
            </div>

            <h3
              style={{
                fontSize: "13px",
                fontWeight: 700,
                color: "#1A2B3C",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                margin: "0 0 12px",
              }}
            >
              Top Foundations by Connection Count
            </h3>

            {analytics.topFoundations.length === 0 ? (
              <p
                style={{
                  fontSize: "13px",
                  color: "#64748B",
                  margin: "0 0 24px",
                }}
              >
                No foundation connections discovered yet.
              </p>
            ) : (
              <div style={{ overflowX: "auto", marginBottom: "24px" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: "13px",
                  }}
                >
                  <thead>
                    <tr>
                      {["Foundation", "Edge Count", "Avg Weight", "Top Relationship Type"].map(
                        (heading) => (
                          <th
                            key={heading}
                            style={{
                              textAlign: "left",
                              padding: "8px 12px",
                              fontSize: "11px",
                              fontWeight: 700,
                              color: "#64748B",
                              textTransform: "uppercase",
                              letterSpacing: "0.06em",
                              borderBottom: "1px solid #E2E8F0",
                            }}
                          >
                            {heading}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.topFoundations.map((foundation) => (
                      <tr key={foundation.id}>
                        <td
                          style={{
                            padding: "10px 12px",
                            fontWeight: 700,
                            color: "#0F172A",
                            borderBottom: "1px solid #F1F5F9",
                          }}
                        >
                          {foundation.label}
                        </td>
                        <td
                          style={{
                            padding: "10px 12px",
                            color: "#0F172A",
                            borderBottom: "1px solid #F1F5F9",
                          }}
                        >
                          {foundation.edgeCount}
                        </td>
                        <td
                          style={{
                            padding: "10px 12px",
                            color: "#0F172A",
                            borderBottom: "1px solid #F1F5F9",
                          }}
                        >
                          {foundation.avgWeight.toFixed(2)}
                        </td>
                        <td
                          style={{
                            padding: "10px 12px",
                            borderBottom: "1px solid #F1F5F9",
                          }}
                        >
                          <span
                            style={{
                              fontSize: "11px",
                              fontWeight: 700,
                              color: "#FFFFFF",
                              backgroundColor: "#4F6D8F",
                              borderRadius: "999px",
                              padding: "3px 10px",
                            }}
                          >
                            {humanizeEnum(foundation.topRelationshipType)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <h3
              style={{
                fontSize: "13px",
                fontWeight: 700,
                color: "#1A2B3C",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                margin: "0 0 12px",
              }}
            >
              Pattern Detection
            </h3>

            {analytics.clusters.length === 0 ? (
              <p style={{ fontSize: "13px", color: "#64748B", margin: 0 }}>
                No cross-rule patterns detected yet — patterns emerge once a
                foundation matches more than one discovery rule (NTEE
                alignment, asset compatibility, geographic giving history,
                or board network overlap).
              </p>
            ) : (
              <div>
                {analytics.clusters.map((cluster, idx) => (
                  <div
                    key={`${cluster.relationshipTypes.join("-")}-${idx}`}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "10px",
                      padding: "12px 14px",
                      backgroundColor: "#F0FDFA",
                      border: "1px solid #99F6E4",
                      borderRadius: "10px",
                      marginBottom: "10px",
                    }}
                  >
                    <Sparkles
                      size={15}
                      color="#0F766E"
                      style={{ marginTop: "2px", flexShrink: 0 }}
                    />
                    <p style={{ fontSize: "13px", color: "#0F766E", margin: 0 }}>
                      {cluster.description}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
