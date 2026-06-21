"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  DollarSign,
  ExternalLink,
  Info,
  Plus,
  Trash2,
} from "lucide-react";

import { Badge, Button, Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import {
  STATE_REGISTRATIONS,
  STATE_REGISTRATION_DISCLAIMER,
  STATE_REGISTRATION_LAST_REVIEWED,
  getStateRegistration,
} from "@/lib/autoapply/state-registration-data";

const US_STATES: { code: string; name: string }[] = [
  { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" }, { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" }, { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" },
  { code: "FL", name: "Florida" }, { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" }, { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" }, { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" }, { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" }, { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" }, { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" }, { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" }, { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" }, { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" }, { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" }, { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" }, { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" }, { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" }, { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" }, { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" }, { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" }, { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" }, { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" }, { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" }, { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" }, { code: "WY", name: "Wyoming" },
  { code: "DC", name: "District of Columbia" },
];

interface Registration {
  id: string;
  state: string;
  registration_number: string | null;
  registered_at: string | null;
  expires_at: string | null;
  status: string;
}

function isExpiringSoon(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  return new Date(expiresAt).getTime() - Date.now() < thirtyDays;
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function SolicitationCompliancePage() {
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [formState, setFormState] = useState({
    state: "",
    registration_number: "",
    registered_at: "",
    expires_at: "",
  });

  // Remove state
  const [removingId, setRemovingId] = useState<string | null>(null);

  // State-registration reference lookup
  const [refState, setRefState] = useState<string>("");
  const refInfo = refState ? getStateRegistration(refState) : undefined;

  const loadRegistrations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: fetchErr } = await supabase
        .from("solicitation_registrations")
        .select("id, state, registration_number, registered_at, expires_at, status")
        .eq("status", "active")
        .order("state");
      if (fetchErr) {
        setError(fetchErr.message);
      } else {
        setRegistrations((data ?? []) as Registration[]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRegistrations();
  }, [loadRegistrations]);

  async function handleAdd() {
    if (!formState.state) {
      setAddError("Please select a state.");
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const supabase = createClient();
      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id")
        .maybeSingle();
      const orgId = (profile as { organization_id: string } | null)?.organization_id;
      if (!orgId) {
        setAddError("Could not determine your organization. Please refresh.");
        return;
      }
      const { error: insertErr } = await supabase
        .from("solicitation_registrations")
        .insert({
          organization_id: orgId,
          state: formState.state,
          registration_number: formState.registration_number || null,
          registered_at: formState.registered_at || null,
          expires_at: formState.expires_at || null,
          status: "active",
        });
      if (insertErr) {
        setAddError(insertErr.message);
        return;
      }
      setShowAddForm(false);
      setFormState({ state: "", registration_number: "", registered_at: "", expires_at: "" });
      await loadRegistrations();
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(id: string) {
    setRemovingId(id);
    try {
      const supabase = createClient();
      await supabase
        .from("solicitation_registrations")
        .update({ status: "removed" })
        .eq("id", id);
      setRegistrations(prev => prev.filter(r => r.id !== id));
    } finally {
      setRemovingId(null);
    }
  }

  const expiringSoon = registrations.filter(r => isExpiringSoon(r.expires_at) && !isExpired(r.expires_at));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          href="/autoapply/settings"
          className="flex items-center gap-1.5 text-sm text-navy-400 hover:text-navy-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to AutoApply Settings
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
          Solicitation Registrations
        </h1>
        <p className="mt-1 text-sm text-navy-500">
          Most US states require nonprofits to register before soliciting donations. AutoApply skips funders in states where your organization isn&apos;t registered.
        </p>
      </div>

      {/* Expiring soon warning */}
      {expiringSoon.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
          <div>
            <p className="text-sm font-medium text-amber-800">
              {expiringSoon.length === 1
                ? "1 registration expires within 30 days"
                : `${expiringSoon.length} registrations expire within 30 days`}
            </p>
            <p className="mt-0.5 text-xs text-amber-700">
              {expiringSoon.map(r => r.state).join(", ")} — renew before expiration to avoid submissions being paused.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <Card
        title="Active Registrations"
        description="States where your organization is registered to solicit charitable contributions."
      >
        <div className="space-y-4">
          {/* Add button */}
          <div className="flex justify-end">
            <Button
              variant="secondary"
              onClick={() => {
                setShowAddForm(v => !v);
                setAddError(null);
              }}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Add Registration
            </Button>
          </div>

          {/* Inline add form */}
          {showAddForm && (
            <div className="rounded-lg border border-navy-200 bg-navy-50 p-4">
              <h3 className="mb-3 text-sm font-medium text-navy-900">New Registration</h3>
              {addError && (
                <p className="mb-3 text-sm text-red-600">{addError}</p>
              )}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <label htmlFor="reg-state" className="block text-xs font-medium text-navy-700">
                    State <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="reg-state"
                    value={formState.state}
                    onChange={e => setFormState(s => ({ ...s, state: e.target.value }))}
                    className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-2 py-1.5 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
                  >
                    <option value="">Select…</option>
                    {US_STATES.filter(s => !registrations.some(r => r.state === s.code)).map(s => (
                      <option key={s.code} value={s.code}>
                        {s.code} — {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="reg-number" className="block text-xs font-medium text-navy-700">
                    Registration #
                  </label>
                  <input
                    id="reg-number"
                    type="text"
                    placeholder="Optional"
                    value={formState.registration_number}
                    onChange={e => setFormState(s => ({ ...s, registration_number: e.target.value }))}
                    className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-2 py-1.5 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
                  />
                </div>
                <div>
                  <label htmlFor="reg-date" className="block text-xs font-medium text-navy-700">
                    Registered On
                  </label>
                  <input
                    id="reg-date"
                    type="date"
                    value={formState.registered_at}
                    onChange={e => setFormState(s => ({ ...s, registered_at: e.target.value }))}
                    className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-2 py-1.5 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
                  />
                </div>
                <div>
                  <label htmlFor="reg-expires" className="block text-xs font-medium text-navy-700">
                    Expires On
                  </label>
                  <input
                    id="reg-expires"
                    type="date"
                    value={formState.expires_at}
                    onChange={e => setFormState(s => ({ ...s, expires_at: e.target.value }))}
                    className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-2 py-1.5 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
                  />
                </div>
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => { setShowAddForm(false); setAddError(null); }}
                >
                  Cancel
                </Button>
                <Button onClick={() => void handleAdd()} isLoading={adding} disabled={adding}>
                  Save Registration
                </Button>
              </div>
            </div>
          )}

          {/* Table */}
          {loading ? (
            <p className="py-4 text-center text-sm text-navy-400">Loading…</p>
          ) : registrations.length === 0 ? (
            <div className="rounded-lg border border-dashed border-navy-200 py-10 text-center">
              <p className="text-sm font-medium text-navy-600">No registrations yet</p>
              <p className="mt-1 text-xs text-navy-400">
                Add a state registration to allow AutoApply to queue funders there.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-navy-100">
                    <th className="pb-2 text-left text-xs font-medium uppercase tracking-wide text-navy-400">State</th>
                    <th className="pb-2 text-left text-xs font-medium uppercase tracking-wide text-navy-400">Reg. Number</th>
                    <th className="pb-2 text-left text-xs font-medium uppercase tracking-wide text-navy-400">Registered</th>
                    <th className="pb-2 text-left text-xs font-medium uppercase tracking-wide text-navy-400">Expires</th>
                    <th className="pb-2 text-left text-xs font-medium uppercase tracking-wide text-navy-400">Status</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-50">
                  {registrations.map(reg => {
                    const expired = isExpired(reg.expires_at);
                    const expiring = isExpiringSoon(reg.expires_at) && !expired;
                    return (
                      <tr key={reg.id} className="group">
                        <td className="py-3 pr-4 font-medium text-navy-900">
                          {reg.state}
                          {(() => {
                            const stateName = US_STATES.find(s => s.code === reg.state)?.name;
                            return stateName ? (
                              <span className="ml-1.5 text-xs font-normal text-navy-400">{stateName}</span>
                            ) : null;
                          })()}
                        </td>
                        <td className="py-3 pr-4 text-navy-600">{reg.registration_number ?? "—"}</td>
                        <td className="py-3 pr-4 text-navy-500">{formatDate(reg.registered_at)}</td>
                        <td className="py-3 pr-4">
                          <span className={expired ? "text-red-600" : expiring ? "text-amber-600 font-medium" : "text-navy-500"}>
                            {formatDate(reg.expires_at)}
                          </span>
                        </td>
                        <td className="py-3 pr-4">
                          {expired ? (
                            <Badge color="red">Expired</Badge>
                          ) : expiring ? (
                            <Badge color="yellow">Expiring soon</Badge>
                          ) : (
                            <Badge color="green">Active</Badge>
                          )}
                        </td>
                        <td className="py-3 text-right">
                          <button
                            type="button"
                            onClick={() => void handleRemove(reg.id)}
                            disabled={removingId === reg.id}
                            aria-label={`Remove ${reg.state} registration`}
                            className="text-navy-300 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100 disabled:opacity-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      {/* State registration requirements reference */}
      <Card
        title="Registration Requirements by State"
        description="41 states (40 + DC) require charitable solicitation registration before you can fundraise there. Select a state for its fee, portal, renewal, and exemption details."
      >
        <div className="space-y-4">
          <div className="max-w-xs">
            <label htmlFor="ref-state" className="block text-xs font-medium text-navy-700">
              State
            </label>
            <select
              id="ref-state"
              value={refState}
              onChange={(e) => setRefState(e.target.value)}
              className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-2 py-1.5 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
            >
              <option value="">Select a state…</option>
              {STATE_REGISTRATIONS.map((s) => (
                <option key={s.abbreviation} value={s.abbreviation}>
                  {s.abbreviation} — {s.state}
                </option>
              ))}
            </select>
          </div>

          {refInfo && (
            <div className="rounded-lg border border-navy-200 bg-white p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold text-navy-900">{refInfo.state}</h3>
                  <p className="mt-0.5 text-xs text-navy-500">{refInfo.agency}</p>
                </div>
                <a
                  href={refInfo.registrationPortalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-teal-700"
                >
                  Register Now
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>

              <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="flex items-start gap-2">
                  <DollarSign className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-navy-400">
                      Registration Fee
                    </dt>
                    <dd className="text-sm text-navy-800">{refInfo.registrationFee}</dd>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-navy-400">
                      Renewal
                    </dt>
                    <dd className="text-sm text-navy-800">
                      {refInfo.renewalFrequency}
                      <span className="block text-xs text-navy-500">{refInfo.renewalInfo}</span>
                    </dd>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-navy-400">
                      Exemption
                    </dt>
                    <dd className="text-sm text-navy-800">{refInfo.exemptionThreshold}</dd>
                  </div>
                </div>
              </dl>

              {refInfo.notes && (
                <p className="mt-4 rounded-md bg-navy-50 px-3 py-2 text-xs text-navy-600">
                  <strong className="text-navy-700">Note:</strong> {refInfo.notes}
                </p>
              )}
            </div>
          )}

          <p className="text-xs text-navy-400">
            {STATE_REGISTRATION_DISCLAIMER} Reference data last reviewed{" "}
            {STATE_REGISTRATION_LAST_REVIEWED}.
          </p>
        </div>
      </Card>

      <div className="rounded-lg border border-navy-100 bg-navy-50 px-4 py-3 text-xs text-navy-500">
        <strong className="text-navy-700">How this works:</strong> When AutoApply queues funders, it checks whether your organization is registered to solicit in each funder&apos;s state. Funders in unregistered states are skipped with reason <code className="rounded bg-navy-100 px-1 py-0.5">compliance_hold</code> and will not be auto-queued until you add a registration for that state. If a funder has no state on record, it is allowed through.
      </div>
    </div>
  );
}
