"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Briefcase,
  Check,
  Pencil,
  Plus,
  Trash2,
  Users,
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
  Textarea,
} from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import { PROGRAM_STATUSES } from "@/lib/utils/constants";
import { formatCurrency, formatDate, humanizeEnum } from "@/lib/utils/formatters";
import { isNonEmpty } from "@/lib/utils/validators";
import type { Tables, TablesUpdate } from "@/types/database";

// All editable organization-profile fields are held as strings while editing;
// numeric fields are parsed on save (Knowledge Base profile - BLUEPRINT §4.7).
type OrgForm = {
  name: string;
  dba: string;
  ein: string;
  tax_status: string;
  mission_statement: string;
  vision_statement: string;
  founding_date: string;
  founder_name: string;
  founder_bio: string;
  service_area: string;
  target_population: string;
  annual_budget: string;
  total_staff: string;
  total_volunteers: string;
  website: string;
  phone: string;
  email: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  zip: string;
};

function toForm(org: Tables<"organizations">): OrgForm {
  const str = (v: string | number | null | undefined) =>
    v === null || v === undefined ? "" : String(v);
  return {
    name: str(org.name),
    dba: str(org.dba),
    ein: str(org.ein),
    tax_status: str(org.tax_status),
    mission_statement: str(org.mission_statement),
    vision_statement: str(org.vision_statement),
    founding_date: str(org.founding_date),
    founder_name: str(org.founder_name),
    founder_bio: str(org.founder_bio),
    service_area: str(org.service_area),
    target_population: str(org.target_population),
    annual_budget: str(org.annual_budget),
    total_staff: str(org.total_staff),
    total_volunteers: str(org.total_volunteers),
    website: str(org.website),
    phone: str(org.phone),
    email: str(org.email),
    address_line1: str(org.address_line1),
    address_line2: str(org.address_line2),
    city: str(org.city),
    state: str(org.state),
    zip: str(org.zip),
  };
}

/**
 * Organization profile editor (BLUEPRINT §4.7). The profile is a single record
 * per organization, created at sign-up and never deleted (Behavioral Contracts
 * §8), so this only ever UPDATEs the row keyed by the session's organization_id.
 * Board members and programs are managed as separate sub-tables below.
 */
