"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, Globe, Map as MapIcon, MapPin, Rocket } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Badge, Button, Card, Input } from "@/components/ui";
import { TaxonomyCombobox, type TaxonomyComboboxOption } from "@/components/donor-discovery/TaxonomyCombobox";
import { cn } from "@/lib/utils/cn";

type GeographyMode = "radius" | "states" | "national";

interface GeocodeResult {
  lat: number;
  lng: number;
  formatted_address: string;
  state: string | null;
  county: string | null;
  zip: string | null;
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

export default function NewDonorDiscoveryPage() {
  const router = useRouter();

  const [step, setStep] = useState(1);

  // Taxonomy state
  const [selected, setSelected] = useState<TaxonomyComboboxOption[]>([]);

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
          state: payload.state ?? null,
          county: payload.county ?? null,
          zip: payload.zip ?? null,
        });
      }
    } catch {
      setGeocodeError("Could not reach the geocoding service.");
    }
    setGeocoding(false);
  }

  const step1Valid = selected.length > 0;
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
          taxonomy_ids: selected.map((option) => option.id),
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
          description="Search for a trade, service, or material to find matching NAICS industries and civic entity types."
        >
          <TaxonomyCombobox selected={selected} onChange={setSelected} />
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
                  <div className="space-y-0.5">
                    <p className="flex items-center gap-1.5 text-sm text-teal-700">
                      <Check className="h-4 w-4" aria-hidden />
                      Resolved: {geocodeResult.formatted_address}
                    </p>
                    {(geocodeResult.county || geocodeResult.state || geocodeResult.zip) && (
                      <p className="pl-[22px] text-xs text-navy-500">
                        {[geocodeResult.county, geocodeResult.state, geocodeResult.zip]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                  </div>
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
                  Taxonomy ({selected.length})
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {selected.map((option) => (
                    <Badge key={option.id} color="teal">
                      {option.label}
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
