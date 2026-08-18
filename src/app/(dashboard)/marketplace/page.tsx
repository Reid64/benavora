"use client";

// Donation Recommendation Marketplace — MVP browse/list + rule-based match +
// minimal request/approve flow (FEATURE_REGISTRY_v2.md rows #121-125).
//
// Explicitly NOT built this pass, per this feature's own scoped-down MVP
// task: row #125 (IRS-compliant receipt generator) and the AI half of row
// #123 (an AI match engine — this page's matches are rule-based only, see
// src/lib/marketplace/matcher.ts). No payment/value-transfer logic exists.
//
// Inline hex per STANDING_DIRECTIVES.md Directive 4 ("The One UI Rule") —
// no Tailwind color classes, no CSS variables for color/background.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Gift, Loader2, Plus } from "lucide-react";

import { canEdit, useProfile } from "@/lib/hooks/useProfile";

// Applications & Pipeline section treatment — PAGE_TREATMENT_PROTOCOL_V2.md.
// Frame: Deep Navy. Secondary accent: Teal. The status tone maps below are
// real meaning-carrying badges (listing/match lifecycle state), not touched.
const FRAME_NAVY = "#101B2D";
const ACCENT_TEAL = "#2E6B66";
const CARD_BG = "#F8F5EE";

const CATEGORY_LABELS: Record<string, string> = {
  corporate_donation: "Corporate Donation",
  corporate_sponsorship: "Corporate Sponsorship",
  corporate_foundation: "Corporate Foundation",
  private_foundation: "Private Foundation",
  government_grant: "Government Grant",
  local_community_grant: "Local Community Grant",
  housing_grant: "Housing Grant",
  education_grant: "Education Grant",
  faith_compatible_grant: "Faith-Compatible Grant",
  in_kind_donation: "In-Kind Donation",
  materials_donation: "Materials Donation",
  down_payment_assistance: "Down Payment Assistance",
};

const LISTING_STATUS_TONE: Record<string, { bg: string; color: string }> = {
  active: { bg: "#F0FDF4", color: "#16A34A" },
  matched: { bg: "#EFF6FF", color: "#0077B6" },
  fulfilled: { bg: "#F5F3FF", color: "#7C3AED" },
  expired: { bg: "#F1F5F9", color: "#64748B" },
  cancelled: { bg: "#FEF2F2", color: "#B91C1C" },
};

const MATCH_STATUS_TONE: Record<string, { bg: string; color: string }> = {
  suggested: { bg: "#F1F5F9", color: "#64748B" },
  requested: { bg: "#FFFBEB", color: "#D97706" },
  approved: { bg: "#F0FDF4", color: "#16A34A" },
  declined: { bg: "#FEF2F2", color: "#B91C1C" },
  withdrawn: { bg: "#F1F5F9", color: "#94A3B8" },
};

const DEFAULT_TONE = { bg: "#F1F5F9", color: "#64748B" };

interface Listing {
  id: string;
  organization_id: string;
  title: string;
  description: string | null;
  category: string;
  item_type: string | null;
  quantity: string | null;
  estimated_value: number | null;
  geographic_scope: string | null;
  status: string;
  expires_at: string | null;
  is_seed_data: boolean;
  created_at: string;
  organizations: { name: string } | { name: string }[] | null;
}

interface MatchListingRef {
  id: string;
  title: string;
  category: string;
  organization_id: string;
  status: string;
}

interface Match {
  id: string;
  listing_id: string;
  organization_id: string;
  match_reason: string;
  status: string;
  requested_at: string | null;
  responded_at: string | null;
  created_at: string;
  organizations: { name: string } | { name: string }[] | null;
  marketplace_listings: MatchListingRef | MatchListingRef[] | null;
}

