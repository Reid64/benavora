"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Globe,
  Loader2,
  Map as MapIcon,
  MapPin,
  Rocket,
  X,
} from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Badge, Button, Card, EmptyState, Input } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

interface TaxonomyNode {
  id: string;
  kind: string;
  code: string;
  label: string;
  parent_id: string | null;
}

type GeographyMode = "radius" | "states" | "national";

interface GeocodeResult {
  lat: number;
  lng: number;
  formatted_address: string;
}

const STEPS = [
  { id: 1, title: "Taxonomy" },
  { id: 2, title: "Geography" },
  { id: 3, title: "Review & Launch" },
] as const;

const STATE_OPTIONS: { value: string; label: string }[] = [
  { value: "AL", label: "Alabama" },
  { value: "AK", label: "Alaska" },
  { value: "AZ", label: "Arizona" },
  { value: "AR", label: "Arkansas" },
  { value: "CA", label: "California" },
  { value: "CO", label: "Colorado" },
  { value: "CT", label: "Connecticut" },
  { value: "DE", label: "Delaware" },
  { value: "DC", label: "Washington D.C." },
  { value: "FL", label: "Florida" },
  { value: "GA", label: "Georgia" },
  { value: "HI", label: "Hawaii" },
  { value: "ID", label: "Idaho" },
  { value: "IL", label: "Illinois" },
  { value: "IN", label: "Indiana" },
  { value: "IA", label: "Iowa" },
  { value: "KS", label: "Kansas" },
  { value: "KY", label: "Kentucky" },
  { value: "LA", label: "Louisiana" },
  { value: "ME", label: "Maine" },
  { value: "MD", label: "Maryland" },
  { value: "MA", label: "Massachusetts" },
  { value: "MI", label: "Michigan" },
  { value: "MN", label: "Minnesota" },
  { value: "MS", label: "Mississippi" },
  { value: "MO", label: "Missouri" },
  { value: "MT", label: "Montana" },
  { value: "NE", label: "Nebraska" },
  { value: "NV", label: "Nevada" },
  { value: "NH", label: "New Hampshire" },
  { value: "NJ", label: "New Jersey" },
  { value: "NM", label: "New Mexico" },
  { value: "NY", label: "New York" },
  { value: "NC", label: "North Carolina" },
  { value: "ND", label: "North Dakota" },
  { value: "OH", label: "Ohio" },
  { value: "OK", label: "Oklahoma" },
  { value: "OR", label: "Oregon" },
  { value: "PA", label: "Pennsylvania" },
  { value: "RI", label: "Rhode Island" },
  { value: "SC", label: "South Carolina" },
  { value: "SD", label: "South Dakota" },
  { value: "TN", label: "Tennessee" },
  { value: "TX", label: "Texas" },
  { value: "UT", label: "Utah" },
  { value: "VT", label: "Vermont" },
  { value: "VA", label: "Virginia" },
  { value: "WA", label: "Washington" },
  { value: "WV", label: "West Virginia" },
  { value: "WI", label: "Wisconsin" },
  { value: "WY", label: "Wyoming" },
];

const PAGE = 1000;

/** Fetches every row of the shared, no-RLS taxonomy table (paginated — the
 * NAICS branch alone is ~1,400 rows, well past PostgREST's default page cap). */
