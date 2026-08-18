"use client";

import {
  useCallback,
  useEffect,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  AlertCircle,
  Check,
  Clock,
  Globe,
  Pause,
  Play,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  LoadingSpinner,
  Modal,
  Select,
} from "@/components/ui";
import { CustomConnectorAllowlist } from "@/components/settings/CustomConnectorAllowlist";
import { useProfile } from "@/lib/hooks/useProfile";
import { formatRelative } from "@/lib/utils/formatters";

type ScrapeSchedule = "hourly" | "daily" | "weekly" | "monthly";

type ScrapingTarget = {
  id: string;
  url: string;
  description: string | null;
  scrape_schedule: ScrapeSchedule;
  is_active: boolean;
  last_scraped_at: string | null;
  last_success_at: string | null;
  failure_count: number;
  created_at: string;
};

const SCHEDULE_OPTIONS = [
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

/**
 * Scraping Targets settings page (AGENTS.md Agent 20 / BEHAVIORAL_CONTRACTS §21).
 * Admins and owners can add, toggle, and delete client-assigned URLs for
 * scheduled AI-powered web scraping of grant opportunities.
 */
export default function ScrapingPage() {
  const { profile } = useProfile();
  const canManage =
    profile?.role === "owner" || profile?.role === "admin";

  const [targets, setTargets] = useState<ScrapingTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ScrapingTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState<Record<string, boolean>>({});
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [runResult, setRunResult] = useState<
    Record<string, "ok" | "err" | null>
  >({});
  const [runCount, setRunCount] = useState<Record<string, number | null>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/integrations/scraping-targets");
      if (!res.ok) {
        setLoadError("Could not load scraping targets.");
        return;
      }
      const body = (await res.json()) as { targets: ScrapingTarget[] };
      setTargets(body.targets ?? []);
    } catch {
      setLoadError("Could not load scraping targets.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleToggle(target: ScrapingTarget) {
    setActionError(null);
    setToggling((p) => ({ ...p, [target.id]: true }));
    try {
      const res = await fetch(
        `/api/integrations/scraping-targets/${target.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_active: !target.is_active }),
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setActionError(data?.error ?? "Could not update the target.");
        return;
      }
      void load();
    } catch {
      setActionError("Could not update the target.");
    } finally {
      setToggling((p) => ({ ...p, [target.id]: false }));
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/integrations/scraping-targets/${deleteTarget.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setActionError(data?.error ?? "Could not delete the target.");
        setDeleteTarget(null);
        return;
      }
      setDeleteTarget(null);
      void load();
    } catch {
      setActionError("Could not delete the target.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleRunNow(target: ScrapingTarget) {
    setRunResult((p) => ({ ...p, [target.id]: null }));
    setRunCount((p) => ({ ...p, [target.id]: null }));
    setRunning((p) => ({ ...p, [target.id]: true }));
    try {
      const res = await fetch("/api/agents/custom-scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId: target.id }),
      });
      setRunResult((p) => ({ ...p, [target.id]: res.ok ? "ok" : "err" }));
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as { opportunitiesCreated?: number } | null;
        setRunCount((p) => ({ ...p, [target.id]: data?.opportunitiesCreated ?? 0 }));
        void load();
      }
    } catch {
      setRunResult((p) => ({ ...p, [target.id]: "err" }));
    } finally {
      setRunning((p) => ({ ...p, [target.id]: false }));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary">
            Scraping Targets
          </h1>
          <p className="mt-1 text-sm text-navy-500">
            Add URLs for the AI to scrape on a schedule and extract grant
            opportunities automatically.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            Add Target
          </Button>
        )}
      </div>

      <CustomConnectorAllowlist canManage={canManage} />

      {actionError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {actionError}
        </div>
      )}

      {loading ? (
        <LoadingSpinner center label="Loading scraping targets..." />
      ) : loadError ? (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {loadError}
        </div>
      ) : targets.length === 0 ? (
        <Card>
          <EmptyState
            icon={Globe}
            title="No scraping targets"
            description={
              canManage
                ? "Add any public URL and the AI will scrape it on schedule to discover grant opportunities. Click Add Target to get started."
                : "No scraping targets have been configured yet."
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {targets.map((target) => (
            <TargetCard
              key={target.id}
              target={target}
              canManage={canManage}
              isToggling={toggling[target.id] ?? false}
              isRunning={running[target.id] ?? false}
              runResult={runResult[target.id]}
              runCount={runCount[target.id] ?? null}
              onToggle={() => void handleToggle(target)}
              onRunNow={() => void handleRunNow(target)}
              onDelete={() => setDeleteTarget(target)}
            />
          ))}
        </div>
      )}

      {addOpen && (
        <AddTargetModal
          onClose={() => setAddOpen(false)}
          onSaved={() => {
            setAddOpen(false);
            void load();
          }}
        />
      )}

      <Modal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete scraping target"
        description={
          deleteTarget
            ? `"${deleteTarget.url}" will be permanently removed. This cannot be undone.`
            : undefined
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              isLoading={deleting}
              onClick={() => void handleDelete()}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-navy-600">
          Removing this target stops future scraping. Opportunities already
          discovered from this source are retained.
        </p>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Target card
// ---------------------------------------------------------------------------

type TargetCardProps = {
  target: ScrapingTarget;
  canManage: boolean;
  isToggling: boolean;
  isRunning: boolean;
  runResult: "ok" | "err" | null | undefined;
  runCount: number | null;
  onToggle: () => void;
  onRunNow: () => void;
  onDelete: () => void;
};

function TargetCard({
  target,
  canManage,
  isToggling,
  isRunning,
  runResult,
  runCount,
  onToggle,
  onRunNow,
  onDelete,
}: TargetCardProps) {
  return (
    <Card noPadding>
      <div className="flex flex-col gap-3 p-5">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p
              className="truncate text-xs font-semibold text-navy-900"
              title={target.url}
            >
              {target.url}
            </p>
            {target.description && (
              <p className="mt-0.5 line-clamp-2 text-xs text-navy-500">
                {target.description}
              </p>
            )}
          </div>
          <span
            className={`mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
              target.is_active
                ? "bg-green-400 shadow-[0_0_6px_theme(colors.green.400)]"
                : "bg-red-400"
            }`}
            aria-label={target.is_active ? "Active" : "Paused"}
          />
        </div>

        {/* Status badges */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge color={target.is_active ? "green" : "gray"}>
            {target.is_active ? "Active" : "Paused"}
          </Badge>
          <Badge color="gray">{target.scrape_schedule}</Badge>
          {target.failure_count > 0 && (
            <Badge color="red">
              {target.failure_count} failure
              {target.failure_count !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>

        {/* Last scraped */}
        {target.last_scraped_at && (
          <div className="flex items-center gap-1.5 text-xs text-navy-500">
            <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>Last scraped {formatRelative(target.last_scraped_at)}</span>
          </div>
        )}

        {/* Failure alert */}
        {target.failure_count >= 3 && target.is_active && (
          <div className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-700">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              {target.failure_count >= 5
                ? "Auto-paused after repeated failures."
                : `${target.failure_count} consecutive failures — will pause at 5.`}
            </span>
          </div>
        )}

        {/* Actions */}
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={runResult === "err" ? "danger" : "secondary"}
              isLoading={isRunning}
              disabled={!target.is_active || isRunning}
              onClick={onRunNow}
            >
              {runResult === "ok" ? (
                <>
                  <Check className="h-3.5 w-3.5 text-green-400" aria-hidden />
                  Done
                </>
              ) : runResult === "err" ? (
                <>
                  <X className="h-3.5 w-3.5" aria-hidden />
                  Failed
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5" aria-hidden />
                  Run Now
                </>
              )}
            </Button>

            <Button
              size="sm"
              variant="secondary"
              isLoading={isToggling}
              onClick={onToggle}
            >
              {target.is_active ? (
                <>
                  <Pause className="h-3.5 w-3.5" aria-hidden />
                  Pause
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5" aria-hidden />
                  Activate
                </>
              )}
            </Button>

            <button
              type="button"
              onClick={onDelete}
              aria-label={`Delete ${target.url}`}
              className="rounded-md p-1.5 text-navy-400 transition hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          </div>
        )}

        {runResult === "ok" && (
          <Link
            href="/opportunities"
            className="inline-flex items-center gap-1.5 self-start rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-medium text-teal-700 transition hover:border-teal-300 hover:bg-teal-100"
          >
            {runCount !== null
              ? `View ${runCount} opportunit${runCount === 1 ? "y" : "ies"} found →`
              : "View Opportunities →"}
          </Link>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Add Target modal
// ---------------------------------------------------------------------------

function AddTargetModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [scrapeSchedule, setScrapeSchedule] =
    useState<ScrapeSchedule>("weekly");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);

    if (!url.trim()) {
      setFormError("URL is required.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/integrations/scraping-targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          description: description.trim() || null,
          scrape_schedule: scrapeSchedule,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setFormError(data?.error ?? "Could not save the target.");
        return;
      }
      onSaved();
    } catch {
      setFormError("Could not reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Add Scraping Target"
      description="Add a public URL for the AI to scrape on a schedule and extract grant opportunities."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="add-target-form"
            isLoading={submitting}
          >
            <Plus className="h-4 w-4" aria-hidden />
            Save Target
          </Button>
        </>
      }
    >
      <form
        id="add-target-form"
        onSubmit={(e) => void handleSubmit(e)}
        className="space-y-4"
        noValidate
      >
        {formError && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {formError}
          </div>
        )}

        <Input
          label="URL"
          required
          type="url"
          value={url}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            setUrl(e.target.value)
          }
          placeholder="https://grants.example.gov/opportunities"
          helperText="Must be a publicly accessible page — no login required."
        />

        <div className="space-y-1.5">
          <label
            htmlFor="scrape-description"
            className="block text-sm font-medium text-navy-700"
          >
            What to look for{" "}
            <span className="font-normal text-navy-400">(optional)</span>
          </label>
          <textarea
            id="scrape-description"
            value={description}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
              setDescription(e.target.value)
            }
            rows={3}
            placeholder="Grant opportunities for housing nonprofits in Texas"
            className="block w-full rounded-lg border border-navy-300 bg-surface px-3 py-2 text-sm text-navy-900 shadow-sm placeholder:text-navy-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <p className="text-xs text-navy-400">
            Describe what you expect to find. The AI uses this as context to
            extract more relevant opportunities.
          </p>
        </div>

        <Select
          label="Scrape schedule"
          options={SCHEDULE_OPTIONS}
          value={scrapeSchedule}
          onChange={(e: ChangeEvent<HTMLSelectElement>) =>
            setScrapeSchedule(e.target.value as ScrapeSchedule)
          }
        />
      </form>
    </Modal>
  );
}