function firstOf<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function formatCurrency(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const frameStyle: React.CSSProperties = {
  backgroundColor: FRAME_NAVY,
  borderRadius: "16px",
  boxShadow: "0 4px 20px rgba(16,27,45,0.22)",
  padding: "4px",
};

const cardStyle: React.CSSProperties = {
  backgroundColor: CARD_BG,
  borderRadius: "13px",
  padding: "20px",
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: "16px",
  fontWeight: 700,
  color: FRAME_NAVY,
  marginBottom: "12px",
};

const badgeStyle = (bg: string, color: string): React.CSSProperties => ({
  display: "inline-block",
  backgroundColor: bg,
  color,
  fontSize: "11px",
  fontWeight: 700,
  padding: "3px 10px",
  borderRadius: "999px",
  textTransform: "uppercase",
  letterSpacing: "0.03em",
});

const buttonStyle = (variant: "primary" | "secondary" | "danger" = "primary"): React.CSSProperties => {
  const tones = {
    primary: { bg: ACCENT_TEAL, color: CARD_BG, border: "none" },
    secondary: { bg: "rgba(16,27,45,0.06)", color: FRAME_NAVY, border: "1px solid rgba(16,27,45,0.18)" },
    danger: { bg: "#FEF2F2", color: "#B91C1C", border: "none" },
  }[variant];
  return {
    backgroundColor: tones.bg,
    color: tones.color,
    border: tones.border,
    fontSize: "13px",
    fontWeight: 700,
    padding: "8px 16px",
    borderRadius: "8px",
    cursor: "pointer",
  };
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  fontSize: "14px",
  padding: "8px 12px",
  borderRadius: "8px",
  border: "1px solid rgba(16,27,45,0.18)",
  color: FRAME_NAVY,
  backgroundColor: CARD_BG,
};

export default function MarketplacePage() {
  const { profile } = useProfile();
  const [listings, setListings] = useState<Listing[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);

  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "in_kind_donation",
    itemType: "",
    quantity: "",
    estimatedValue: "",
    geographicScope: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [listingsRes, matchesRes] = await Promise.all([
        fetch("/api/marketplace/listings"),
        fetch("/api/marketplace/matches"),
      ]);
      if (!listingsRes.ok || !matchesRes.ok) throw new Error("load_failed");
      const listingsJson = (await listingsRes.json()) as { data: Listing[] };
      const matchesJson = (await matchesRes.json()) as { data: Match[] };
      setListings(listingsJson.data);
      setMatches(matchesJson.data);
    } catch {
      setError("Could not load the marketplace.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const orgId = profile?.organization_id;

  const ownListings = useMemo(
    () => listings.filter((l) => l.organization_id === orgId),
    [listings, orgId],
  );
  const matchedToMe = useMemo(
    () => matches.filter((m) => m.organization_id === orgId),
    [matches, orgId],
  );
  const incomingOnMyListings = useMemo(
    () =>
      matches.filter((m) => {
        const listing = firstOf(m.marketplace_listings);
        return listing?.organization_id === orgId;
      }),
    [matches, orgId],
  );

  const editable = canEdit(profile?.role);

  const submitListing = useCallback(async () => {
    if (!form.title.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/marketplace/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          description: form.description || undefined,
          category: form.category,
          itemType: form.itemType || undefined,
          quantity: form.quantity || undefined,
          estimatedValue: form.estimatedValue ? Number(form.estimatedValue) : undefined,
          geographicScope: form.geographicScope || undefined,
        }),
      });
      if (!res.ok) throw new Error("create_failed");
      setForm({
        title: "",
        description: "",
        category: "in_kind_donation",
        itemType: "",
        quantity: "",
        estimatedValue: "",
        geographicScope: "",
      });
      setShowForm(false);
      await load();
    } catch {
      setError("Could not create the listing.");
    } finally {
      setSubmitting(false);
    }
  }, [form, load]);

  const act = useCallback(
    async (matchId: string, action: "request" | "withdraw" | "approve" | "decline") => {
      setActionId(matchId);
      try {
        const res = await fetch(`/api/marketplace/matches/${matchId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        if (!res.ok) throw new Error("action_failed");
        await load();
      } catch {
        setError("That action could not be completed.");
      } finally {
        setActionId(null);
      }
    },
    [load],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ fontSize: "24px", fontWeight: 800, color: FRAME_NAVY, display: "flex", alignItems: "center", gap: "10px" }}>
            <Gift size={22} color={ACCENT_TEAL} aria-hidden />
            Donation Marketplace
          </h1>
          <p style={{ fontSize: "13px", color: "#64748B", marginTop: "4px" }}>
            Post available donations, and see what has been matched to your organization by category
            and geographic overlap.
          </p>
        </div>
        {editable && (
          <button type="button" style={buttonStyle("primary")} onClick={() => setShowForm((v) => !v)}>
            <Plus size={14} style={{ verticalAlign: "-2px", marginRight: "4px" }} aria-hidden />
            New Listing
          </button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          style={{
            borderRadius: "10px",
            border: "1px solid #FCA5A5",
            backgroundColor: "#FEF2F2",
            color: "#B91C1C",
            padding: "10px 14px",
            fontSize: "13px",
          }}
        >
          {error}
        </div>
      )}

      {showForm && (
        <div style={frameStyle}>
        <div style={cardStyle}>
          <div style={sectionTitleStyle}>Post a Donation</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px" }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={{ fontSize: "12px", color: "#64748B", fontWeight: 600 }}>Title</label>
              <input
                style={inputStyle}
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Surplus office furniture"
              />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={{ fontSize: "12px", color: "#64748B", fontWeight: 600 }}>Description</label>
              <input
                style={inputStyle}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div>
              <label style={{ fontSize: "12px", color: "#64748B", fontWeight: 600 }}>Category</label>
              <select
                style={inputStyle}
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              >
                {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: "12px", color: "#64748B", fontWeight: 600 }}>Item Type</label>
              <input
                style={inputStyle}
                value={form.itemType}
                onChange={(e) => setForm((f) => ({ ...f, itemType: e.target.value }))}
                placeholder="e.g. Office furniture"
              />
            </div>
            <div>
              <label style={{ fontSize: "12px", color: "#64748B", fontWeight: 600 }}>Quantity</label>
              <input
                style={inputStyle}
                value={form.quantity}
                onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                placeholder="e.g. 40 desks, 60 chairs"
              />
            </div>
            <div>
              <label style={{ fontSize: "12px", color: "#64748B", fontWeight: 600 }}>Estimated Value ($)</label>
              <input
                style={inputStyle}
                type="number"
                value={form.estimatedValue}
                onChange={(e) => setForm((f) => ({ ...f, estimatedValue: e.target.value }))}
              />
            </div>
            <div>
              <label style={{ fontSize: "12px", color: "#64748B", fontWeight: 600 }}>Geographic Scope</label>
              <input
                style={inputStyle}
                value={form.geographicScope}
                onChange={(e) => setForm((f) => ({ ...f, geographicScope: e.target.value }))}
                placeholder="e.g. Texas, Nationwide"
              />
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
            <button type="button" style={buttonStyle("primary")} onClick={submitListing} disabled={submitting}>
              {submitting ? <Loader2 size={14} className="animate-spin" style={{ verticalAlign: "-2px" }} /> : "Post Listing"}
            </button>
            <button type="button" style={buttonStyle("secondary")} onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
        </div>
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: "13px", color: "#64748B" }}>Loading marketplace…</div>
      ) : (
        <>
          {/* Incoming requests on your own listings */}
          {incomingOnMyListings.length > 0 && (
            <div style={frameStyle}>
            <div style={cardStyle}>
              <div style={sectionTitleStyle}>Requests on Your Listings</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {incomingOnMyListings.map((m) => {
                  const listing = firstOf(m.marketplace_listings);
                  const requester = firstOf(m.organizations);
                  const tone = MATCH_STATUS_TONE[m.status] ?? DEFAULT_TONE;
                  return (
                    <div
                      key={m.id}
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "10px 0", borderBottom: "1px solid #F1F5F9" }}
                    >
                      <div>
                        <div style={{ fontSize: "14px", fontWeight: 600, color: "#0F172A" }}>{listing?.title ?? "Listing"}</div>
                        <div style={{ fontSize: "12px", color: "#64748B" }}>
                          Requested by {requester?.name ?? "another organization"} — {m.match_reason}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={badgeStyle(tone.bg, tone.color)}>{m.status}</span>
                        {m.status === "requested" && (
                          <>
                            <button
                              type="button"
                              style={buttonStyle("primary")}
                              disabled={actionId === m.id}
                              onClick={() => void act(m.id, "approve")}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              style={buttonStyle("danger")}
                              disabled={actionId === m.id}
                              onClick={() => void act(m.id, "decline")}
                            >
                              Decline
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            </div>
          )}

          {/* Matched to you */}
          <div style={frameStyle}>
          <div style={cardStyle}>
            <div style={sectionTitleStyle}>Matched to Your Organization</div>
            {matchedToMe.length === 0 ? (
              <div style={{ fontSize: "13px", color: "#94A3B8" }}>
                No listings have been matched yet. Matches are found automatically when a category or
                geographic overlap is found against your organization&apos;s active search profiles.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {matchedToMe.map((m) => {
                  const listing = firstOf(m.marketplace_listings);
                  const tone = MATCH_STATUS_TONE[m.status] ?? DEFAULT_TONE;
                  return (
                    <div
                      key={m.id}
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "10px 0", borderBottom: "1px solid #F1F5F9" }}
                    >
                      <div>
                        <div style={{ fontSize: "14px", fontWeight: 600, color: "#0F172A" }}>{listing?.title ?? "Listing"}</div>
                        <div style={{ fontSize: "12px", color: "#64748B" }}>{m.match_reason}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={badgeStyle(tone.bg, tone.color)}>{m.status}</span>
                        {m.status === "suggested" && (
                          <button
                            type="button"
                            style={buttonStyle("primary")}
                            disabled={actionId === m.id}
                            onClick={() => void act(m.id, "request")}
                          >
                            Request
                          </button>
                        )}
                        {m.status === "requested" && (
                          <button
                            type="button"
                            style={buttonStyle("secondary")}
                            disabled={actionId === m.id}
                            onClick={() => void act(m.id, "withdraw")}
                          >
                            Withdraw
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          </div>

          {/* Your own listings */}
          <div style={frameStyle}>
          <div style={cardStyle}>
            <div style={sectionTitleStyle}>Your Listings</div>
            {ownListings.length === 0 ? (
              <div style={{ fontSize: "13px", color: "#94A3B8" }}>
                You haven&apos;t posted any donations yet.
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "12px" }}>
                {ownListings.map((l) => {
                  const tone = LISTING_STATUS_TONE[l.status] ?? DEFAULT_TONE;
                  return (
                    <div
                      key={l.id}
                      style={{
                        borderRadius: "12px",
                        border: "1px solid #E2E8F0",
                        padding: "14px",
                        backgroundColor: "rgba(16,27,45,0.04)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: "8px" }}>
                        <div style={{ fontSize: "14px", fontWeight: 700, color: "#0F172A" }}>
                          {l.title}
                          {l.is_seed_data && (
                            <span style={{ ...badgeStyle("#FEF3C7", "#B45309"), marginLeft: "6px" }}>test</span>
                          )}
                        </div>
                        <span style={badgeStyle(tone.bg, tone.color)}>{l.status}</span>
                      </div>
                      <div style={{ fontSize: "12px", color: "#64748B", marginTop: "6px" }}>
                        {CATEGORY_LABELS[l.category] ?? l.category}
                        {l.geographic_scope ? ` · ${l.geographic_scope}` : ""}
                      </div>
                      {l.description && (
                        <div style={{ fontSize: "12px", color: "#475569", marginTop: "6px" }}>{l.description}</div>
                      )}
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#94A3B8", marginTop: "10px" }}>
                        <span>{formatCurrency(l.estimated_value)}</span>
                        <span>Posted {formatDate(l.created_at)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          </div>
        </>
      )}
    </div>
  );
}
