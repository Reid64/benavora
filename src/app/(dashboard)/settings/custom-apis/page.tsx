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
  ChevronDown,
  ChevronUp,
  Clock,
  Globe,
  Pause,
  Play,
  Plus,
  Trash2,
  X,
  Zap,
} from "lucide-react";

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
import { useProfile } from "@/lib/hooks/useProfile";
import { formatRelative } from "@/lib/utils/formatters";

type AuthType = "none" | "api_key" | "bearer" | "oauth";
type PollSchedule = "hourly" | "daily" | "weekly" | "monthly";

type Connection = {
  id: string;
  name: string;
  base_url: string;
  auth_type: AuthType;
  auth_config: Record<string, string>;
  field_mapping: Record<string, string>;
  poll_schedule: PollSchedule;
  is_active: boolean;
  last_polled_at: string | null;
  last_success_at: string | null;
  error_count: number;
  created_at: string;
};

type TestResult = {
  ok: boolean;
  status: number;
  statusText: string;
  isJson: boolean;
  preview: unknown;
};

const AUTH_TYPE_OPTIONS = [
  { value: "none", label: "None" },
  { value: "api_key", label: "API Key (header)" },
  { value: "bearer", label: "Bearer Token" },
  { value: "oauth", label: "OAuth Token" },
];