async function fetchAllTaxonomy(): Promise<TaxonomyNode[]> {
  const supabase = createClient();
  const rows: TaxonomyNode[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("donor_discovery_taxonomy")
      .select("id, kind, code, label, parent_id")
      .order("label", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error || !data) break;
    rows.push(...(data as TaxonomyNode[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

function ancestryLabel(node: TaxonomyNode, byId: Map<string, TaxonomyNode>): string {
  const path: string[] = [node.label];
  let cur = node;
  while (cur.parent_id) {
    const parent = byId.get(cur.parent_id);
    if (!parent) break;
    path.unshift(parent.label);
    cur = parent;
  }
  return path.join(" › ");
}

function TaxonomyRow({
  node,
  depth,
  childrenOf,
  expandedIds,
  onToggleExpand,
  selectedIds,
  onToggleSelect,
}: {
  node: TaxonomyNode;
  depth: number;
  childrenOf: Map<string, TaxonomyNode[]>;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
  selectedIds: Set<string>;
  onToggleSelect: (node: TaxonomyNode) => void;
}) {
  const children = (childrenOf.get(node.id) ?? []).slice().sort((a, b) => a.label.localeCompare(b.label));
  const hasChildren = children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const isSelected = selectedIds.has(node.id);

  return (
    <div>
      <div
        className="flex items-center gap-2 rounded-md py-1.5 pr-2 hover:bg-surface-sunken"
        style={{ paddingLeft: `${depth * 1.25 + 0.5}rem` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggleExpand(node.id)}
            className="shrink-0 text-text-muted hover:text-text"
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            <ChevronDown className={cn("h-4 w-4 transition-transform", !isExpanded && "-rotate-90")} aria-hidden />
          </button>
        ) : (
          <span className="w-4 shrink-0" aria-hidden />
        )}
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect(node)}
          className="h-4 w-4 shrink-0 rounded border-navy-300 text-teal-500 accent-teal-500 focus:ring-teal-500"
          aria-label={node.label}
        />
        <span className="truncate text-sm text-text">{node.label}</span>
        <span className="ml-auto shrink-0 text-xs text-text-muted">{node.code}</span>
      </div>
      {hasChildren && isExpanded && (
        <div>
          {children.map((child) => (
            <TaxonomyRow
              key={child.id}
              node={child}
              depth={depth + 1}
              childrenOf={childrenOf}
              expandedIds={expandedIds}
              onToggleExpand={onToggleExpand}
              selectedIds={selectedIds}
              onToggleSelect={onToggleSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function NewDonorDiscoveryPage() {
  const router = useRouter();

  const [step, setStep] = useState(1);

  // Taxonomy state
  const [taxonomyLoading, setTaxonomyLoading] = useState(true);
  const [nodes, setNodes] = useState<TaxonomyNode[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedNodes, setSelectedNodes] = useState<Map<string, TaxonomyNode>>(new Map());

  // Geography state
  const [geoMode, setGeoMode] = useState<GeographyMode>("radius");
  const [address, setAddress] = useState("");
  const [geocodeResult, setGeocodeResult] = useState<GeocodeResult | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);
  const [radiusMiles, setRadiusMiles] = useState(25);
  const [selectedStates, setSelectedStates] = useState<Set<string>>(new Set());

  // Review + launch state
  const [requestName, setRequestName] = useState("");
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const rows = await fetchAllTaxonomy();
      if (active) {
        setNodes(rows);
        setTaxonomyLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const childrenOf = useMemo(() => {
    const map = new Map<string, TaxonomyNode[]>();
    for (const n of nodes) {
      if (n.parent_id) {
        const arr = map.get(n.parent_id) ?? [];
        arr.push(n);
        map.set(n.parent_id, arr);
      }
    }
    return map;
  }, [nodes]);

  const naicsSectors = useMemo(
    () =>
      nodes
        .filter((n) => n.kind === "naics" && n.parent_id === null)
        .slice()
        .sort((a, b) => a.label.localeCompare(b.label)),
    [nodes],
  );

  const civicNodes = useMemo(
    () => nodes.filter((n) => n.kind !== "naics").slice().sort((a, b) => a.label.localeCompare(b.label)),
    [nodes],
  );

  const selectedIdSet = useMemo(() => new Set(selectedNodes.keys()), [selectedNodes]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return nodes
      .filter((n) => n.label.toLowerCase().includes(q) || n.code.toLowerCase().includes(q))
      .slice(0, 200);
  }, [nodes, searchQuery]);

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelect(node: TaxonomyNode) {
    setSelectedNodes((prev) => {
      const next = new Map(prev);
      if (next.has(node.id)) next.delete(node.id);
      else next.set(node.id, node);
      return next;
    });
  }

  function toggleState(code: string) {
    setSelectedStates((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  const handleAddressChange = useCallback((value: string) => {
    setAddress(value);
    setGeocodeResult(null);
    setGeocodeError(null);
  }, []);

  async function handleGeocode() {
    if (address.trim().length === 0) return;
    setGeocoding(true);
    setGeocodeError(null);
    try {
      const res = await fetch("/api/donor-discovery/geocode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: address.trim() }),
      });
      const payload = (await res.json().catch(() => ({}))) as Partial<GeocodeResult> & { error?: string };
      if (!res.ok || payload.lat == null || payload.lng == null) {
        setGeocodeError(payload.error ?? "Could not geocode that address.");
      } else {
        setGeocodeResult({
          lat: payload.lat,
          lng: payload.lng,
          formatted_address: payload.formatted_address ?? address.trim(),
        });
      }
    } catch {
      setGeocodeError("Could not reach the geocoding service.");
    }
    setGeocoding(false);
  }

  const step1Valid = selectedNodes.size > 0;
  const step2Valid =
    geoMode === "national" ||
    (geoMode === "radius" && geocodeResult !== null && radiusMiles > 0) ||
    (geoMode === "states" && selectedStates.size > 0);
  const step3Valid = requestName.trim().length > 0 && step1Valid && step2Valid;

  function geographySummary(): string {
    if (geoMode === "national") return "National — all US regions.";
    if (geoMode === "radius") {
      return geocodeResult
        ? `${radiusMiles} mi radius around ${geocodeResult.formatted_address}`
        : "No address geocoded yet.";
    }
    return selectedStates.size > 0
      ? `${selectedStates.size} state${selectedStates.size === 1 ? "" : "s"}: ${Array.from(selectedStates).sort().join(", ")}`
      : "No states selected yet.";
  }

  function buildGeography(): Record<string, unknown> {
    if (geoMode === "national") return { national: true };
    if (geoMode === "radius" && geocodeResult) {
      return { center: { lat: geocodeResult.lat, lng: geocodeResult.lng }, radius_mi: radiusMiles };
    }
    return { states: Array.from(selectedStates) };
  }

  async function handleLaunch() {
    if (!step3Valid) return;
    setLaunching(true);
    setLaunchError(null);
    try {
      const res = await fetch("/api/donor-discovery/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: requestName.trim(),
          taxonomy_ids: Array.from(selectedNodes.keys()),
          geography: buildGeography(),
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setLaunchError(payload.error ?? "Failed to launch the discovery request.");
        setLaunching(false);
        return;
      }
      router.push("/donor-discovery");
    } catch {
      setLaunchError("Could not reach the server. Please try again.");
      setLaunching(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="New Discovery" description="Find new donor prospects by industry and geography." />

      {/* Step indicator */}
      <div className="flex items-center justify-between">
        {STEPS.map((s, i) => {
          const done = step > s.id;
          const active = step === s.id;
          return (
            <div key={s.id} className="flex flex-1 items-center">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                    done
                      ? "bg-teal-500 text-white"
                      : active
                        ? "bg-navy-900 text-white"
                        : "bg-navy-100 text-navy-400",
                  )}
                >
                  {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : s.id}
                </span>
                <span className={cn("text-sm font-medium", active ? "text-navy-900" : "text-navy-400")}>
                  {s.title}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={cn("mx-3 h-0.5 flex-1", done ? "bg-teal-500" : "bg-navy-100")} aria-hidden />
              )}
            </div>
          );
        })}
      </div>

      {/* Step 1: Taxonomy */}
      {step === 1 && (
        <Card
          title="Pick industries & entity types"
          description="Search or browse the taxonomy tree. Select any mix of NAICS industries and civic entity types."
        >
          {taxonomyLoading ? (
            <div className="flex items-center justify-center py-10 text-sm text-text-muted">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              Loading taxonomy…
            </div>
          ) : nodes.length === 0 ? (
            <EmptyState
              icon={AlertCircle}
              title="Taxonomy not seeded"
              description='Run "pnpm seed:dd-taxonomy" to populate the NAICS and civic taxonomy before launching a discovery request.'
            />
          ) : (
            <div className="space-y-4">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name or NAICS code…"
              />

              <div className="max-h-96 overflow-y-auto rounded-lg border border-border">
                {searchQuery.trim() ? (
                  searchResults.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-text-muted">
                      No taxonomy nodes match &ldquo;{searchQuery}&rdquo;.
                    </p>
                  ) : (
                    <div className="divide-y divide-border">
                      {searchResults.map((n) => (
                        <label
                          key={n.id}
                          className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-surface-sunken"
                        >
                          <input
                            type="checkbox"
                            checked={selectedNodes.has(n.id)}
                            onChange={() => toggleSelect(n)}
                            className="h-4 w-4 shrink-0 rounded border-navy-300 text-teal-500 accent-teal-500 focus:ring-teal-500"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-text">{ancestryLabel(n, nodesById)}</span>
                          </span>
                          <span className="shrink-0 text-xs text-text-muted">{n.code}</span>
                        </label>
                      ))}
                    </div>
                  )
                ) : (
                  <div className="p-2">
                    <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-widest text-text-muted">
                      NAICS Sectors
                    </p>
                    {naicsSectors.map((sector) => (
                      <TaxonomyRow
                        key={sector.id}
                        node={sector}
                        depth={0}
                        childrenOf={childrenOf}
                        expandedIds={expandedIds}
                        onToggleExpand={toggleExpand}
                        selectedIds={selectedIdSet}
                        onToggleSelect={toggleSelect}
                      />
                    ))}
                    {civicNodes.length > 0 && (
                      <>
                        <p className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest text-text-muted">
                          Civic &amp; Association Entities
                        </p>
                        {civicNodes.map((n) => (
                          <TaxonomyRow
                            key={n.id}
                            node={n}
                            depth={0}
                            childrenOf={childrenOf}
                            expandedIds={expandedIds}
                            onToggleExpand={toggleExpand}
                            selectedIds={selectedIdSet}
                            onToggleSelect={toggleSelect}
                          />
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>

              {selectedNodes.size > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-text-muted">
                    {selectedNodes.size} selected
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from(selectedNodes.values()).map((n) => (
                      <Badge key={n.id} color="teal" className="gap-1 pr-1">
                        {n.label}
                        <button
                          type="button"
                          onClick={() => toggleSelect(n)}
                          className="rounded-full p-0.5 hover:bg-black/10"
                          aria-label={`Remove ${n.label}`}
                        >
                          <X className="h-3 w-3" aria-hidden />
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {/* Step 2: Geography */}
      {step === 2 && (
        <Card title="Where should we look?" description="Choose one geography scope for this discovery request.">
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {(
                [
                  { mode: "radius" as const, icon: MapPin, label: "Radius", desc: "Around an address" },
                  { mode: "states" as const, icon: MapIcon, label: "States", desc: "One or more states" },
                  { mode: "national" as const, icon: Globe, label: "National", desc: "All of the US" },
                ]
              ).map((opt) => (
                <button
                  key={opt.mode}
                  type="button"
                  onClick={() => setGeoMode(opt.mode)}
                  className={cn(
                    "flex flex-col items-start gap-1 rounded-xl border px-4 py-3 text-left transition",
                    geoMode === opt.mode
                      ? "border-teal-400 bg-teal-50 ring-1 ring-teal-200"
                      : "border-border hover:border-navy-300",
                  )}
                >
                  <opt.icon
                    className={cn("h-5 w-5", geoMode === opt.mode ? "text-teal-600" : "text-navy-400")}
                    aria-hidden
                  />
                  <span className="text-sm font-semibold text-navy-900">{opt.label}</span>
                  <span className="text-xs text-navy-500">{opt.desc}</span>
                </button>
              ))}
            </div>

            {geoMode === "radius" && (
              <div className="space-y-3">
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Input
                      label="Address"
                      value={address}
                      onChange={(e) => handleAddressChange(e.target.value)}
                      placeholder="123 Main St, Austin, TX"
                    />
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => void handleGeocode()}
                    disabled={geocoding || address.trim().length === 0}
                    isLoading={geocoding}
                  >
                    Geocode
                  </Button>
                </div>
                {geocodeError && <p className="text-sm text-red-600">{geocodeError}</p>}
                {geocodeResult && (
                  <p className="flex items-center gap-1.5 text-sm text-teal-700">
                    <Check className="h-4 w-4" aria-hidden />
                    Resolved: {geocodeResult.formatted_address}
                  </p>
                )}
                <Input
                  type="number"
                  min={1}
                  max={500}
                  label="Radius (miles)"
                  value={radiusMiles}
                  onChange={(e) => setRadiusMiles(Math.max(1, Number(e.target.value) || 1))}
                  helperText="Radii beyond ~31 miles are capped by the Places API during enumeration."
                />
              </div>
            )}

            {geoMode === "states" && (
              <div>
                <p className="mb-2 text-xs font-medium text-text-muted">
                  {selectedStates.size} state{selectedStates.size === 1 ? "" : "s"} selected
                </p>
                <div className="grid max-h-64 grid-cols-2 gap-x-4 gap-y-1 overflow-y-auto rounded-lg border border-border p-3 sm:grid-cols-3 lg:grid-cols-4">
                  {STATE_OPTIONS.map((s) => (
                    <label key={s.value} className="flex cursor-pointer items-center gap-2 py-0.5 text-sm text-text">
                      <input
                        type="checkbox"
                        checked={selectedStates.has(s.value)}
                        onChange={() => toggleState(s.value)}
                        className="h-4 w-4 shrink-0 rounded border-navy-300 text-teal-500 accent-teal-500 focus:ring-teal-500"
                      />
                      {s.label}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {geoMode === "national" && (
              <p className="text-sm text-navy-500">
                This request is not scoped to a specific location — enumeration runs across all US regions.
              </p>
            )}
          </div>
        </Card>
      )}

      {/* Step 3: Review & launch */}
      {step === 3 && (
        <Card title="Review & launch" description="Name this request and confirm before launching.">
          <div className="space-y-5">
            <Input
              label="Request name"
              required
              value={requestName}
              onChange={(e) => setRequestName(e.target.value)}
              placeholder="e.g. Septic installers near Austin"
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-border p-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-text-muted">
                  Taxonomy ({selectedNodes.size})
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {Array.from(selectedNodes.values()).map((n) => (
                    <Badge key={n.id} color="teal">
                      {n.label}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-border p-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-text-muted">Geography</p>
                <p className="mt-2 text-sm text-text">{geographySummary()}</p>
              </div>
            </div>

            {launchError && (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {launchError}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Wizard navigation */}
      <div className="flex items-center justify-between border-t border-border pt-4">
        <Button variant="secondary" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1}>
          <ChevronLeft className="h-4 w-4" aria-hidden />
          Back
        </Button>
        {step < 3 ? (
          <Button
            onClick={() => setStep((s) => Math.min(3, s + 1))}
            disabled={(step === 1 && !step1Valid) || (step === 2 && !step2Valid)}
          >
            Continue
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        ) : (
          <Button onClick={() => void handleLaunch()} disabled={!step3Valid || launching} isLoading={launching}>
            {!launching && <Rocket className="h-4 w-4" aria-hidden />}
            {launching ? "Launching…" : "Launch Discovery"}
          </Button>
        )}
      </div>
    </div>
  );
}
