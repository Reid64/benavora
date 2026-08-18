"use client";

import { useEffect, useState } from "react";

import { Card, LoadingSpinner } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/types/database";

type FoundationRow = Tables<"foundation_directory">;

interface FoundationProfile {
  foundation_id?: string;
  avg_grant_size: number | null;
  geographic_focus: string[] | null;
  funding_categories: string[] | null;
  total_grants_made: number | null;
  top_recipients: unknown | null;
}

function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "—";
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toLocaleString()}`;
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-3 last:border-0">
      <span className="text-sm text-slate-400">{label}</span>
      <span className="text-sm font-medium text-slate-900">{value ?? "—"}</span>
    </div>
  );
}

export function FoundationDetail({ foundationId }: { foundationId: string }) {
  const [foundation, setFoundation] = useState<FoundationRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [profile, setProfile] = useState<FoundationProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const supabase = createClient();

    (async () => {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from("foundation_directory")
        .select("*")
        .eq("id", foundationId)
        .maybeSingle();

      if (!active) return;

      if (fetchError || !data) {
        setError("Could not load this foundation.");
      } else {
        setFoundation(data);
      }
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [foundationId]);

  useEffect(() => {
    let active = true;

    (async () => {
      setProfileLoading(true);
      setProfileError(null);

      try {
        const res = await fetch(`/api/foundations/${foundationId}/profile`);
        if (!res.ok) throw new Error("request failed");
        const data = (await res.json()) as FoundationProfile;
        if (!active) return;
        setProfile(data);
      } catch {
        if (!active) return;
        setProfileError("Could not compute this foundation's profile.");
      } finally {
        if (active) setProfileLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [foundationId]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner label="Loading foundation…" />
      </div>
    );
  }

  if (error || !foundation) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
      >
        {error ?? "Foundation not found."}
      </div>
    );
  }

  const location = [foundation.city, foundation.state].filter(Boolean).join(", ");

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-surface p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-900">{foundation.name}</h1>
        <p className="mt-1 text-sm text-slate-500">{location || "Location unknown"}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Foundation Details">
          <DetailRow label="EIN" value={foundation.ein} />
          <DetailRow
            label="Assets"
            value={formatCurrency(foundation.asset_amount)}
          />
          <DetailRow
            label="Revenue"
            value={formatCurrency(foundation.revenue_amount)}
          />
          <DetailRow label="State" value={foundation.state} />
          <DetailRow label="Foundation Type" value={foundation.foundation_type} />
          <DetailRow label="NTEE Code" value={foundation.ntee_code} />
          <DetailRow
            label="Website"
            value={
              foundation.website ? (
                <a
                  href={foundation.website}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#0077B6] hover:underline"
                >
                  {foundation.website}
                </a>
              ) : null
            }
          />
        </Card>

        <Card title="Profile">
          {profileLoading ? (
            <div className="flex justify-center py-6">
              <LoadingSpinner label="Computing profile…" />
            </div>
          ) : profileError ? (
            <p className="py-4 text-sm text-red-600">{profileError}</p>
          ) : (
            <>
              <DetailRow
                label="Avg. Grant Size"
                value={formatCurrency(profile?.avg_grant_size)}
              />
              <DetailRow
                label="Total Grants Made"
                value={formatCurrency(profile?.total_grants_made)}
              />
              <DetailRow
                label="Geographic Focus"
                value={
                  profile?.geographic_focus && profile.geographic_focus.length > 0
                    ? profile.geographic_focus.join(", ")
                    : null
                }
              />
              <DetailRow
                label="Funding Categories"
                value={
                  profile?.funding_categories && profile.funding_categories.length > 0
                    ? profile.funding_categories.join(", ")
                    : null
                }
              />
              {Array.isArray(profile?.top_recipients) && profile.top_recipients.length > 0 && (
                <div className="pt-3">
                  <p className="text-sm text-slate-400">Top Recipients</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-700">
                    {(profile.top_recipients as unknown[]).map((recipient, i) => (
                      <li key={i}>{JSON.stringify(recipient)}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