export function ProfileEditor() {
  const { profile } = useProfile();
  const editable = canEdit(profile?.role);

  const [org, setOrg] = useState<Tables<"organizations"> | null>(null);
  const [form, setForm] = useState<OrgForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const [boardMembers, setBoardMembers] = useState<Tables<"board_members">[]>(
    [],
  );
  const [programs, setPrograms] = useState<Tables<"programs">[]>([]);

  const loadSubTables = useCallback(async () => {
    const supabase = createClient();
    const [boardRes, programsRes] = await Promise.all([
      supabase
        .from("board_members")
        .select("*")
        .order("created_at", { ascending: true }),
      supabase
        .from("programs")
        .select("*")
        .order("created_at", { ascending: true }),
    ]);
    setBoardMembers(boardRes.data ?? []);
    setPrograms(programsRes.data ?? []);
  }, []);

  useEffect(() => {
    let active = true;
    const supabase = createClient();

    (async () => {
      setLoading(true);
      setLoadError(null);

      // RLS scopes organizations to the caller's org, so there is exactly one row.
      const { data, error } = await supabase
        .from("organizations")
        .select("*")
        .limit(1)
        .single();

      if (!active) return;

      if (error || !data) {
        setLoadError("Could not load your organization profile.");
        setLoading(false);
        return;
      }

      setOrg(data);
      setForm(toForm(data));
      await loadSubTables();
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [loadSubTables]);

  function update<K extends keyof OrgForm>(key: K, value: string) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSavedAt(false);
  }

  function parseNumber(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isNaN(n) ? null : n;
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!org || !form) return;
    setSaveError(null);
    setNameError(null);

    if (!isNonEmpty(form.name)) {
      setNameError("Organization name is required.");
      return;
    }

    const budget = parseNumber(form.annual_budget);
    if (form.annual_budget.trim() && budget === null) {
      setSaveError("Annual budget must be a number.");
      return;
    }
    const staff = parseNumber(form.total_staff);
    const volunteers = parseNumber(form.total_volunteers);

    setSaving(true);
    const supabase = createClient();

    const text = (v: string) => (v.trim() ? v.trim() : null);
    const payload: TablesUpdate<"organizations"> = {
      name: form.name.trim(),
      dba: text(form.dba),
      ein: text(form.ein),
      tax_status: text(form.tax_status),
      mission_statement: text(form.mission_statement),
      vision_statement: text(form.vision_statement),
      founding_date: text(form.founding_date),
      founder_name: text(form.founder_name),
      founder_bio: text(form.founder_bio),
      service_area: text(form.service_area),
      target_population: text(form.target_population),
      annual_budget: budget,
      total_staff: staff ?? 0,
      total_volunteers: volunteers ?? 0,
      website: text(form.website),
      phone: text(form.phone),
      email: text(form.email),
      address_line1: text(form.address_line1),
      address_line2: text(form.address_line2),
      city: text(form.city),
      state: text(form.state),
      zip: text(form.zip),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("organizations")
      .update(payload)
      .eq("id", org.id)
      .select()
      .single();

    setSaving(false);
    if (error || !data) {
      setSaveError(error?.message ?? "Could not save your profile.");
      return;
    }
    setOrg(data);
    setForm(toForm(data));
    setSavedAt(true);
  }

  if (loading) {
    return <LoadingSpinner center label="Loading organization profile…" />;
  }

  if (loadError || !org || !form) {
    return (
      <EmptyState
        icon={Briefcase}
        title="Profile unavailable"
        description={loadError ?? "Your organization profile could not be loaded."}
      />
    );
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSave} className="space-y-6" noValidate>
        {saveError && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {saveError}
          </div>
        )}

        <Card
          title="Identity & status"
          description="Legal identity used across every grant application."
        >
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Input
              label="Legal name"
              required
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              error={nameError ?? undefined}
              disabled={!editable}
            />
            <Input
              label="Doing business as (DBA)"
              value={form.dba}
              onChange={(e) => update("dba", e.target.value)}
              disabled={!editable}
            />
            <Input
              label="EIN"
              value={form.ein}
              onChange={(e) => update("ein", e.target.value)}
              placeholder="00-0000000"
              disabled={!editable}
            />
            <Input
              label="Tax status"
              value={form.tax_status}
              onChange={(e) => update("tax_status", e.target.value)}
              placeholder="e.g. 508(c)(1)(a)"
              disabled={!editable}
            />
            <Input
              label="Founding date"
              type="date"
              value={form.founding_date}
              onChange={(e) => update("founding_date", e.target.value)}
              disabled={!editable}
            />
          </div>
        </Card>

        <Card
          title="Mission & focus"
          description="The story the AI draft generator draws from. Never fabricated - only what you enter here is used."
        >
          <div className="space-y-5">
            <Textarea
              label="Mission statement"
              value={form.mission_statement}
              onChange={(e) => update("mission_statement", e.target.value)}
              rows={3}
              disabled={!editable}
            />
            <Textarea
              label="Vision statement"
              value={form.vision_statement}
              onChange={(e) => update("vision_statement", e.target.value)}
              rows={3}
              disabled={!editable}
            />
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Input
                label="Service area"
                value={form.service_area}
                onChange={(e) => update("service_area", e.target.value)}
                placeholder="e.g. Rural Texas"
                disabled={!editable}
              />
              <Input
                label="Target population"
                value={form.target_population}
                onChange={(e) => update("target_population", e.target.value)}
                disabled={!editable}
              />
            </div>
          </div>
        </Card>

        <Card title="Founder">
          <div className="space-y-5">
            <Input
              label="Founder name"
              value={form.founder_name}
              onChange={(e) => update("founder_name", e.target.value)}
              disabled={!editable}
            />
            <Textarea
              label="Founder bio"
              value={form.founder_bio}
              onChange={(e) => update("founder_bio", e.target.value)}
              rows={4}
              disabled={!editable}
            />
          </div>
        </Card>

        <Card
          title="Capacity"
          description="Budget and team size - used in capacity and sustainability narratives."
        >
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <Input
              label="Annual budget (USD)"
              type="number"
              min={0}
              step="1000"
              value={form.annual_budget}
              onChange={(e) => update("annual_budget", e.target.value)}
              disabled={!editable}
            />
            <Input
              label="Total staff"
              type="number"
              min={0}
              value={form.total_staff}
              onChange={(e) => update("total_staff", e.target.value)}
              disabled={!editable}
            />
            <Input
              label="Total volunteers"
              type="number"
              min={0}
              value={form.total_volunteers}
              onChange={(e) => update("total_volunteers", e.target.value)}
              disabled={!editable}
            />
          </div>
        </Card>

        <Card title="Contact & address">
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
              <Input
                label="Website"
                type="url"
                value={form.website}
                onChange={(e) => update("website", e.target.value)}
                placeholder="https://…"
                disabled={!editable}
              />
              <Input
                label="Phone"
                type="tel"
                value={form.phone}
                onChange={(e) => update("phone", e.target.value)}
                disabled={!editable}
              />
              <Input
                label="Email"
                type="email"
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
                disabled={!editable}
              />
            </div>
            <Input
              label="Address line 1"
              value={form.address_line1}
              onChange={(e) => update("address_line1", e.target.value)}
              disabled={!editable}
            />
            <Input
              label="Address line 2"
              value={form.address_line2}
              onChange={(e) => update("address_line2", e.target.value)}
              disabled={!editable}
            />
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
              <Input
                label="City"
                value={form.city}
                onChange={(e) => update("city", e.target.value)}
                disabled={!editable}
              />
              <Input
                label="State"
                value={form.state}
                onChange={(e) => update("state", e.target.value)}
                disabled={!editable}
              />
              <Input
                label="ZIP"
                value={form.zip}
                onChange={(e) => update("zip", e.target.value)}
                disabled={!editable}
              />
            </div>
          </div>
        </Card>

        {editable && (
          <div className="flex items-center justify-end gap-3">
            {savedAt && (
              <span className="inline-flex items-center gap-1.5 text-sm text-green-600">
                <Check className="h-4 w-4" aria-hidden />
                Profile saved
              </span>
            )}
            <Button type="submit" isLoading={saving}>
              Save profile
            </Button>
          </div>
        )}
      </form>

      <BoardMembersSection
        boardMembers={boardMembers}
        editable={editable}
        organizationId={profile?.organization_id ?? null}
        onChanged={loadSubTables}
      />

      <ProgramsSection
        programs={programs}
        editable={editable}
        organizationId={profile?.organization_id ?? null}
        onChanged={loadSubTables}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Board members sub-table
// ---------------------------------------------------------------------------

function BoardMembersSection({
  boardMembers,
  editable,
  organizationId,
  onChanged,
}: {
  boardMembers: Tables<"board_members">[];
  editable: boolean;
  organizationId: string | null;
  onChanged: () => Promise<void> | void;
}) {
  const [editing, setEditing] = useState<Tables<"board_members"> | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] =
    useState<Tables<"board_members"> | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    const supabase = createClient();
    await supabase.from("board_members").delete().eq("id", pendingDelete.id);
    setDeleting(false);
    setPendingDelete(null);
    await onChanged();
  }

  return (
    <Card
      title="Board members"
      description="Governance roster referenced in capacity and organizational-history narratives."
      actions={
        editable && (
          <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            Add member
          </Button>
        )
      }
    >
      {boardMembers.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No board members yet"
          description={
            editable
              ? "Add your board to strengthen capacity narratives."
              : "Board members will appear here."
          }
        />
      ) : (
        <ul className="divide-y divide-navy-100">
          {boardMembers.map((member) => (
            <li
              key={member.id}
              className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-navy-900">{member.name}</p>
                  {member.title && (
                    <span className="text-sm text-navy-500">
                      {member.title}
                    </span>
                  )}
                  {member.is_active === false && (
                    <Badge color="gray">Inactive</Badge>
                  )}
                </div>
                {member.bio && (
                  <p className="mt-1 line-clamp-2 text-sm text-navy-600">
                    {member.bio}
                  </p>
                )}
                <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-navy-400">
                  {member.email && <span>{member.email}</span>}
                  {member.phone && <span>{member.phone}</span>}
                  {member.start_date && (
                    <span>Since {formatDate(member.start_date)}</span>
                  )}
                </div>
              </div>
              {editable && (
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditing(member)}
                    aria-label={`Edit ${member.name}`}
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setPendingDelete(member)}
                    aria-label={`Remove ${member.name}`}
                  >
                    <Trash2 className="h-4 w-4 text-red-500" aria-hidden />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal
        isOpen={creating || editing !== null}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        title={editing ? "Edit board member" : "Add board member"}
        size="lg"
      >
        <BoardMemberForm
          member={editing ?? undefined}
          organizationId={organizationId}
          onCancel={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setCreating(false);
            setEditing(null);
            await onChanged();
          }}
        />
      </Modal>

      <Modal
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Remove board member"
        description="This cannot be undone."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setPendingDelete(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete} isLoading={deleting}>
              Remove
            </Button>
          </>
        }
      >
        <p className="text-sm text-navy-600">
          Remove{" "}
          <span className="font-medium">{pendingDelete?.name}</span> from the
          board roster?
        </p>
      </Modal>
    </Card>
  );
}

function BoardMemberForm({
  member,
  organizationId,
  onSaved,
  onCancel,
}: {
  member?: Tables<"board_members">;
  organizationId: string | null;
  onSaved: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const isEdit = Boolean(member);
  const [name, setName] = useState(member?.name ?? "");
  const [title, setTitle] = useState(member?.title ?? "");
  const [email, setEmail] = useState(member?.email ?? "");
  const [phone, setPhone] = useState(member?.phone ?? "");
  const [startDate, setStartDate] = useState(member?.start_date ?? "");
  const [bio, setBio] = useState(member?.bio ?? "");
  const [isActive, setIsActive] = useState(member?.is_active ?? true);
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNameError(null);
    if (!isNonEmpty(name)) {
      setNameError("Name is required.");
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const payload = {
      name: name.trim(),
      title: title.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      start_date: startDate.trim() || null,
      bio: bio.trim() || null,
      is_active: isActive,
    };

    if (isEdit && member) {
      const { error: updateError } = await supabase
        .from("board_members")
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq("id", member.id);
      setSaving(false);
      if (updateError) {
        setError(updateError.message);
        return;
      }
      await onSaved();
      return;
    }

    if (!organizationId) {
      setSaving(false);
      setError("Your session could not be verified.");
      return;
    }
    const { error: insertError } = await supabase
      .from("board_members")
      .insert({ ...payload, organization_id: organizationId });
    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    await onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Input
          label="Name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={nameError ?? undefined}
        />
        <Input
          label="Board role"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Chair, Secretary"
        />
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          label="Phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <Input
          label="Start date"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
      </div>
      <Textarea
        label="Bio"
        value={bio}
        onChange={(e) => setBio(e.target.value)}
        rows={3}
      />
      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          className="h-4 w-4 rounded border-navy-300 text-teal-600 focus:ring-teal-500"
        />
        <span className="font-medium text-navy-700">Currently serving</span>
      </label>
      <div className="flex items-center justify-end gap-3 border-t border-navy-200 pt-5">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" isLoading={saving}>
          {isEdit ? "Save changes" : "Add member"}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Programs sub-table
// ---------------------------------------------------------------------------

const PROGRAM_STATUS_OPTIONS = PROGRAM_STATUSES.map((value) => ({
  value,
  label: humanizeEnum(value),
}));

function ProgramsSection({
  programs,
  editable,
  organizationId,
  onChanged,
}: {
  programs: Tables<"programs">[];
  editable: boolean;
  organizationId: string | null;
  onChanged: () => Promise<void> | void;
}) {
  const [editing, setEditing] = useState<Tables<"programs"> | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Tables<"programs"> | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    const supabase = createClient();
    await supabase.from("programs").delete().eq("id", pendingDelete.id);
    setDeleting(false);
    setPendingDelete(null);
    await onChanged();
  }

  return (
    <Card
      title="Programs"
      description="Initiatives and their budgets, fed into program-description and impact narratives."
      actions={
        editable && (
          <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            Add program
          </Button>
        )
      }
    >
      {programs.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No programs yet"
          description={
            editable
              ? "Add a program to describe the work funders are supporting."
              : "Programs will appear here."
          }
        />
      ) : (
        <ul className="divide-y divide-navy-100">
          {programs.map((program) => (
            <li
              key={program.id}
              className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-navy-900">{program.name}</p>
                  {program.status && (
                    <Badge
                      color={program.status === "active" ? "green" : "gray"}
                    >
                      {humanizeEnum(program.status)}
                    </Badge>
                  )}
                </div>
                {program.description && (
                  <p className="mt-1 line-clamp-2 text-sm text-navy-600">
                    {program.description}
                  </p>
                )}
                <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-navy-400">
                  {program.budget != null && (
                    <span>Budget {formatCurrency(program.budget)}</span>
                  )}
                  {program.beneficiaries_served != null && (
                    <span>{program.beneficiaries_served} served</span>
                  )}
                  {program.start_date && (
                    <span>Started {formatDate(program.start_date)}</span>
                  )}
                </div>
              </div>
              {editable && (
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditing(program)}
                    aria-label={`Edit ${program.name}`}
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setPendingDelete(program)}
                    aria-label={`Delete ${program.name}`}
                  >
                    <Trash2 className="h-4 w-4 text-red-500" aria-hidden />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal
        isOpen={creating || editing !== null}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        title={editing ? "Edit program" : "Add program"}
        size="lg"
      >
        <ProgramForm
          program={editing ?? undefined}
          organizationId={organizationId}
          onCancel={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setCreating(false);
            setEditing(null);
            await onChanged();
          }}
        />
      </Modal>

      <Modal
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete program"
        description="This cannot be undone."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setPendingDelete(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete} isLoading={deleting}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-navy-600">
          Delete <span className="font-medium">{pendingDelete?.name}</span>?
        </p>
      </Modal>
    </Card>
  );
}

function ProgramForm({
  program,
  organizationId,
  onSaved,
  onCancel,
}: {
  program?: Tables<"programs">;
  organizationId: string | null;
  onSaved: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const isEdit = Boolean(program);
  const [name, setName] = useState(program?.name ?? "");
  const [description, setDescription] = useState(program?.description ?? "");
  const [budget, setBudget] = useState(
    program?.budget != null ? String(program.budget) : "",
  );
  const [beneficiaries, setBeneficiaries] = useState(
    program?.beneficiaries_served != null
      ? String(program.beneficiaries_served)
      : "",
  );
  const [startDate, setStartDate] = useState(program?.start_date ?? "");
  const [status, setStatus] = useState(program?.status ?? "active");
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNameError(null);
    if (!isNonEmpty(name)) {
      setNameError("Program name is required.");
      return;
    }

    const budgetNum = budget.trim() ? Number(budget) : null;
    if (budgetNum != null && Number.isNaN(budgetNum)) {
      setError("Budget must be a number.");
      return;
    }
    const beneficiariesNum = beneficiaries.trim()
      ? Number(beneficiaries)
      : null;
    if (beneficiariesNum != null && Number.isNaN(beneficiariesNum)) {
      setError("Beneficiaries served must be a number.");
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      budget: budgetNum,
      beneficiaries_served: beneficiariesNum,
      start_date: startDate.trim() || null,
      status,
    };

    if (isEdit && program) {
      const { error: updateError } = await supabase
        .from("programs")
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq("id", program.id);
      setSaving(false);
      if (updateError) {
        setError(updateError.message);
        return;
      }
      await onSaved();
      return;
    }

    if (!organizationId) {
      setSaving(false);
      setError("Your session could not be verified.");
      return;
    }
    const { error: insertError } = await supabase
      .from("programs")
      .insert({ ...payload, organization_id: organizationId });
    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    await onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}
      <Input
        label="Program name"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={nameError ?? undefined}
      />
      <Textarea
        label="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
      />
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Input
          label="Budget (USD)"
          type="number"
          min={0}
          step="100"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
        />
        <Input
          label="Beneficiaries served"
          type="number"
          min={0}
          value={beneficiaries}
          onChange={(e) => setBeneficiaries(e.target.value)}
        />
        <Input
          label="Start date"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
        <Select
          label="Status"
          options={PROGRAM_STATUS_OPTIONS}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        />
      </div>
      <div className="flex items-center justify-end gap-3 border-t border-navy-200 pt-5">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" isLoading={saving}>
          {isEdit ? "Save changes" : "Add program"}
        </Button>
      </div>
    </form>
  );
}
