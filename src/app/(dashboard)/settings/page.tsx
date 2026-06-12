"use client";

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import {
  Check,
  Clock,
  Copy,
  Mail,
  RotateCcw,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
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
import type { BadgeColor } from "@/components/ui";
import { recordAudit } from "@/lib/audit/client";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/hooks/useProfile";
import { USER_ROLES } from "@/lib/utils/constants";
import { formatDate, formatRelative, humanizeEnum } from "@/lib/utils/formatters";
import { isNonEmpty, isValidEmail } from "@/lib/utils/validators";
import type { Enums, Tables } from "@/types/database";

type UserRole = Enums<"user_role">;

type OrgUser = Pick<
  Tables<"profiles">,
  "id" | "email" | "full_name" | "role" | "last_login_at"
>;

const ROLE_BADGE: Record<UserRole, BadgeColor> = {
  owner: "indigo",
  admin: "blue",
  writer: "green",
  viewer: "gray",
};

/** Owners and admins manage org settings; writers/viewers cannot (BLUEPRINT §3.2). */
function canManageOrg(role: UserRole | undefined): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Organization settings (BLUEPRINT §3.2 / PRD US-03). Owners and admins can edit
 * the organization name, invite users, and review the team roster. Feature flags
 * (seeded per organization in platform_config) are surfaced read-only so the
 * operator can see which phases are enabled.
 */
export default function SettingsPage() {
  const { profile, loading: profileLoading } = useProfile();
  const manage = canManageOrg(profile?.role);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
          Settings
        </h1>
        <p className="mt-1 text-sm text-navy-500">
          Manage your organization, team, and platform configuration.
        </p>
      </div>

      {profileLoading ? (
        <LoadingSpinner center label="Loading settings…" />
      ) : (
        <>
          <OrganizationSection canManage={manage} />
          <TeamSection
            canManage={manage}
            currentUserRole={profile?.role}
            currentUserId={profile?.id ?? null}
          />
          <FeatureFlagsSection />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Organization name
// ---------------------------------------------------------------------------

function OrganizationSection({ canManage }: { canManage: boolean }) {
  const [org, setOrg] = useState<Tables<"organizations"> | null>(null);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    (async () => {
      // RLS scopes organizations to the caller's org, so there is exactly one row.
      const { data, error } = await supabase
        .from("organizations")
        .select("*")
        .limit(1)
        .single();
      if (!active) return;
      if (error || !data) {
        setLoadError("Could not load your organization.");
        setLoading(false);
        return;
      }
      setOrg(data as Tables<"organizations">);
      setName((data as Tables<"organizations">).name ?? "");
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!org) return;
    setSaveError(null);
    setNameError(null);
    setSaved(false);

    if (!isNonEmpty(name)) {
      setNameError("Organization name is required.");
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("organizations")
      .update({ name: name.trim(), updated_at: new Date().toISOString() })
      .eq("id", org.id)
      .select()
      .single();

    setSaving(false);
    if (error || !data) {
      setSaveError(error?.message ?? "Could not save your organization.");
      return;
    }
    setOrg(data as Tables<"organizations">);
    setName((data as Tables<"organizations">).name ?? "");
    setSaved(true);

    // Audit the settings change (Behavioral Contracts §24).
    void recordAudit({
      action: "update",
      entityType: "organization",
      entityId: org.id,
      details: { field: "name" },
    });
  }

  return (
    <Card
      title="Organization"
      description="Your organization's display name, used across the app and on applications."
    >
      {loading ? (
        <LoadingSpinner center label="Loading organization…" />
      ) : loadError || !org ? (
        <EmptyState
          icon={ShieldCheck}
          title="Organization unavailable"
          description={loadError ?? "Your organization could not be loaded."}
        />
      ) : (
        <form onSubmit={handleSave} className="space-y-5" noValidate>
          {saveError && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {saveError}
            </div>
          )}
          <Input
            label="Organization name"
            required
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
            error={nameError ?? undefined}
            disabled={!canManage}
            helperText={
              canManage
                ? undefined
                : "Only owners and admins can change the organization name."
            }
          />
          {canManage && (
            <div className="flex items-center justify-end gap-3">
              {saved && (
                <span className="inline-flex items-center gap-1.5 text-sm text-green-600">
                  <Check className="h-4 w-4" aria-hidden />
                  Saved
                </span>
              )}
              <Button type="submit" isLoading={saving}>
                Save changes
              </Button>
            </div>
          )}
        </form>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Team: roster + invite
// ---------------------------------------------------------------------------

type PendingInvite = {
  id: string;
  email: string;
  role: UserRole;
  status: string;
  expires_at: string;
  created_at: string;
};

/** Roles an editor may ASSIGN when changing a member's role (BLUEPRINT §3.2). */
function assignableEditRoles(editorRole: UserRole | undefined): UserRole[] {
  // Owners can set any role; admins are limited to writer/viewer (task §4).
  if (editorRole === "owner") return [...USER_ROLES];
  if (editorRole === "admin") return ["writer", "viewer"];
  return [];
}

/** Roles an inviter may grant. Admins cannot mint owners (Contracts §23). */
function assignableInviteRoles(inviterRole: UserRole | undefined): UserRole[] {
  if (inviterRole === "owner") return [...USER_ROLES];
  if (inviterRole === "admin") return ["admin", "writer", "viewer"];
  return [];
}

function TeamSection({
  canManage,
  currentUserRole,
  currentUserId,
}: {
  canManage: boolean;
  currentUserRole: UserRole | undefined;
  currentUserId: string | null;
}) {
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<OrgUser | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const supabase = createClient();
    // Owners/admins can read every profile in their org; others see their own.
    const [usersRes, invitesRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, email, full_name, role, last_login_at")
        .order("created_at", { ascending: true }),
      supabase
        .from("user_invitations")
        .select("id, email, role, status, expires_at, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
    ]);
    if (usersRes.error) {
      setLoadError("Could not load your team.");
      setLoading(false);
      return;
    }
    setUsers((usersRes.data ?? []) as OrgUser[]);
    // The invitations table is unavailable to non-managers via RLS; treat any
    // error there as simply "no pending invites" rather than failing the page.
    setInvites((invitesRes.data ?? []) as PendingInvite[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRoleChange(member: OrgUser, role: UserRole) {
    setActionError(null);
    const res = await fetch("/api/users", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: member.id, role }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setActionError(data?.error ?? "Could not update the role.");
      return;
    }
    void load();
  }

  async function confirmRemove() {
    if (!removeTarget) return;
    setActionError(null);
    const res = await fetch("/api/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: removeTarget.id }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setActionError(data?.error ?? "Could not remove that user.");
      setRemoveTarget(null);
      return;
    }
    setRemoveTarget(null);
    void load();
  }

  // Owners can edit anyone; admins can edit writers/viewers but not owners.
  function canEditMember(member: OrgUser): boolean {
    if (!canManage || member.id === currentUserId) return false;
    if (currentUserRole === "owner") return true;
    return member.role !== "owner"; // admin
  }

  return (
    <Card
      title="Team"
      description="People with access to this organization's workspace."
    >
      <div className="space-y-6">
        {canManage && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-navy-500">
              Manage who can access your workspace and what they can do.
            </p>
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlus className="h-4 w-4" aria-hidden />
              Invite user
            </Button>
          </div>
        )}

        {actionError && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {actionError}
          </div>
        )}

        {loading ? (
          <LoadingSpinner center label="Loading team…" />
        ) : loadError ? (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {loadError}
          </div>
        ) : users.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No team members"
            description="Your team will appear here."
          />
        ) : (
          <ul className="divide-y divide-navy-100">
            {users.map((member) => (
              <li
                key={member.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-navy-900">
                      {member.full_name?.trim() || member.email}
                    </p>
                    {member.id === currentUserId && (
                      <Badge color="gray">You</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-navy-500">
                    {member.email}
                    {member.last_login_at
                      ? ` · last active ${formatRelative(member.last_login_at)}`
                      : " · invite pending"}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {canEditMember(member) ? (
                    <select
                      aria-label={`Role for ${member.email}`}
                      value={member.role}
                      onChange={(e) =>
                        void handleRoleChange(
                          member,
                          e.target.value as UserRole,
                        )
                      }
                      className="rounded-lg border border-navy-300 bg-white py-1.5 pl-2.5 pr-7 text-sm text-navy-900 shadow-sm transition focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500"
                    >
                      {/* Always include the member's current role so it shows
                          even when it isn't in the editor's assignable set. */}
                      {Array.from(
                        new Set([
                          member.role,
                          ...assignableEditRoles(currentUserRole),
                        ]),
                      ).map((r) => (
                        <option key={r} value={r}>
                          {humanizeEnum(r)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Badge color={ROLE_BADGE[member.role]}>
                      {humanizeEnum(member.role)}
                    </Badge>
                  )}

                  {/* Only owners may remove members, never themselves. */}
                  {currentUserRole === "owner" &&
                    member.id !== currentUserId && (
                      <button
                        type="button"
                        onClick={() => setRemoveTarget(member)}
                        aria-label={`Remove ${member.email}`}
                        className="rounded-md p-1.5 text-navy-400 transition hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {canManage && (
          <PendingInvites
            invites={invites}
            currentUserRole={currentUserRole}
            onChanged={() => void load()}
          />
        )}
      </div>

      {inviteOpen && (
        <InviteModal
          currentUserRole={currentUserRole}
          onClose={() => setInviteOpen(false)}
          onInvited={() => void load()}
        />
      )}

      <Modal
        isOpen={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        title="Remove team member"
        description={
          removeTarget
            ? `${removeTarget.full_name?.trim() || removeTarget.email} will lose all access to this organization.`
            : undefined
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoveTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void confirmRemove()}>
              Remove user
            </Button>
          </>
        }
      >
        <p className="text-sm text-navy-600">
          This permanently removes their account from your organization. This
          action cannot be undone.
        </p>
      </Modal>
    </Card>
  );
}

function PendingInvites({
  invites,
  currentUserRole,
  onChanged,
}: {
  invites: PendingInvite[];
  currentUserRole: UserRole | undefined;
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resend(invite: PendingInvite) {
    setError(null);
    setBusyId(invite.id);
    const res = await fetch("/api/users/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: invite.email, role: invite.role }),
    });
    setBusyId(null);
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Could not resend the invitation.");
      return;
    }
    onChanged();
  }

  async function cancel(invite: PendingInvite) {
    setError(null);
    setBusyId(invite.id);
    // Cancelled invitations can no longer be accepted (Contracts §23).
    const supabase = createClient();
    const { error: cancelError } = await supabase
      .from("user_invitations")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", invite.id);
    setBusyId(null);
    if (cancelError) {
      setError("Could not cancel the invitation.");
      return;
    }
    onChanged();
  }

  if (invites.length === 0) return null;

  return (
    <div className="rounded-lg border border-navy-200 bg-navy-50/40 p-4">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-navy-500" aria-hidden />
        <h4 className="text-sm font-semibold text-navy-800">
          Pending invitations
        </h4>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      <ul className="mt-3 divide-y divide-navy-100">
        {invites.map((invite) => {
          const expired = new Date(invite.expires_at).getTime() < Date.now();
          // Admins can't manage an invitation for an owner role.
          const manageable =
            currentUserRole === "owner" || invite.role !== "owner";
          return (
            <li
              key={invite.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-navy-900">{invite.email}</p>
                  <Badge color={ROLE_BADGE[invite.role]}>
                    {humanizeEnum(invite.role)}
                  </Badge>
                  {expired && <Badge color="yellow">Expired</Badge>}
                </div>
                <p className="mt-0.5 text-sm text-navy-500">
                  Invited {formatRelative(invite.created_at)} · expires{" "}
                  {formatDate(invite.expires_at)}
                </p>
              </div>
              {manageable && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    isLoading={busyId === invite.id}
                    onClick={() => void resend(invite)}
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                    Resend
                  </Button>
                  <button
                    type="button"
                    onClick={() => void cancel(invite)}
                    disabled={busyId === invite.id}
                    aria-label={`Cancel invitation for ${invite.email}`}
                    className="rounded-md p-1.5 text-navy-400 transition hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function InviteModal({
  currentUserRole,
  onClose,
  onInvited,
}: {
  currentUserRole: UserRole | undefined;
  onClose: () => void;
  onInvited: () => void;
}) {
  const roleOptions = assignableInviteRoles(currentUserRole).map((value) => ({
    value,
    label: humanizeEnum(value),
  }));

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("viewer");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ link: string; emailed: boolean } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);

    if (!isValidEmail(email)) {
      setError("Enter a valid email address.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/users/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role }),
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: string; link?: string; emailed?: boolean }
        | null;

      if (!res.ok) {
        setError(data?.error ?? "Could not send the invitation.");
        return;
      }
      setResult({ link: data?.link ?? "", emailed: Boolean(data?.emailed) });
      onInvited();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyLink() {
    if (!result?.link) return;
    try {
      await navigator.clipboard.writeText(result.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Invite a user"
      description="They'll join this organization with the role you choose."
      footer={
        result ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form="invite-form" isLoading={submitting}>
              <UserPlus className="h-4 w-4" aria-hidden />
              Send invite
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3">
          <div
            role="status"
            className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700"
          >
            <Mail className="h-4 w-4 shrink-0" aria-hidden />
            {result.emailed
              ? "Invitation emailed."
              : "Invitation created. Share this link with the invitee:"}
          </div>
          {result.link && (
            <div className="flex items-center gap-2">
              <Input readOnly value={result.link} className="flex-1" />
              <Button variant="secondary" onClick={() => void copyLink()}>
                {copied ? (
                  <Check className="h-4 w-4" aria-hidden />
                ) : (
                  <Copy className="h-4 w-4" aria-hidden />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <form id="invite-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {error}
            </div>
          )}
          <Input
            label="Email address"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.org"
          />
          <Select
            label="Role"
            options={roleOptions}
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
          />
        </form>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Feature flags (read-only)
// ---------------------------------------------------------------------------

// Human labels for the feature.* flags seeded per organization (SCHEMA_REGISTRY
// platform_config). Display-only in the MVP — the underlying phases ship later.
const FEATURE_FLAG_LABELS: Record<string, { label: string; phase: string }> = {
  "feature.research_agents": {
    label: "Automated research agents",
    phase: "Phase 2",
  },
  "feature.browser_automation": {
    label: "Browser automation (form filling)",
    phase: "Phase 3",
  },
  "feature.email_integration": {
    label: "Email & calendar integration",
    phase: "Phase 4",
  },
  "feature.cold_outreach_email": {
    label: "Cold outreach email sending",
    phase: "Phase 4",
  },
  "feature.stripe_billing": {
    label: "Stripe subscription billing",
    phase: "Phase 5",
  },
};

function FeatureFlagsSection() {
  const [flags, setFlags] = useState<{ key: string; value: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    (async () => {
      const { data, error } = await supabase
        .from("platform_config")
        .select("key, value")
        .like("key", "feature.%")
        .order("key", { ascending: true });
      if (!active) return;
      if (error) {
        setLoadError("Could not load feature flags.");
        setLoading(false);
        return;
      }
      setFlags(
        ((data ?? []) as { key: string; value: string }[]).filter(
          (row) => row.key in FEATURE_FLAG_LABELS,
        ),
      );
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <Card
      title="Feature flags"
      description="Capabilities enabled for your organization. These roll out by phase and are managed by Benavora."
    >
      {loading ? (
        <LoadingSpinner center label="Loading feature flags…" />
      ) : loadError ? (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {loadError}
        </div>
      ) : flags.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No feature flags"
          description="Feature flags for your organization will appear here."
        />
      ) : (
        <ul className="divide-y divide-navy-100">
          {flags.map((flag) => {
            const meta = FEATURE_FLAG_LABELS[flag.key];
            if (!meta) return null;
            const enabled = flag.value === "true";
            return (
              <li
                key={flag.key}
                className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="font-medium text-navy-900">{meta.label}</p>
                  <p className="mt-0.5 text-xs text-navy-400">{meta.phase}</p>
                </div>
                <Badge color={enabled ? "green" : "gray"} withDot>
                  {enabled ? "Enabled" : "Disabled"}
                </Badge>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
