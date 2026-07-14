"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";

import { Button, Card, LoadingSpinner } from "@/components/ui";

type Preference = {
  event_type: string;
  label: string;
  in_app: boolean;
  email: boolean;
};

/**
 * Settings > Notifications - per-user toggles for whether each event type
 * raises an in-app alert and/or an email (migration 087, notify()).
 */
export default function NotificationsSettingsPage() {
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/settings/notifications");
      if (!res.ok) throw new Error("load failed");
      const body = (await res.json()) as { preferences: Preference[] };
      setPreferences(body.preferences ?? []);
    } catch {
      setLoadError("Could not load notification preferences.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(eventType: string, field: "in_app" | "email") {
    setSaved(false);
    setPreferences((prev) =>
      prev.map((p) =>
        p.event_type === eventType ? { ...p, [field]: !p[field] } : p,
      ),
    );
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/settings/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preferences: preferences.map((p) => ({
            event_type: p.event_type,
            in_app: p.in_app,
            email: p.email,
          })),
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setSaveError(err.error ?? "Could not save notification preferences.");
        return;
      }
      setSaved(true);
    } catch {
      setSaveError("Could not reach the server. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-primary">
          Notifications
        </h1>
        <p className="mt-1 text-sm text-navy-500">
          Choose which events raise an in-app alert or send you an email.
        </p>
      </div>

      {loading ? (
        <LoadingSpinner center label="Loading preferences..." />
      ) : loadError ? (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {loadError}
        </div>
      ) : (
        <Card noPadding>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                <th className="px-4 py-3">Event</th>
                <th className="px-4 py-3 text-center">In-App</th>
                <th className="px-4 py-3 text-center">Email</th>
              </tr>
            </thead>
            <tbody>
              {preferences.map((pref) => (
                <tr
                  key={pref.event_type}
                  className="border-b border-border last:border-0"
                >
                  <td className="flex items-center gap-2 px-4 py-3 font-medium text-navy-900">
                    <Bell className="h-4 w-4 text-navy-400" aria-hidden />
                    {pref.label}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={pref.in_app}
                      onChange={() => toggle(pref.event_type, "in_app")}
                      aria-label={`${pref.label} in-app notifications`}
                      className="h-4 w-4 accent-primary"
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={pref.email}
                      onChange={() => toggle(pref.event_type, "email")}
                      aria-label={`${pref.label} email notifications`}
                      className="h-4 w-4 accent-primary"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {saveError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {saveError}
        </div>
      )}

      {!loading && !loadError && (
        <div className="flex items-center gap-3">
          <Button onClick={() => void handleSave()} isLoading={saving}>
            Save Preferences
          </Button>
          {saved && (
            <span className="text-sm text-green-700">Preferences saved.</span>
          )}
        </div>
      )}
    </div>
  );
}