const POLL_SCHEDULE_OPTIONS = [
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

/**
 * Custom API Connections settings page (AGENTS.md Agent 19 / BLUEPRINT §3.7).
 * Admins and owners can add, test, toggle, and delete client-configured REST
 * API integrations for grant opportunity discovery.
 */
export default function CustomApisPage() {
  const { profile } = useProfile();
  const canManage =
    profile?.role === "owner" || profile?.role === "admin";

  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Connection | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState<Record<string, boolean>>({});
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [runResult, setRunResult] = useState<
    Record<string, "ok" | "err" | null>
  >({});

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/integrations/custom-api");
      if (!res.ok) {
        setLoadError("Could not load custom API connections.");
        return;
      }
      const body = (await res.json()) as { connections: Connection[] };
      setConnections(body.connections ?? []);
    } catch {
      setLoadError("Could not load custom API connections.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleToggle(conn: Connection) {
    setActionError(null);
    setToggling((p) => ({ ...p, [conn.id]: true }));
    try {
      const res = await fetch(`/api/integrations/custom-api/${conn.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !conn.is_active }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setActionError(data?.error ?? "Could not update the connection.");
        return;
      }
      void load();
    } catch {
      setActionError("Could not update the connection.");
    } finally {
      setToggling((p) => ({ ...p, [conn.id]: false }));
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/integrations/custom-api/${deleteTarget.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setActionError(data?.error ?? "Could not delete the connection.");
        setDeleteTarget(null);
        return;
      }
      setDeleteTarget(null);
      void load();
    } catch {
      setActionError("Could not delete the connection.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleRunNow(conn: Connection) {
    setRunResult((p) => ({ ...p, [conn.id]: null }));
    setRunning((p) => ({ ...p, [conn.id]: true }));
    try {
      const res = await fetch("/api/agents/custom-api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId: conn.id }),
      });
      setRunResult((p) => ({ ...p, [conn.id]: res.ok ? "ok" : "err" }));
    } catch {
      setRunResult((p) => ({ ...p, [conn.id]: "err" }));
    } finally {
      setRunning((p) => ({ ...p, [conn.id]: false }));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary">
            Custom API Connections
          </h1>
          <p className="mt-1 text-sm text-navy-500">
            Connect any REST API that returns JSON to pull grant opportunities
            automatically on a schedule.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            Add Connection
          </Button>
        )}
      </div>

      {actionError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {actionError}
        </div>
      )}

      {loading ? (
        <LoadingSpinner center label="Loading connections..." />
      ) : loadError ? (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {loadError}
        </div>
      ) : connections.length === 0 ? (
        <Card>
          <EmptyState
            icon={Globe}
            title="No custom API connections"
            description={
              canManage
                ? "Connect any REST API to pull grant opportunities automatically. Click Add Connection to get started."
                : "No custom API connections have been configured yet."
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {connections.map((conn) => (
            <ConnectionCard
              key={conn.id}
              connection={conn}
              canManage={canManage}
              isToggling={toggling[conn.id] ?? false}
              isRunning={running[conn.id] ?? false}
              runResult={runResult[conn.id]}
              onToggle={() => void handleToggle(conn)}
              onRunNow={() => void handleRunNow(conn)}
              onDelete={() => setDeleteTarget(conn)}
            />
          ))}
        </div>
      )}

      {addOpen && (
        <AddConnectionModal
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
        title="Delete connection"
        description={
          deleteTarget
            ? `"${deleteTarget.name}" will be permanently removed. This cannot be undone.`
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
          Removing this connection stops future polling. Opportunities already
          discovered from this source are retained.
        </p>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connection card
// ---------------------------------------------------------------------------

type ConnectionCardProps = {
  connection: Connection;
  canManage: boolean;
  isToggling: boolean;
  isRunning: boolean;
  runResult: "ok" | "err" | null | undefined;
  onToggle: () => void;
  onRunNow: () => void;
  onDelete: () => void;
};

function ConnectionCard({
  connection: conn,
  canManage,
  isToggling,
  isRunning,
  runResult,
  onToggle,
  onRunNow,
  onDelete,
}: ConnectionCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card noPadding>
      <div className="flex flex-col gap-3 p-5">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-navy-900">{conn.name}</p>
            <p className="mt-0.5 truncate text-xs text-navy-400">
              {conn.base_url}
            </p>
          </div>
          <span
            className={`mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
              conn.is_active
                ? "bg-green-400 shadow-[0_0_6px_theme(colors.green.400)]"
                : "bg-red-400"
            }`}
            aria-label={conn.is_active ? "Active" : "Paused"}
          />
        </div>

        {/* Status badges */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge color={conn.is_active ? "green" : "gray"}>
            {conn.is_active ? "Active" : "Paused"}
          </Badge>
          <Badge color="gray">{conn.poll_schedule}</Badge>
          {conn.error_count > 0 && (
            <Badge color="red">
              {conn.error_count} error{conn.error_count !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>

        {/* Last polled */}
        {conn.last_polled_at && (
          <div className="flex items-center gap-1.5 text-xs text-navy-500">
            <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>Last polled {formatRelative(conn.last_polled_at)}</span>
          </div>
        )}

        {/* Actions */}
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={runResult === "err" ? "danger" : "secondary"}
              isLoading={isRunning}
              disabled={!conn.is_active || isRunning}
              onClick={onRunNow}
            >
              {runResult === "ok" ? (
                <>
                  <Check className="h-3.5 w-3.5 text-green-400" aria-hidden />
                  Queued
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
              {conn.is_active ? (
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
              aria-label={`Delete ${conn.name}`}
              className="rounded-md p-1.5 text-navy-400 transition hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          </div>
        )}

        {/* Expandable field mapping */}
        <button
          type="button"
          onClick={() => setExpanded((p) => !p)}
          className="flex items-center gap-1.5 text-xs text-navy-400 hover:text-navy-600 focus:outline-none"
        >
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          )}
          {expanded ? "Hide" : "Show"} field mapping
        </button>

        {expanded && (
          <pre className="max-h-32 overflow-auto rounded-md bg-navy-50 p-2.5 font-mono text-xs text-navy-700">
            {JSON.stringify(conn.field_mapping, null, 2)}
          </pre>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Add Connection modal
// ---------------------------------------------------------------------------

function AddConnectionModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [authType, setAuthType] = useState<AuthType>("none");
  const [headerName, setHeaderName] = useState("X-Api-Key");
  const [authKey, setAuthKey] = useState("");
  const [pollSchedule, setPollSchedule] = useState<PollSchedule>("daily");
  const [fieldMappingText, setFieldMappingText] = useState(
    '{\n  "": "name"\n}',
  );
  const [fieldMappingError, setFieldMappingError] = useState<string | null>(
    null,
  );

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  function buildAuthConfig(): Record<string, string> {
    if (authType === "api_key") {
      return { header_name: headerName || "X-Api-Key", key: authKey };
    }
    if (authType === "bearer" || authType === "oauth") {
      return { token: authKey };
    }
    return {};
  }

  function parseMapping(): Record<string, string> | null {
    setFieldMappingError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(fieldMappingText);
    } catch {
      setFieldMappingError("Invalid JSON. Please check your field mapping.");
      return null;
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      setFieldMappingError("Field mapping must be a JSON object.");
      return null;
    }
    const hasName = Object.values(parsed as Record<string, unknown>).includes(
      "name",
    );
    if (!hasName) {
      setFieldMappingError(
        'Field mapping must include a value of "name" (e.g. { "title": "name" }).',
      );
      return null;
    }
    return parsed as Record<string, string>;
  }

  async function handleTest() {
    setTestResult(null);
    setTesting(true);
    try {
      const res = await fetch("/api/integrations/custom-api/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_url: baseUrl.trim(),
          auth_type: authType,
          auth_config: buildAuthConfig(),
        }),
      });
      const data = (await res.json()) as TestResult;
      setTestResult(data);
    } catch {
      setTestResult({
        ok: false,
        status: 0,
        statusText: "Network error",
        isJson: false,
        preview: "Could not reach the server.",
      });
    } finally {
      setTesting(false);
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);

    if (!name.trim()) {
      setFormError("Name is required.");
      return;
    }
    if (!baseUrl.trim()) {
      setFormError("Base URL is required.");
      return;
    }
    const mapping = parseMapping();
    if (!mapping) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/integrations/custom-api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          base_url: baseUrl.trim(),
          auth_type: authType,
          auth_config: buildAuthConfig(),
          field_mapping: mapping,
          poll_schedule: pollSchedule,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setFormError(data?.error ?? "Could not save the connection.");
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
      title="Add Custom API Connection"
      description="Connect any REST API that returns JSON to discover grant opportunities automatically."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="add-connection-form"
            isLoading={submitting}
          >
            <Plus className="h-4 w-4" aria-hidden />
            Save Connection
          </Button>
        </>
      }
    >
      <form
        id="add-connection-form"
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
          label="Connection name"
          required
          value={name}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            setName(e.target.value)
          }
          placeholder="GrantWatch API"
        />

        <Input
          label="Base URL"
          required
          type="url"
          value={baseUrl}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            setBaseUrl(e.target.value)
          }
          placeholder="https://api.example.com/grants"
          helperText="A GET request will be made to this URL on each poll cycle."
        />

        <Select
          label="Authentication type"
          options={AUTH_TYPE_OPTIONS}
          value={authType}
          onChange={(e: ChangeEvent<HTMLSelectElement>) =>
            setAuthType(e.target.value as AuthType)
          }
        />

        {authType === "api_key" && (
          <div className="space-y-3 rounded-lg border border-navy-200 bg-navy-50/40 p-4">
            <Input
              label="Header name"
              value={headerName}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setHeaderName(e.target.value)
              }
              placeholder="X-Api-Key"
            />
            <Input
              label="API key"
              type="password"
              autoComplete="off"
              value={authKey}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setAuthKey(e.target.value)
              }
              placeholder="sk-…"
              helperText="Only the last 4 characters are shown after saving."
            />
          </div>
        )}

        {(authType === "bearer" || authType === "oauth") && (
          <div className="rounded-lg border border-navy-200 bg-navy-50/40 p-4">
            <Input
              label="Token"
              type="password"
              autoComplete="off"
              value={authKey}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setAuthKey(e.target.value)
              }
              placeholder="Bearer token or OAuth access token"
              helperText="Only the last 4 characters are shown after saving."
            />
          </div>
        )}

        <Select
          label="Poll schedule"
          options={POLL_SCHEDULE_OPTIONS}
          value={pollSchedule}
          onChange={(e: ChangeEvent<HTMLSelectElement>) =>
            setPollSchedule(e.target.value as PollSchedule)
          }
        />

        {/* Test Connection */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              isLoading={testing}
              disabled={!baseUrl.trim() || testing}
              onClick={() => void handleTest()}
            >
              <Zap className="h-3.5 w-3.5" aria-hidden />
              Test Connection
            </Button>
            <span className="text-xs text-navy-400">
              Makes one request and shows the raw response.
            </span>
          </div>

          {testResult && (
            <div
              className={`rounded-lg border p-3 ${
                testResult.ok
                  ? "border-green-200 bg-green-50"
                  : "border-red-200 bg-red-50"
              }`}
            >
              <div className="mb-2 flex items-center gap-2">
                {testResult.ok ? (
                  <Check
                    className="h-4 w-4 shrink-0 text-green-600"
                    aria-hidden
                  />
                ) : (
                  <AlertCircle
                    className="h-4 w-4 shrink-0 text-red-600"
                    aria-hidden
                  />
                )}
                <span
                  className={`text-xs font-semibold ${
                    testResult.ok ? "text-green-700" : "text-red-700"
                  }`}
                >
                  HTTP {testResult.status} {testResult.statusText}
                  {testResult.isJson
                    ? " · JSON response"
                    : " · Non-JSON response"}
                </span>
              </div>
              <pre className="max-h-40 overflow-auto rounded bg-white/60 p-2 font-mono text-xs text-navy-700">
                {typeof testResult.preview === "string"
                  ? testResult.preview
                  : JSON.stringify(testResult.preview, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Field mapping */}
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-navy-700">
            Field mapping{" "}
            <span className="text-red-500" aria-hidden>
              *
            </span>
          </label>
          <p className="text-xs text-navy-500">
            Map API response fields to opportunity fields. Must include a
            mapping to{" "}
            <code className="rounded bg-navy-100 px-1 font-mono text-navy-700">
              name
            </code>
            . Supported targets:{" "}
            <code className="font-mono">name</code>,{" "}
            <code className="font-mono">description</code>,{" "}
            <code className="font-mono">amount_available</code>,{" "}
            <code className="font-mono">deadline</code>,{" "}
            <code className="font-mono">url</code>,{" "}
            <code className="font-mono">eligibility_requirements</code>,{" "}
            <code className="font-mono">category</code>.
          </p>
          <textarea
            value={fieldMappingText}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
              setFieldMappingText(e.target.value);
              setFieldMappingError(null);
            }}
            onBlur={() => void parseMapping()}
            rows={6}
            spellCheck={false}
            aria-label="Field mapping JSON"
            aria-invalid={fieldMappingError ? true : undefined}
            className={`block w-full rounded-lg border ${
              fieldMappingError
                ? "border-red-400 focus:ring-red-400"
                : "border-navy-300 focus:border-teal-500 focus:ring-teal-500"
            } bg-white px-3 py-2 font-mono text-xs text-navy-900 shadow-sm focus:outline-none focus:ring-2`}
          />
          {fieldMappingError && (
            <p role="alert" className="text-xs text-red-600">
              {fieldMappingError}
            </p>
          )}
          <p className="text-xs text-navy-400">
            Example:{" "}
            <code className="font-mono">
              {
                '{"grant_title": "name", "close_date": "deadline", "max_award": "amount_available"}'
              }
            </code>
          </p>
        </div>
      </form>
    </Modal>
  );
}
