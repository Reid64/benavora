"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarIcon,
  Film,
  Maximize2,
  Minimize2,
  Monitor,
  Trash2,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import type { BadgeColor } from "@/components/ui/Badge";
import { Button, EmptyState } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";

interface RecordingRow {
  id: string;
  submission_id: string;
  funder_id: string;
  storage_path: string;
  duration_seconds: number;
  file_size_bytes: number;
  created_at: string;
  funders: { name: string } | null;
  autoapply_submissions: { status: string } | null;
}

type SortKey = "newest" | "oldest" | "duration";
type StatusFilter = "all" | "completed" | "failed";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusBadge(status: string): { color: BadgeColor; label: string } {
  switch (status) {
    case "completed":
    case "submitted":
      return { color: "teal", label: "Completed" };
    case "failed":
    case "error":
      return { color: "red", label: "Failed" };
    default:
      return { color: "gray", label: status };
  }
}

interface VideoModalProps {
  recording: RecordingRow;
  signedUrl: string | null;
  loadingUrl: boolean;
  onClose: () => void;
}

function VideoModal({ recording, signedUrl, loadingUrl, onClose }: VideoModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [speed, setSpeed] = useState(1);

  function setPlaybackSpeed(s: number) {
    setSpeed(s);
    if (videoRef.current) videoRef.current.playbackRate = s;
  }

  const funderName = recording.funders?.name ?? "Unknown Funder";
  const status = recording.autoapply_submissions?.status ?? "unknown";
  const { color, label } = statusBadge(status);
  const date = new Date(recording.created_at).toLocaleDateString();

  const screenWidth = expanded ? 880 : 560;
  const screenHeight = Math.round(screenWidth * (9 / 16));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        className="flex flex-col items-center gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header bar */}
        <div className="flex w-full items-center justify-between px-1">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-white">{funderName}</span>
            <Badge color={color}>{label}</Badge>
            <span className="text-xs text-gray-400">{date}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="rounded-md p-1.5 text-gray-400 hover:bg-white/10 hover:text-white"
              title={expanded ? "Shrink" : "Expand"}
            >
              {expanded ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-gray-400 hover:bg-white/10 hover:text-white"
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Monitor frame */}
        <div
          className="inline-flex flex-col items-center"
          style={{ width: screenWidth + 32 }}
        >
          {/* Monitor body */}
          <div
            style={{
              backgroundColor: "#1a1a2e",
              borderRadius: 12,
              padding: 16,
              boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
              width: "100%",
            }}
          >
            {/* Top bezel */}
            <div
              style={{
                height: 12,
                backgroundColor: "#252540",
                borderRadius: "6px 6px 0 0",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 4,
              }}
            >
              <span
                style={{
                  fontSize: 9,
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  color: "#555",
                  fontFamily: "monospace",
                }}
              >
                BENAVORA AUTOAPPLY
              </span>
            </div>

            {/* Screen area */}
            <div
              style={{
                border: "2px solid #333",
                borderRadius: 4,
                overflow: "hidden",
                backgroundColor: "#0a0a15",
                width: screenWidth,
                height: screenHeight,
                position: "relative",
              }}
            >
              {loadingUrl ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                  <Monitor className="h-8 w-8" style={{ color: "#2a2a4a" }} />
                  <p style={{ fontSize: 13, color: "#444" }}>Loading recording…</p>
                </div>
              ) : signedUrl ? (
                <video
                  ref={videoRef}
                  src={signedUrl}
                  controls
                  style={{ width: "100%", height: "100%", objectFit: "contain" }}
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                  <Monitor className="h-8 w-8" style={{ color: "#2a2a4a" }} />
                  <p style={{ fontSize: 13, color: "#666" }}>Recording unavailable</p>
                </div>
              )}

              {/* Overlay: funder/date/status */}
              {signedUrl && !loadingUrl && (
                <div
                  className="absolute bottom-0 left-0 right-0 px-3 py-2 text-xs"
                  style={{
                    background: "linear-gradient(to bottom, transparent, rgba(0,0,0,0.82))",
                    pointerEvents: "none",
                  }}
                >
                  <p className="font-medium text-white">{funderName}</p>
                  <div className="mt-0.5 flex items-center gap-3" style={{ color: "#ccc" }}>
                    <span>{date}</span>
                    <span>{label}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Bottom bezel */}
            <div
              style={{
                height: 16,
                backgroundColor: "#252540",
                borderRadius: "0 0 6px 6px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                paddingLeft: 10,
                paddingRight: 12,
                marginTop: 4,
              }}
            >
              <div style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: "#444" }} />
              <span style={{ fontSize: 9, letterSpacing: "0.1em", color: "#555", fontFamily: "monospace" }}>
                RECORDING
              </span>
            </div>
          </div>

          {/* Monitor stand */}
          <div className="flex flex-col items-center">
            <div
              style={{
                width: 120,
                height: 20,
                backgroundColor: "#1a1a2e",
                clipPath: "polygon(25% 0%, 75% 0%, 100% 100%, 0% 100%)",
              }}
            />
            <div style={{ width: 160, height: 6, backgroundColor: "#252540", borderRadius: 3 }} />
          </div>
        </div>

        {/* Speed controls */}
        {signedUrl && !loadingUrl && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">Speed:</span>
            {([1, 2, 4] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setPlaybackSpeed(s)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  speed === s
                    ? "bg-teal-500 text-white"
                    : "bg-white/10 text-gray-300 hover:bg-white/20"
                }`}
              >
                {s}×
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function RecordingsPage() {
  const { profile } = useProfile();
  const isAdmin = canEdit(profile?.role);

  const [recordings, setRecordings] = useState<RecordingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sortKey, setSortKey] = useState<SortKey>("newest");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [funderFilter, setFunderFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [activeRecording, setActiveRecording] = useState<RecordingRow | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loadingUrl, setLoadingUrl] = useState(false);

  const loadRecordings = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    try {
      const { data, error: err } = await supabase
        .from("session_recordings")
        .select("*, funders(name), autoapply_submissions(status)")
        .order("created_at", { ascending: false });
      if (err) throw err;
      setRecordings((data ?? []) as unknown as RecordingRow[]);
    } catch {
      setError("Could not load recordings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRecordings();
  }, [loadRecordings]);

  async function openRecording(rec: RecordingRow) {
    setActiveRecording(rec);
    setSignedUrl(null);
    setLoadingUrl(true);
    const supabase = createClient();
    try {
      const { data } = await supabase.storage
        .from("session-recordings")
        .createSignedUrl(rec.storage_path, 3600);
      setSignedUrl(data?.signedUrl ?? null);
    } catch {
      setSignedUrl(null);
    } finally {
      setLoadingUrl(false);
    }
  }

  function closeModal() {
    setActiveRecording(null);
    setSignedUrl(null);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(visible: RecordingRow[]) {
    if (visible.every((r) => selected.has(r.id))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visible.map((r) => r.id)));
    }
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    setDeleting(true);
    setDeleteError(null);
    const supabase = createClient();
    try {
      const toDelete = recordings.filter((r) => selected.has(r.id));
      const paths = toDelete.map((r) => r.storage_path);
      if (paths.length > 0) {
        await supabase.storage.from("session-recordings").remove(paths);
      }
      const ids = Array.from(selected);
      const { error: err } = await supabase
        .from("session_recordings")
        .delete()
        .in("id", ids);
      if (err) throw err;
      setSelected(new Set());
      await loadRecordings();
    } catch {
      setDeleteError("Could not delete recordings. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  const filtered = recordings.filter((r) => {
    if (statusFilter !== "all") {
      const s = r.autoapply_submissions?.status ?? "";
      if (statusFilter === "completed" && !["completed", "submitted"].includes(s)) return false;
      if (statusFilter === "failed" && !["failed", "error"].includes(s)) return false;
    }
    if (funderFilter) {
      const name = (r.funders?.name ?? "").toLowerCase();
      if (!name.includes(funderFilter.toLowerCase())) return false;
    }
    if (dateFrom) {
      if (r.created_at < dateFrom) return false;
    }
    if (dateTo) {
      if (r.created_at > dateTo + "T23:59:59Z") return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortKey === "newest") return b.created_at.localeCompare(a.created_at);
    if (sortKey === "oldest") return a.created_at.localeCompare(b.created_at);
    return b.duration_seconds - a.duration_seconds;
  });

  const totalBytes = recordings.reduce((sum, r) => sum + r.file_size_bytes, 0);
  const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);

  const allVisibleSelected = sorted.length > 0 && sorted.every((r) => selected.has(r.id));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary">
            Session Recordings
          </h1>
          <p className="mt-1 text-sm text-navy-500">
            Recorded AutoApply submission sessions for audit and review.
          </p>
        </div>
        {/* Storage usage */}
        <div className="rounded-lg border border-navy-100 bg-navy-50 px-4 py-2.5 text-right">
          <p className="text-xs text-navy-400">Storage</p>
          <p className="text-sm font-semibold text-navy-900">
            {recordings.length} recordings · {totalMB} MB
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-navy-500">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="rounded-md border border-navy-200 bg-surface px-3 py-1.5 text-sm text-navy-900 focus:outline-none focus:ring-2 focus:ring-teal-400"
          >
            <option value="all">All</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-navy-500">Funder</label>
          <input
            type="text"
            placeholder="Filter by funder…"
            value={funderFilter}
            onChange={(e) => setFunderFilter(e.target.value)}
            className="rounded-md border border-navy-200 bg-surface px-3 py-1.5 text-sm text-navy-900 placeholder:text-navy-300 focus:outline-none focus:ring-2 focus:ring-teal-400"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-navy-500">From</label>
          <div className="relative">
            <CalendarIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-navy-400" />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-md border border-navy-200 bg-surface pl-8 pr-3 py-1.5 text-sm text-navy-900 focus:outline-none focus:ring-2 focus:ring-teal-400"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-navy-500">To</label>
          <div className="relative">
            <CalendarIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-navy-400" />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-md border border-navy-200 bg-surface pl-8 pr-3 py-1.5 text-sm text-navy-900 focus:outline-none focus:ring-2 focus:ring-teal-400"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-navy-500">Sort</label>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="rounded-md border border-navy-200 bg-surface px-3 py-1.5 text-sm text-navy-900 focus:outline-none focus:ring-2 focus:ring-teal-400"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="duration">Longest first</option>
          </select>
        </div>

        {isAdmin && selected.size > 0 && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleBulkDelete()}
            isLoading={deleting}
            disabled={deleting}
            className="ml-auto"
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5 text-red-500" />
            Delete ({selected.size})
          </Button>
        )}
      </div>

      {deleteError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {deleteError}
        </div>
      )}

      {/* Content */}
      {error ? (
        <div className="rounded-lg border border-red-100 bg-red-50 p-5 text-sm text-red-600">
          {error}
        </div>
      ) : loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-52 animate-pulse rounded-xl border border-navy-100 bg-navy-50"
            />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface shadow-sm p-10">
          <EmptyState
            icon={Film}
            title="No recordings found"
            description="AutoApply recordings will appear here after sessions complete."
          />
        </div>
      ) : (
        <>
          {/* Select-all row */}
          {isAdmin && (
            <div className="flex items-center gap-2 text-xs text-navy-500">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={() => toggleAll(sorted)}
                className="rounded border-navy-300 text-teal-600 focus:ring-teal-500"
                aria-label="Select all visible recordings"
              />
              <span>{sorted.length} recording{sorted.length !== 1 ? "s" : ""}</span>
            </div>
          )}

          {/* Grid */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sorted.map((rec) => {
              const funderName = rec.funders?.name ?? "Unknown Funder";
              const recStatus = rec.autoapply_submissions?.status ?? "unknown";
              const { color, label } = statusBadge(recStatus);
              const date = new Date(rec.created_at).toLocaleDateString();

              return (
                <div
                  key={rec.id}
                  className="group relative cursor-pointer overflow-hidden rounded-xl border border-border bg-surface shadow-sm transition-shadow hover:shadow-md"
                  onClick={() => void openRecording(rec)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") void openRecording(rec);
                  }}
                >
                  {/* Thumbnail */}
                  <div
                    className="flex items-center justify-center bg-navy-900"
                    style={{ height: 140 }}
                  >
                    <div className="flex flex-col items-center gap-2">
                      <Film className="h-10 w-10 text-navy-600" />
                      <span className="text-xs text-navy-500">
                        {formatDuration(rec.duration_seconds)}
                      </span>
                    </div>
                    {/* Play overlay */}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/20">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/0 transition-colors group-hover:bg-white/90">
                        <svg
                          className="h-5 w-5 translate-x-0.5 text-navy-900 opacity-0 transition-opacity group-hover:opacity-100"
                          fill="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </div>
                    </div>
                  </div>

                  {/* Card body */}
                  <div className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="flex-1 truncate text-sm font-medium text-navy-900">
                        {funderName}
                      </p>
                      <Badge color={color}>{label}</Badge>
                    </div>
                    <div className="mt-1.5 flex items-center gap-3 text-xs text-navy-400">
                      <span>{date}</span>
                      <span>·</span>
                      <span>{formatBytes(rec.file_size_bytes)}</span>
                    </div>
                  </div>

                  {/* Admin checkbox */}
                  {isAdmin && (
                    <div
                      className="absolute left-3 top-3"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelect(rec.id);
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(rec.id)}
                        onChange={() => toggleSelect(rec.id)}
                        className="rounded border-navy-300 text-teal-600 focus:ring-teal-500"
                        aria-label={`Select recording for ${funderName}`}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Video modal */}
      {activeRecording && (
        <VideoModal
          recording={activeRecording}
          signedUrl={signedUrl}
          loadingUrl={loadingUrl}
          onClose={closeModal}
        />
      )}
    </div>
  );
}
