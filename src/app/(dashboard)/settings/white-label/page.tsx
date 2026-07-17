"use client";

import {
  useCallback,
  useEffect,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { Building2, Plus } from "lucide-react";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  LoadingSpinner,
  Modal,
} from "@/components/ui";
import { useProfile } from "@/lib/hooks/useProfile";
import { formatRelative } from "@/lib/utils/formatters";

type ConsultantClient = {
  id: string;
  access_level: string;
  granted_at: string;
  active: boolean;
  organization: { id: string; name: string; subscription_tier: string | null } | null;
};

/**
 * White-Label settings page (BLUEPRINT §12). Consultant-tier owners/admins
 * grant themselves access to a client organization by the email of a member
 * of that org, then see the resulting client list here.
 */
export default function WhiteLabelPage() {
  const { profile } = useProfile();
  const canManage = profile?.role === "owner" || profile?.role === "admin";

  const [clients, setClients] = useState<ConsultantClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/consultant/clients");
      if (!res.ok) {
        setLoadError("Could not load client organizations.");
        return;
      }
      const body = (await res.json()) as { clients: ConsultantClient[] };
      setClients(body.clients ?? []);
    } catch {
      setLoadError("Could not load client organizations.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRemove = useCallback(
    async (id: string) => {
      setRemovingId(id);
      try {
        const res = await fetch(`/api/consultant/clients?id=${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
        if (res.ok) {
          void load();
        }
      } finally {
        setRemovingId(null);
      }
    },
    [load],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary">
            White-Label Clients
          </h1>
          <p className="mt-1 text-sm text-navy-500">
            Manage the client organizations you can view and support under
            your consultant portal.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            Add Client
          </Button>
        )}
      </div>

      {loading ? (
        <LoadingSpinner center label="Loading clients..." />
      ) : loadError ? (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {loadError}
        </div>
      ) : clients.length === 0 ? (
        <Card>
          <EmptyState
            icon={Building2}
            title="No clients yet"
            description={
              canManage
                ? "Grant access to a client organization by the email of one of its members. Click Add Client to get started."
                : "No client organizations have been added yet."
            }
          />
        </Card>
      ) : (
        <Card noPadding>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                <th className="px-4 py-3">Organization</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Access Level</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Granted</th>
                {canManage && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => (
                <tr key={client.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium text-navy-900">
                    {client.organization?.name ?? "Unknown organization"}
                  </td>
                  <td className="px-4 py-3 text-navy-600 capitalize">
                    {client.organization?.subscription_tier ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-navy-600">
                    {client.access_level}
                  </td>
                  <td className="px-4 py-3">
                    <Badge color={client.active ? "green" : "gray"}>
                      {client.active ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-navy-500">
                    {formatRelative(client.granted_at)}
                  </td>
                  {canManage && (
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="secondary"
                        size="sm"
                        isLoading={removingId === client.id}
                        onClick={() => void handleRemove(client.id)}
                      >
                        Remove
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {addOpen && (
        <AddClientModal
          onClose={() => setAddOpen(false)}
          onSaved={() => {
            setAddOpen(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

function AddClientModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);

    if (!email.trim()) {
      setFormError("Email is required.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/consultant/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setFormError(data?.error ?? "Could not add the client.");
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
      title="Add Client"
      description="Enter the email of a member of the client organization to grant access."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="add-client-form" isLoading={submitting}>
            <Plus className="h-4 w-4" aria-hidden />
            Add Client
          </Button>
        </>
      }
    >
      <form
        id="add-client-form"
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
          label="Client Email"
          required
          type="email"
          value={email}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
          placeholder="contact@clientorg.org"
          helperText="Must be an existing Benavora user at the client organization."
        />
      </form>
    </Modal>
  );
}
