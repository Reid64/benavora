"use client";

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  Building2,
  Check,
  Clock,
  Copy,
  Mail,
  RotateCcw,
  ShieldCheck,
  Trash2,
  TrendingUp,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  Badge,
  Button,
  EmptyState,
  Input,
  LoadingSpinner,
  Modal,
  Select,
} from "@/components/ui";
import type { BadgeColor } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
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

const CANVAS = "#D6E4F0";
const CARD = "#FFFFFF";
const ACCENT = "#0077B6";
const TOGGLE_BLUE = "#0EA5E9";
const BORDER = "#DCE6ED";
const TEXT_PRIMARY = "#0F172A";
const TEXT_SECONDARY = "#64748B";
const TEXT_MUTED = "#94A3B8";

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

type SectionId = "organization" | "team" | "usage" | "flags" | "danger";

interface NavItem {
  id: SectionId;
  label: string;
  icon: LucideIcon;
  danger?: boolean;
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
  const isOwner = profile?.role === "owner";

  const navItems: NavItem[] = [
    { id: "organization", label: "Organization", icon: Building2 },
    { id: "team", label: "Team", icon: Users },
    { id: "usage", label: "Plan Usage", icon: TrendingUp },
    { id: "flags", label: "Feature Flags", icon: ShieldCheck },
    ...(isOwner
      ? [{ id: "danger" as SectionId, label: "Danger Zone", icon: AlertTriangle, danger: true }]
      : []),
  ];

  const [active, setActive] = useState<SectionId>("organization");

