"use client";

import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import {
  AlertTriangle,
  Building2,
  Check,
  CheckCircle2,
  ClipboardList,
  FileUp,
  Loader2,
  ShieldCheck,
  Trash2,
  User,
} from "lucide-react";

import { Button, Input, Select, Textarea } from "@/components/ui";

const FOREST_GREEN = "#3D6B50";
const GOLD = "#C49A4F";

const DRAFT_STORAGE_KEY = "google-nonprofit-application-draft";

type OrgInfo = {
  legalName: string;
  dba: string;
  registrationNumber: string;
  country: string;
  mission: string;
  website: string;
  phone: string;
  email: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
};

type Eligibility = {
  orgType: string;
  isGovernmentEntity: boolean;
  isHospital: boolean;
  isSchool: boolean;
  agreesToTerms: boolean;
};

type ContactInfo = {
  fullName: string;
  role: string;
  email: string;
  phone: string;
};

type Draft = {
  step: number;
  orgInfo: OrgInfo;
  eligibility: Eligibility;
  contact: ContactInfo;
};

const DEFAULT_ORG_INFO: OrgInfo = {
  legalName: "",
  dba: "",
  registrationNumber: "",
  country: "",
  mission: "",
  website: "",
  phone: "",
  email: "",
  addressLine1: "",
  city: "",
  state: "",
  postalCode: "",
};

const DEFAULT_ELIGIBILITY: Eligibility = {
  orgType: "",
  isGovernmentEntity: false,
  isHospital: false,
  isSchool: false,
  agreesToTerms: false,
};

const DEFAULT_CONTACT: ContactInfo = {
  fullName: "",
  role: "",
  email: "",
  phone: "",
};

const ORG_TYPE_OPTIONS = [
  { label: "501(c)(3) nonprofit (US)", value: "501c3" },
  { label: "Registered charity (non-US)", value: "registered-charity" },
  { label: "Other registered nonprofit", value: "other" },
];

const STEPS = [
  { title: "Organization Info", icon: Building2 },
  { title: "Eligibility", icon: ShieldCheck },
  { title: "Documents", icon: FileUp },
  { title: "Contact", icon: User },
  { title: "Review", icon: ClipboardList },
] as const;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function loadDraft(): Draft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Draft;
  } catch {
    return null;
  }
}

type FileSlotProps = {
  label: string;
  hint: string;
  file: File | null;
  onChange: (file: File | null) => void;
  required?: boolean;
};

function FileSlot({ label, hint, file, onChange, required }: FileSlotProps) {
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    onChange(event.target.files?.[0] ?? null);
    event.target.value = "";
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-surface p-4">
      <p className="text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </p>
      <p className="mt-0.5 text-xs text-slate-500">{hint}</p>

      {file ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm text-slate-700">{file.name}</p>
            <p className="text-xs text-slate-400">{formatBytes(file.size)}</p>
          </div>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="shrink-0 rounded-md p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
            aria-label={`Remove ${label}`}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : (
        <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-4 text-sm text-slate-500 transition hover:border-[#3D6B50] hover:text-[#3D6B50]">
          <FileUp className="h-4 w-4" aria-hidden />
          Choose file
          <input type="file" className="sr-only" onChange={handleChange} />
        </label>
      )}
    </div>
  );
}

export type GoogleNonprofitFormProps = {
  /** Called after a successful submission with the response JSON. */
  onSubmitted?: (result: unknown) => void;
};

/**
 * Multi-step application form for the Google for Nonprofits program.
 * Persists text-field progress to localStorage (files can't be serialized
 * and must be re-attached if the page reloads) and submits everything,
 * including documents, to POST /api/google-nonprofit/apply as multipart form data.
 */
