"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ImageOff,
  Loader2,
} from "lucide-react";

import { Button, EmptyState, Modal } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { formatRelative } from "@/lib/utils/formatters";
import type { ScreenshotRecord } from "@/types/automation";

export type ScreenshotViewerProps = {
  screenshots: ScreenshotRecord[];
  /** Tenant scope — Storage bucket is `org-{organizationId}`. */
  organizationId: string;
};

/** Signed-URL lifetime for screenshot previews (seconds). */
const SIGN_TTL = 600;

/** A short, stable filename for a screenshot download. */
function downloadName(shot: ScreenshotRecord, index: number): string {
  const base = shot.storage_path.split("/").pop();
  if (base && /\.[a-z0-9]+$/i.test(base)) return base;
  return `screenshot-${index + 1}.png`;
}

/**
 * Thumbnail grid of a session's captured screenshots with a full-size lightbox
 * (BLUEPRINT §Phase 3 components — ScreenshotViewer). Click a thumbnail to
 * expand it; navigate with prev/next; download any screenshot individually.
 *
 * Screenshots live in the org's private Storage bucket, so previews use
 * short-lived signed URLs minted by the session-bound client — Storage RLS
 * still gates access (mirrors DocumentList downloads).
 */
export function ScreenshotViewer({
  screenshots,
  organizationId,
}: ScreenshotViewerProps) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Mint signed preview URLs for every screenshot path in one batch.
  const paths = useMemo(
    () => screenshots.map((s) => s.storage_path),
    [screenshots],
  );

  useEffect(() => {
    if (paths.length === 0) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    const supabase = createClient();
    void supabase.storage
      .from(`org-${organizationId}`)
      .createSignedUrls(paths, SIGN_TTL)
      .then(({ data, error: signError }) => {
        if (!active) return;
        if (signError || !data) {
          setError("Could not load screenshot previews.");
          setLoading(false);
          return;
        }
        const next: Record<string, string> = {};
        data.forEach((item, i) => {
          const path = paths[i];
          if (path && item.signedUrl) next[path] = item.signedUrl;
        });
        setUrls(next);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [paths, organizationId]);

  const showPrev = useCallback(() => {
    setActiveIndex((i) =>
      i === null ? null : (i - 1 + screenshots.length) % screenshots.length,
    );
  }, [screenshots.length]);

  const showNext = useCallback(() => {
    setActiveIndex((i) => (i === null ? null : (i + 1) % screenshots.length));
  }, [screenshots.length]);

  // Arrow-key navigation while the lightbox is open.
  useEffect(() => {
    if (activeIndex === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") showPrev();
      if (e.key === "ArrowRight") showNext();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [activeIndex, showPrev, showNext]);

  async function handleDownload(shot: ScreenshotRecord, index: number) {
    setDownloadingId(shot.id);
    const supabase = createClient();
    const { data, error: signError } = await supabase.storage
      .from(`org-${organizationId}`)
      .createSignedUrl(shot.storage_path, 60, {
        download: downloadName(shot, index),
      });
    setDownloadingId(null);
    if (signError || !data?.signedUrl) {
      setError("Could not generate a download link for that screenshot.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  if (screenshots.length === 0) {
    return (
      <EmptyState
        icon={ImageOff}
        title="No screenshots captured"
        description="Screenshots appear here as the automation navigates, fills the form, and (after approval) submits."
      />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-sm text-navy-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
        Loading screenshots…
      </div>
    );
  }

  const active = activeIndex === null ? null : screenshots[activeIndex];
  const activeUrl = active ? urls[active.storage_path] : undefined;

  return (
    <div className="space-y-3">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {screenshots.map((shot, index) => {
          const url = urls[shot.storage_path];
          return (
            <li key={shot.id}>
              <button
                type="button"
                onClick={() => setActiveIndex(index)}
                className="group block w-full overflow-hidden rounded-lg border border-navy-200 bg-navy-50 text-left transition hover:border-teal-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
              >
                <div className="relative aspect-video w-full bg-navy-100">
                  {url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL, not a static asset
                    <img
                      src={url}
                      alt={shot.description ?? `Screenshot ${index + 1}`}
                      className="h-full w-full object-cover object-top transition group-hover:opacity-90"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-navy-400">
                      <ImageOff className="h-6 w-6" aria-hidden />
                    </div>
                  )}
                </div>
                <div className="px-2.5 py-2">
                  <p className="truncate text-xs font-medium text-navy-800">
                    {shot.description ?? `Step ${index + 1}`}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-navy-400">
                    {formatRelative(shot.captured_at)}
                  </p>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      <Modal
        isOpen={active !== null}
        onClose={() => setActiveIndex(null)}
        size="xl"
        title={active?.description ?? "Screenshot"}
        description={
          activeIndex !== null
            ? `${activeIndex + 1} of ${screenshots.length}${
                active?.page_url ? ` · ${active.page_url}` : ""
              }`
            : undefined
        }
        footer={
          active && (
            <>
              <Button
                variant="secondary"
                onClick={showPrev}
                disabled={screenshots.length < 2}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
                Previous
              </Button>
              <Button
                variant="secondary"
                isLoading={downloadingId === active.id}
                onClick={() =>
                  handleDownload(active, activeIndex as number)
                }
              >
                <Download className="h-4 w-4" aria-hidden />
                Download
              </Button>
              <Button onClick={showNext} disabled={screenshots.length < 2}>
                Next
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Button>
            </>
          )
        }
      >
        {activeUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL, not a static asset
          <img
            src={activeUrl}
            alt={active?.description ?? "Screenshot full size"}
            className="mx-auto max-h-[70vh] w-auto rounded-lg border border-navy-200"
          />
        ) : (
          <div className="flex items-center justify-center py-16 text-navy-400">
            <ImageOff className="mr-2 h-6 w-6" aria-hidden />
            Preview unavailable
          </div>
        )}
      </Modal>
    </div>
  );
}