  return (
    <div style={{ backgroundColor: CANVAS, minHeight: "100vh" }} className="p-6">
      <PageHeader
        title="Settings"
        description="Manage your organization, team, and platform configuration."
      />

      {profileLoading ? (
        <div
          style={{ backgroundColor: CARD, borderRadius: "16px", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}
          className="p-10"
        >
          <LoadingSpinner center label="Loading settings..." />
        </div>
      ) : (
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
          {/* Sidebar nav */}
          <div
            style={{
              backgroundColor: CARD,
              borderRadius: "16px",
              boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
              width: "220px",
              flexShrink: 0,
            }}
            className="w-full overflow-hidden lg:w-[220px]"
          >
            <nav className="p-2">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = active === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActive(item.id)}
                    style={{
                      backgroundColor: isActive
                        ? item.danger
                          ? "#FEF2F2"
                          : "#EFF6FF"
                        : "transparent",
                      color: isActive
                        ? item.danger
                          ? "#B91C1C"
                          : ACCENT
                        : item.danger
                          ? "#B91C1C"
                          : TEXT_SECONDARY,
                    }}
                    className="mb-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors last:mb-0"
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden />
                    {item.label}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Content pane */}
          <div
            style={{
              backgroundColor: CARD,
              borderRadius: "16px",
              boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
            }}
            className="min-w-0 flex-1 overflow-hidden"
          >
            {active === "organization" && <OrganizationSection canManage={manage} />}
            {active === "team" && (
              <TeamSection
                canManage={manage}
                currentUserRole={profile?.role}
                currentUserId={profile?.id ?? null}
              />
            )}
            {active === "usage" && <UsageDashboardSection />}
            {active === "flags" && <FeatureFlagsSection />}
            {active === "danger" && isOwner && <DangerZoneSection />}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared section shell + row primitives
// ---------------------------------------------------------------------------

function SettingsSection({
  icon: Icon,
  title,
  description,
  actions,
  bodyClassName = "px-6 py-5",
  children,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Override the body's padding — pass "" when children are full-bleed setting rows. */
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div
        style={{ backgroundColor: "#F8FAFC", borderBottom: `1px solid ${BORDER}` }}
        className="px-6 py-4 flex items-center gap-3"
      >
        <div
          style={{ backgroundColor: "#EFF6FF", color: ACCENT }}
          className="w-8 h-8 rounded-lg flex items-center justify-center"
        >
          <Icon className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h3 style={{ color: TEXT_PRIMARY }} className="text-base font-semibold">
            {title}
          </h3>
          {description && (
            <p style={{ color: TEXT_MUTED }} className="text-xs mt-0.5">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      <div className={bodyClassName}>{children}</div>
    </div>
  );
}

/** Toggle-switch styled indicator. Active state uses the premium toggle blue. */
function ToggleIndicator({ enabled }: { enabled: boolean }) {
  return (
    <div
      role="img"
      aria-label={enabled ? "Enabled" : "Disabled"}
      style={{ backgroundColor: enabled ? TOGGLE_BLUE : "#E2E8F0" }}
      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors"
    >
      <span
        style={{ backgroundColor: "#FFFFFF" }}
        className={`inline-block h-4 w-4 transform rounded-full shadow transition-transform ${
          enabled ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </div>
  );
}

/** Full-row toggle treatment for the feature flags list (blue #0EA5E9 active state). */
function ToggleRow({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <li
      style={{
        borderBottom: `1px solid #F1F5F9`,
        backgroundColor: enabled ? "#F0F9FF" : "transparent",
      }}
      className="px-6 py-4 flex items-center justify-between gap-3 last:border-0"
    >
      <div className="min-w-0">
        <p style={{ color: TEXT_PRIMARY }} className="text-sm font-medium">
          {label}
        </p>
      </div>
      <ToggleIndicator enabled={enabled} />
    </li>
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
    <SettingsSection
      icon={Building2}
      title="Organization"
      description="Your organization's display name, used across the app and on applications."
    >
      {loading ? (
        <LoadingSpinner center label="Loading organization..." />
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
              style={{ border: "1px solid #FECACA", backgroundColor: "#FEF2F2", color: "#B91C1C" }}
              className="rounded-lg px-4 py-3 text-sm"
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
                <span style={{ color: "#16A34A" }} className="inline-flex items-center gap-1.5 text-sm">
                  <Check className="h-4 w-4" aria-hidden />
                  Saved
                </span>
              )}
              <Button
                type="submit"
                isLoading={saving}
                style={{ backgroundColor: ACCENT, color: "#FFFFFF" }}
                className="px-6 py-2.5 rounded-lg font-semibold text-sm"
              >
                Save changes
              </Button>
            </div>
          )}
        </form>
      )}
    </SettingsSection>
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
    <SettingsSection
      icon={Users}
      title="Team"
      description="People with access to this organization's workspace."
      bodyClassName=""
    >
      <div>
        {canManage && (
          <div
            style={{ borderBottom: "1px solid #F1F5F9" }}
            className="px-6 py-4 flex items-center justify-between gap-3"
          >
            <p style={{ color: TEXT_SECONDARY }} className="text-sm">
              Manage who can access your workspace and what they can do.
            </p>
            <Button onClick={() => setInviteOpen(true)} style={{ backgroundColor: ACCENT, color: "#FFFFFF" }}>
              <UserPlus className="h-4 w-4" aria-hidden />
              Invite user
            </Button>
          </div>
        )}

        {actionError && (
          <div
            role="alert"
            style={{ border: "1px solid #FECACA", backgroundColor: "#FEF2F2", color: "#B91C1C" }}
            className="mx-6 mt-4 rounded-lg px-4 py-3 text-sm"
          >
            {actionError}
          </div>
        )}

        {loading ? (
          <div className="px-6 py-5">
            <LoadingSpinner center label="Loading team..." />
          </div>
        ) : loadError ? (
          <div
            role="alert"
            style={{ border: "1px solid #FECACA", backgroundColor: "#FEF2F2", color: "#B91C1C" }}
            className="mx-6 my-4 rounded-lg px-4 py-3 text-sm"
          >
            {loadError}
          </div>
        ) : users.length === 0 ? (
          <div className="px-6 py-5">
            <EmptyState
              icon={Users}
              title="No team members"
              description="Your team will appear here."
            />
          </div>
        ) : (
          <ul>
            {users.map((member) => (
              <li
                key={member.id}
                style={{ borderBottom: "1px solid #F1F5F9" }}
                className="px-6 py-4 flex flex-wrap items-center justify-between gap-3 last:border-0"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p style={{ color: TEXT_PRIMARY }} className="text-sm font-medium">
                      {member.full_name?.trim() || member.email}
                    </p>
                    {member.id === currentUserId && (
                      <Badge color="gray">You</Badge>
                    )}
                  </div>
                  <p style={{ color: TEXT_MUTED }} className="text-xs mt-0.5">
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
                      style={{ border: `1px solid #CBD5E1`, backgroundColor: "#FFFFFF", color: TEXT_PRIMARY }}
                      className="rounded-lg py-1.5 pl-2.5 pr-7 text-sm shadow-sm transition focus:outline-none"
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
                        style={{ color: TEXT_MUTED }}
                        className="rounded-md p-1.5 transition hover:bg-red-50 hover:text-red-600 focus:outline-none"
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
          <div className="px-6 py-5">
            <PendingInvites
              invites={invites}
              currentUserRole={currentUserRole}
              onChanged={() => void load()}
            />
          </div>
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
        <p style={{ color: TEXT_SECONDARY }} className="text-sm">
          This permanently removes their account from your organization. This
          action cannot be undone.
        </p>
      </Modal>
    </SettingsSection>
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
    <div style={{ border: "1px solid #E2E8F0", backgroundColor: "#F8FAFC" }} className="rounded-lg p-4">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4" style={{ color: TEXT_SECONDARY }} aria-hidden />
        <h4 style={{ color: TEXT_PRIMARY }} className="text-sm font-semibold">
          Pending invitations
        </h4>
      </div>

      {error && (
        <div
          role="alert"
          style={{ border: "1px solid #FECACA", backgroundColor: "#FEF2F2", color: "#B91C1C" }}
          className="mt-3 rounded-lg px-3 py-2 text-sm"
        >
          {error}
        </div>
      )}

      <ul style={{ borderTop: "1px solid transparent" }} className="mt-3 divide-y divide-slate-200">
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
                  <p style={{ color: TEXT_PRIMARY }} className="text-sm font-medium">{invite.email}</p>
                  <Badge color={ROLE_BADGE[invite.role]}>
                    {humanizeEnum(invite.role)}
                  </Badge>
                  {expired && <Badge color="yellow">Expired</Badge>}
                </div>
                <p style={{ color: TEXT_MUTED }} className="text-xs mt-0.5">
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
                    style={{ color: TEXT_MUTED }}
                    className="rounded-md p-1.5 transition hover:bg-red-50 hover:text-red-600 focus:outline-none disabled:opacity-50"
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
            style={{ border: "1px solid #BBF7D0", backgroundColor: "#F0FDF4", color: "#15803D" }}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
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
              style={{ border: "1px solid #FECACA", backgroundColor: "#FEF2F2", color: "#B91C1C" }}
              className="rounded-lg px-3 py-2 text-sm"
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
// Usage dashboard (Behavioral Contracts §25)
// ---------------------------------------------------------------------------

interface UsageResource {
  resource: string;
  current: number;
  limit: number;
  allowed: boolean;
  period: string;
}

interface UsageSummary {
  tier: string;
  resources: Record<string, UsageResource>;
}

const RESOURCE_DISPLAY: Record<string, { label: string; unit?: string }> = {
  opportunities: { label: "Opportunities" },
  applications:  { label: "Applications" },
  ai_drafts:     { label: "AI Drafts" },
  agent_runs:    { label: "Agent Runs" },
  storage_mb:    { label: "Storage", unit: "MB" },
  users:         { label: "Team Members" },
};

const RESOURCE_ORDER = [
  "opportunities",
  "applications",
  "ai_drafts",
  "agent_runs",
  "storage_mb",
  "users",
] as const;

function usagePercent(current: number, limit: number): number {
  if (limit === -1) return 0;
  return Math.min(100, Math.round((current / limit) * 100));
}

function barColor(pct: number): string {
  if (pct >= 90) return "#EF4444";
  if (pct >= 75) return "#F59E0B";
  return "#14B8A6";
}

function formatValue(current: number, limit: number, unit?: string): string {
  const u = unit ? ` ${unit}` : "";
  const cur = unit === "MB" ? current.toFixed(1) : String(Math.floor(current));
  if (limit === -1) return `${cur}${u} / Unlimited`;
  const lim = unit === "MB" ? String(limit) : String(limit);
  return `${cur}${u} / ${lim}${u}`;
}

function UsageDashboardSection() {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/billing/usage");
        if (!active) return;
        if (!res.ok) {
          setLoadError("Could not load usage data.");
          setLoading(false);
          return;
        }
        const data = (await res.json()) as UsageSummary;
        if (!active) return;
        setSummary(data);
      } catch {
        if (!active) return;
        setLoadError("Could not load usage data.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <SettingsSection
      icon={TrendingUp}
      title="Plan Usage"
      description="Your organization's current usage against tier limits. Resets monthly for drafts, applications, and opportunities; daily for agent runs."
      bodyClassName=""
    >
      {loading ? (
        <div className="px-6 py-5">
          <LoadingSpinner center label="Loading usage..." />
        </div>
      ) : loadError ? (
        <div
          role="alert"
          style={{ border: "1px solid #FECACA", backgroundColor: "#FEF2F2", color: "#B91C1C" }}
          className="mx-6 my-4 rounded-lg px-4 py-3 text-sm"
        >
          {loadError}
        </div>
      ) : summary ? (
        <div>
          <div style={{ borderBottom: "1px solid #F1F5F9" }} className="px-6 py-4 flex items-center gap-2">
            <TrendingUp className="h-4 w-4" style={{ color: TEXT_SECONDARY }} aria-hidden />
            <span style={{ color: TEXT_PRIMARY }} className="text-sm font-medium capitalize">
              {summary.tier} plan
            </span>
          </div>

          <ul>
            {RESOURCE_ORDER.map((key) => {
              const resource = summary.resources[key];
              if (!resource) return null;
              const meta = RESOURCE_DISPLAY[key]!;
              const pct = usagePercent(resource.current, resource.limit);
              const unlimited = resource.limit === -1;

              return (
                <li
                  key={key}
                  style={{ borderBottom: "1px solid #F1F5F9" }}
                  className="px-6 py-4 last:border-0"
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span style={{ color: TEXT_PRIMARY }} className="text-sm font-medium">
                      {meta.label}
                      <span style={{ color: TEXT_MUTED }} className="ml-1.5 text-xs font-normal">
                        ({resource.period})
                      </span>
                    </span>
                    <span
                      style={{ color: !unlimited && pct >= 90 ? "#DC2626" : TEXT_MUTED }}
                      className="text-xs font-medium"
                    >
                      {formatValue(resource.current, resource.limit, meta.unit)}
                    </span>
                  </div>
                  <div style={{ backgroundColor: "#F1F5F9" }} className="h-2 w-full overflow-hidden rounded-full">
                    {unlimited ? (
                      <div style={{ backgroundColor: "#F1F5F9" }} className="h-full w-full rounded-full" />
                    ) : (
                      <div
                        style={{ width: `${pct}%`, backgroundColor: barColor(pct) }}
                        className="h-full rounded-full transition-all"
                        role="progressbar"
                        aria-valuenow={pct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${meta.label} usage: ${pct}%`}
                      />
                    )}
                  </div>
                  {!unlimited && !resource.allowed && (
                    <p style={{ color: "#DC2626" }} className="mt-1 text-xs">
                      Limit reached.{" "}
                      <a href="/billing" style={{ color: "#DC2626" }} className="underline underline-offset-2">
                        Upgrade your plan
                      </a>{" "}
                      to continue.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </SettingsSection>
  );
}

// ---------------------------------------------------------------------------
// Feature flags (read-only)
// ---------------------------------------------------------------------------

// Human labels for the feature.* flags seeded per organization (SCHEMA_REGISTRY
// platform_config). Display-only in the MVP - the underlying capabilities ship later.
const FEATURE_FLAG_LABELS: Record<string, { label: string }> = {
  "feature.research_agents": {
    label: "Automated research agents",
  },
  "feature.browser_automation": {
    label: "Browser automation (form filling)",
  },
  "feature.email_integration": {
    label: "Email & calendar integration",
  },
  "feature.cold_outreach_email": {
    label: "Cold outreach email sending",
  },
  "feature.stripe_billing": {
    label: "Stripe subscription billing",
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
    <SettingsSection
      icon={ShieldCheck}
      title="Feature flags"
      description="Capabilities enabled for your organization. These roll out by phase and are managed by Benavora."
      bodyClassName=""
    >
      {loading ? (
        <div className="px-6 py-5">
          <LoadingSpinner center label="Loading feature flags..." />
        </div>
      ) : loadError ? (
        <div
          role="alert"
          style={{ border: "1px solid #FECACA", backgroundColor: "#FEF2F2", color: "#B91C1C" }}
          className="mx-6 my-4 rounded-lg px-4 py-3 text-sm"
        >
          {loadError}
        </div>
      ) : flags.length === 0 ? (
        <div className="px-6 py-5">
          <EmptyState
            icon={ShieldCheck}
            title="No feature flags"
            description="Feature flags for your organization will appear here."
          />
        </div>
      ) : (
        <ul>
          {flags.map((flag) => {
            const meta = FEATURE_FLAG_LABELS[flag.key];
            if (!meta) return null;
            const enabled = flag.value === "true";
            return <ToggleRow key={flag.key} label={meta.label} enabled={enabled} />;
          })}
        </ul>
      )}
    </SettingsSection>
  );
}

// ---------------------------------------------------------------------------
// Danger zone (owner only)
// ---------------------------------------------------------------------------

/**
 * Owner-only callout for the organization's permanent, destructive action:
 * removing a team member (wired in the Team section's per-row Remove
 * button). No separate control here — this simply calls out the blast
 * radius of that existing action per the Elevated Slate danger-zone pattern.
 */
function DangerZoneSection() {
  return (
    <div className="p-6">
      <div
        style={{ border: "1px solid #FCA5A5", backgroundColor: "#FFF1F1", borderRadius: "12px" }}
        className="p-5"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" style={{ color: "#B91C1C" }} aria-hidden />
          <h3 style={{ color: "#B91C1C" }} className="font-semibold">Danger zone</h3>
        </div>
        <p style={{ color: TEXT_SECONDARY }} className="mt-2 text-sm">
          Removing a team member in the Team section is permanent and
          immediately revokes their access to this organization. This action
          cannot be undone.
        </p>
      </div>
    </div>
  );
}