export default function GoogleNonprofitForm({
  onSubmitted,
}: GoogleNonprofitFormProps) {
  const [step, setStep] = useState(0);
  const [orgInfo, setOrgInfo] = useState<OrgInfo>(DEFAULT_ORG_INFO);
  const [eligibility, setEligibility] = useState<Eligibility>(
    DEFAULT_ELIGIBILITY,
  );
  const [contact, setContact] = useState<ContactInfo>(DEFAULT_CONTACT);

  const [registrationDoc, setRegistrationDoc] = useState<File | null>(null);
  const [affiliationDoc, setAffiliationDoc] = useState<File | null>(null);
  const [additionalDocs, setAdditionalDocs] = useState<File[]>([]);

  const [hydrated, setHydrated] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // Restore any saved draft after mount so server and first client render match.
  useEffect(() => {
    const draft = loadDraft();
    if (draft) {
      setStep(draft.step ?? 0);
      setOrgInfo({ ...DEFAULT_ORG_INFO, ...draft.orgInfo });
      setEligibility({ ...DEFAULT_ELIGIBILITY, ...draft.eligibility });
      setContact({ ...DEFAULT_CONTACT, ...draft.contact });
    }
    setHydrated(true);
  }, []);

  // Persist progress on every change once the initial draft has loaded.
  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    const draft: Draft = { step, orgInfo, eligibility, contact };
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  }, [hydrated, step, orgInfo, eligibility, contact]);

  const showIneligibilityWarning =
    eligibility.isGovernmentEntity ||
    eligibility.isHospital ||
    eligibility.isSchool;

  const canProceed = useMemo(() => {
    switch (step) {
      case 0:
        return Boolean(
          orgInfo.legalName &&
            orgInfo.registrationNumber &&
            orgInfo.country &&
            orgInfo.mission &&
            orgInfo.email,
        );
      case 1:
        return Boolean(eligibility.orgType && eligibility.agreesToTerms);
      case 2:
        return Boolean(registrationDoc && affiliationDoc);
      case 3:
        return Boolean(contact.fullName && contact.role && contact.email);
      default:
        return true;
    }
  }, [step, orgInfo, eligibility, registrationDoc, affiliationDoc, contact]);

  const isLast = step === STEPS.length - 1;

  function goNext() {
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function goBack() {
    setStep((s) => Math.max(s - 1, 0));
  }

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);

    try {
      const formData = new FormData();
      formData.append("orgInfo", JSON.stringify(orgInfo));
      formData.append("eligibility", JSON.stringify(eligibility));
      formData.append("contact", JSON.stringify(contact));
      if (registrationDoc) {
        formData.append("registrationDocument", registrationDoc);
      }
      if (affiliationDoc) {
        formData.append("affiliationDocument", affiliationDoc);
      }
      additionalDocs.forEach((file) => {
        formData.append("additionalDocuments", file);
      });

      const res = await fetch("/api/google-nonprofit/apply", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          (body && typeof body === "object" && "error" in body
            ? String((body as { error: unknown }).error)
            : null) ?? `Submission failed (${res.status})`,
        );
      }

      const result: unknown = await res.json().catch(() => null);
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(DRAFT_STORAGE_KEY);
      }
      setSubmitted(true);
      onSubmitted?.(result);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Submission failed. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <div className="rounded-2xl border border-slate-200 bg-surface p-10 text-center shadow-sm">
          <span
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-md"
            style={{ backgroundColor: FOREST_GREEN }}
          >
            <CheckCircle2 className="h-7 w-7" aria-hidden />
          </span>
          <h1 className="mt-5 text-2xl font-bold tracking-tight text-slate-900">
            Application submitted
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
            Google routes verification through Goodstack, its third-party
            partner. Watch the email on file - including spam/junk - for a
            message from verifications@mail.goodstack.org, typically within
            3-14 business days.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      {/* Step indicator */}
      <div className="mb-8 flex items-center">
        {STEPS.map((s, i) => {
          const StepIcon = s.icon;
          const isActive = i === step;
          const isDone = i < step;
          return (
            <div key={s.title} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center gap-1.5">
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold transition-colors"
                  style={
                    isDone
                      ? { backgroundColor: FOREST_GREEN, borderColor: FOREST_GREEN, color: "white" }
                      : isActive
                        ? { borderColor: GOLD, color: GOLD, backgroundColor: "white" }
                        : { borderColor: "#E2E8F0", color: "#94A3B8", backgroundColor: "white" }
                  }
                >
                  {isDone ? (
                    <Check className="h-4 w-4" aria-hidden />
                  ) : (
                    <StepIcon className="h-4 w-4" aria-hidden />
                  )}
                </span>
                <span
                  className="hidden text-center text-[11px] font-medium sm:block"
                  style={{ color: isActive ? GOLD : isDone ? FOREST_GREEN : "#94A3B8" }}
                >
                  {s.title}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className="mx-2 h-0.5 flex-1"
                  style={{ backgroundColor: isDone ? FOREST_GREEN : "#E2E8F0" }}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm sm:p-8">
        <h2 className="text-xl font-bold tracking-tight text-slate-900">
          {STEPS[step]!.title}
        </h2>

        {/* Step 0: Organization Info */}
        {step === 0 && (
          <div className="mt-6 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Legal organization name"
                required
                value={orgInfo.legalName}
                onChange={(e) =>
                  setOrgInfo((s) => ({ ...s, legalName: e.target.value }))
                }
              />
              <Input
                label="Doing-business-as (DBA)"
                value={orgInfo.dba}
                onChange={(e) =>
                  setOrgInfo((s) => ({ ...s, dba: e.target.value }))
                }
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Registration / charity number"
                required
                value={orgInfo.registrationNumber}
                onChange={(e) =>
                  setOrgInfo((s) => ({
                    ...s,
                    registrationNumber: e.target.value,
                  }))
                }
                helperText="EIN or the equivalent for your country"
              />
              <Input
                label="Country of registration"
                required
                value={orgInfo.country}
                onChange={(e) =>
                  setOrgInfo((s) => ({ ...s, country: e.target.value }))
                }
              />
            </div>
            <Textarea
              label="Mission statement"
              required
              value={orgInfo.mission}
              onChange={(e) =>
                setOrgInfo((s) => ({ ...s, mission: e.target.value }))
              }
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Website"
                type="url"
                value={orgInfo.website}
                onChange={(e) =>
                  setOrgInfo((s) => ({ ...s, website: e.target.value }))
                }
              />
              <Input
                label="Phone"
                type="tel"
                value={orgInfo.phone}
                onChange={(e) =>
                  setOrgInfo((s) => ({ ...s, phone: e.target.value }))
                }
              />
            </div>
            <Input
              label="Organization email"
              type="email"
              required
              value={orgInfo.email}
              onChange={(e) =>
                setOrgInfo((s) => ({ ...s, email: e.target.value }))
              }
            />
            <Input
              label="Address"
              value={orgInfo.addressLine1}
              onChange={(e) =>
                setOrgInfo((s) => ({ ...s, addressLine1: e.target.value }))
              }
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <Input
                label="City"
                value={orgInfo.city}
                onChange={(e) =>
                  setOrgInfo((s) => ({ ...s, city: e.target.value }))
                }
              />
              <Input
                label="State / province"
                value={orgInfo.state}
                onChange={(e) =>
                  setOrgInfo((s) => ({ ...s, state: e.target.value }))
                }
              />
              <Input
                label="Postal code"
                value={orgInfo.postalCode}
                onChange={(e) =>
                  setOrgInfo((s) => ({ ...s, postalCode: e.target.value }))
                }
              />
            </div>
          </div>
        )}

        {/* Step 1: Eligibility */}
        {step === 1 && (
          <div className="mt-6 space-y-4">
            <Select
              label="Organization type"
              required
              placeholder="Select a type"
              options={ORG_TYPE_OPTIONS}
              value={eligibility.orgType}
              onChange={(e) =>
                setEligibility((s) => ({ ...s, orgType: e.target.value }))
              }
            />

            <div className="space-y-3 rounded-xl border border-slate-200 p-4">
              <p className="text-sm font-medium text-slate-700">
                Google explicitly excludes the following from eligibility -
                check any that apply to your organization
              </p>
              {(
                [
                  ["isGovernmentEntity", "Government entity or organization"],
                  ["isHospital", "Hospital or healthcare organization"],
                  ["isSchool", "School, academic institution, or university"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    style={{ accentColor: FOREST_GREEN }}
                    className="h-4 w-4 rounded border-slate-300"
                    checked={eligibility[key]}
                    onChange={(e) =>
                      setEligibility((s) => ({
                        ...s,
                        [key]: e.target.checked,
                      }))
                    }
                  />
                  {label}
                </label>
              ))}
            </div>

            {showIneligibilityWarning && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  Google&apos;s program page excludes these categories, though
                  affiliated fundraising or philanthropic arms (e.g. a
                  hospital foundation) can still qualify. Confirm your
                  specific structure before submitting.
                </span>
              </div>
            )}

            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                style={{ accentColor: FOREST_GREEN }}
                className="mt-0.5 h-4 w-4 rounded border-slate-300"
                checked={eligibility.agreesToTerms}
                onChange={(e) =>
                  setEligibility((s) => ({
                    ...s,
                    agreesToTerms: e.target.checked,
                  }))
                }
              />
              <span>
                I agree to the Google for Nonprofits Additional Terms of
                Service.
                <span className="ml-0.5 text-red-500">*</span>
              </span>
            </label>
          </div>
        )}

        {/* Step 2: Documents */}
        {step === 2 && (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-slate-500">
              Goodstack, Google&apos;s verification partner, typically asks
              for proof of nonprofit status and proof that you&apos;re
              authorized to represent the organization.
            </p>
            <FileSlot
              label="Legal registration / charity status document"
              hint="e.g. 501(c)(3) determination letter or government charity registry listing"
              file={registrationDoc}
              onChange={setRegistrationDoc}
              required
            />
            <FileSlot
              label="Proof of affiliation"
              hint="Document showing you're an authorized officer, staff member, or representative"
              file={affiliationDoc}
              onChange={setAffiliationDoc}
              required
            />

            <div className="rounded-xl border border-slate-200 bg-surface p-4">
              <p className="text-sm font-medium text-slate-700">
                Additional supporting documents
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                Optional - anything else Goodstack may request
              </p>

              <div className="mt-3 space-y-2">
                {additionalDocs.map((file, i) => (
                  <div
                    key={`${file.name}-${i}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-slate-700">
                        {file.name}
                      </p>
                      <p className="text-xs text-slate-400">
                        {formatBytes(file.size)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setAdditionalDocs((docs) =>
                          docs.filter((_, idx) => idx !== i),
                        )
                      }
                      className="shrink-0 rounded-md p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                      aria-label={`Remove ${file.name}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                ))}
              </div>

              <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-4 text-sm text-slate-500 transition hover:border-[#3D6B50] hover:text-[#3D6B50]">
                <FileUp className="h-4 w-4" aria-hidden />
                Add file
                <input
                  type="file"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) setAdditionalDocs((docs) => [...docs, file]);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
          </div>
        )}

        {/* Step 3: Contact */}
        {step === 3 && (
          <div className="mt-6 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Full name"
                required
                value={contact.fullName}
                onChange={(e) =>
                  setContact((s) => ({ ...s, fullName: e.target.value }))
                }
              />
              <Input
                label="Role / title"
                required
                value={contact.role}
                onChange={(e) =>
                  setContact((s) => ({ ...s, role: e.target.value }))
                }
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Email"
                type="email"
                required
                value={contact.email}
                onChange={(e) =>
                  setContact((s) => ({ ...s, email: e.target.value }))
                }
              />
              <Input
                label="Phone"
                type="tel"
                value={contact.phone}
                onChange={(e) =>
                  setContact((s) => ({ ...s, phone: e.target.value }))
                }
              />
            </div>
          </div>
        )}

        {/* Step 4: Review */}
        {step === 4 && (
          <div className="mt-6 space-y-6">
            <section>
              <h3 className="text-sm font-semibold" style={{ color: FOREST_GREEN }}>
                Organization
              </h3>
              <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm text-slate-700 sm:grid-cols-2">
                <ReviewRow label="Legal name" value={orgInfo.legalName} />
                <ReviewRow label="DBA" value={orgInfo.dba} />
                <ReviewRow
                  label="Registration #"
                  value={orgInfo.registrationNumber}
                />
                <ReviewRow label="Country" value={orgInfo.country} />
                <ReviewRow label="Email" value={orgInfo.email} />
                <ReviewRow label="Website" value={orgInfo.website} />
              </dl>
            </section>

            <section>
              <h3 className="text-sm font-semibold" style={{ color: FOREST_GREEN }}>
                Eligibility
              </h3>
              <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm text-slate-700 sm:grid-cols-2">
                <ReviewRow
                  label="Organization type"
                  value={
                    ORG_TYPE_OPTIONS.find((o) => o.value === eligibility.orgType)
                      ?.label ?? ""
                  }
                />
                <ReviewRow
                  label="Agreed to terms"
                  value={eligibility.agreesToTerms ? "Yes" : "No"}
                />
              </dl>
            </section>

            <section>
              <h3 className="text-sm font-semibold" style={{ color: FOREST_GREEN }}>
                Documents
              </h3>
              <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm text-slate-700 sm:grid-cols-2">
                <ReviewRow
                  label="Registration document"
                  value={registrationDoc?.name ?? "Not attached"}
                />
                <ReviewRow
                  label="Affiliation document"
                  value={affiliationDoc?.name ?? "Not attached"}
                />
                <ReviewRow
                  label="Additional documents"
                  value={String(additionalDocs.length)}
                />
              </dl>
            </section>

            <section>
              <h3 className="text-sm font-semibold" style={{ color: FOREST_GREEN }}>
                Contact
              </h3>
              <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm text-slate-700 sm:grid-cols-2">
                <ReviewRow label="Name" value={contact.fullName} />
                <ReviewRow label="Role" value={contact.role} />
                <ReviewRow label="Email" value={contact.email} />
                <ReviewRow label="Phone" value={contact.phone} />
              </dl>
            </section>

            {submitError && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>{submitError}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer navigation */}
      <div className="mt-6 flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          onClick={goBack}
          disabled={step === 0 || submitting}
        >
          Back
        </Button>

        {isLast ? (
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!canProceed || submitting}
            isLoading={submitting}
            className="bg-[#C49A4F] hover:bg-[#a97f3c]"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : null}
            Submit application
          </Button>
        ) : (
          <Button type="button" onClick={goNext} disabled={!canProceed}>
            Continue
          </Button>
        )}
      </div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-1">
      <dt className="text-slate-500">{label}</dt>
      <dd className="truncate text-right font-medium text-slate-900">
        {value || "-"}
      </dd>
    </div>
  );
}
