"use client";

import { useState } from "react";
import { ExternalLink, Globe, Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";

import { Badge, Button, Card } from "@/components/ui";
import { PORTAL_REGISTRY } from "@/lib/sources/state-portals/portal-registry";

// Settings > Integrations > State Grant Portals > Configure.
//
// PORTAL_REGISTRY (src/lib/sources/state-portals/portal-registry.ts) is the
// real list this page shows — the exact same list the Integrations page's
// "State Grant Portals" card counts and the state_portal agent (Run Now)
// actually scrapes. It is a static, code-defined registry today (currently
// just Texas) — there is no per-org enable/disable or database-backed
// configuration to expose here, so this page shows the real registry plus a
// live preview action rather than fabricating settings that don't exist.
//
// Preview uses GET /api/sources/state-portals?state=XX, a separate read-only
// scraper (src/lib/sources/state-portals/portal-config.ts's
// STATE_PORTAL_CONFIGS) that does not persist to `opportunities` — it exists
// specifically to let you see what the scraper currently finds for a portal
// without running the full agent. See that route's own header comment.

type PreviewResult =
  | { status: "loading" }
  | { status: "ok"; count: number }
  | { status: "err"; message: string };

export default function StatePortalsSettingsPage() {
  const [preview, setPreview] = useState<Record<string, PreviewResult>>({});

  async function handlePreview(stateCode: string) {
    setPreview((p) => ({ ...p, [stateCode]: { status: "loading" } }));
    try {
      const res = await fetch(`/api/sources/state-portals?state=${encodeURIComponent(stateCode)}`);
      const body = (await res.json().catch(() => ({}))) as { count?: number; error?: string };
      if (!res.ok) {
        setPreview((p) => ({
          ...p,
          [stateCode]: { status: "err", message: body.error ?? "Preview failed." },
        }));
        return;
      }
      setPreview((p) => ({ ...p, [stateCode]: { status: "ok", count: body.count ?? 0 } }));
    } catch {
      setPreview((p) => ({
        ...p,
        [stateCode]: { status: "err", message: "Could not reach the preview scraper." },
      }));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-primary">
          State Grant Portals
        </h1>
        <p className="mt-1 text-sm text-navy-500">
          Portals the state grant scraper actually covers. This list is code-defined, not
          per-organization — adding a new state means onboarding it in{" "}
          <code className="rounded bg-navy-50 px-1 py-0.5 text-xs">portal-registry.ts</code>, not a
          toggle here.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {PORTAL_REGISTRY.map((portal) => {
          const result = preview[portal.stateCode];
          return (
            <Card key={portal.stateCode} noPadding>
              <div className="flex flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-500/15 text-teal-400">
                      <Globe className="h-5 w-5" aria-hidden />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-navy-900">{portal.stateName}</p>
                      <Badge color="teal">{portal.stateCode}</Badge>
                    </div>
                  </div>
                </div>

                <a
                  href={portal.portalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 truncate text-xs text-navy-500 hover:text-navy-700 hover:underline"
                  title={portal.portalUrl}
                >
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{portal.portalUrl}</span>
                </a>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    isLoading={result?.status === "loading"}
                    onClick={() => void handlePreview(portal.stateCode)}
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                    Preview
                  </Button>
                  {result?.status === "ok" && (
                    <span className="text-xs font-medium text-teal-700">
                      {result.count} found right now
                    </span>
                  )}
                  {result?.status === "err" && (
                    <span className="text-xs font-medium text-red-600">{result.message}</span>
                  )}
                  {result?.status === "loading" && (
                    <span className="inline-flex items-center gap-1 text-xs text-navy-400">
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                      Scraping live...
                    </span>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <p className="text-xs text-navy-400">
        Full runs (persisted to your pipeline) happen from{" "}
        <Link href="/settings/integrations" className="text-primary hover:underline">
          Settings → Integrations
        </Link>
        &apos;s State Grant Portals card, not from this page.
      </p>
    </div>
  );
}
