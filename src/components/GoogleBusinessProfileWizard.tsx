"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import {
  Building2,
  Camera,
  Check,
  Clock,
  Download,
  Globe,
  Info,
  ListChecks,
  Loader2,
  MapPin,
  Phone,
  Plus,
  ShieldCheck,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { Button, Input, Select, Textarea } from "@/components/ui";
import knowledgeBase from "@/lib/google-nonprofit/research/knowledge-base.json";

const FOREST_GREEN = "#3D6B50";
const GOLD = "#C49A4F";

const DRAFT_STORAGE_KEY = "google-business-profile-wizard-draft";

const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

type DayHours = {
  day: (typeof DAYS)[number];
  closed: boolean;
  open: string;
  close: string;
};

const DEFAULT_HOURS: DayHours[] = DAYS.map((day) => ({
  day,
  closed: day === "Saturday" || day === "Sunday",
  open: "09:00",
  close: "17:00",
}));

type ProfileBasics = {
  orgName: string;
  category: string;
  hasPhysicalAddress: boolean;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  serviceArea: string;
  phone: string;
  website: string;
  hours: DayHours[];
};

type PhotoAsset = {
  id: string;
  name: string;
  url: string;
};

type PhotosDescription = {
  description: string;
};

type ServiceEntry = {
  name: string;
  description: string;
};

type ServicesInfo = {
  secondaryCategories: string[];
  services: ServiceEntry[];
  attributes: string[];
};

type VerificationInfo = {
  method: string;
  managers: string[];
  agreesToGuidelines: boolean;
};

type Draft = {
  step: number;
  profileBasics: ProfileBasics;
  photosDescription: PhotosDescription;
  servicesInfo: ServicesInfo;
  verificationInfo: VerificationInfo;
};

const DEFAULT_PROFILE_BASICS: ProfileBasics = {
  orgName: "",
  category: "",
  hasPhysicalAddress: true,
  addressLine1: "",
  city: "",
  state: "",
  postalCode: "",
  serviceArea: "",
  phone: "",
  website: "",
  hours: DEFAULT_HOURS,
};

const DEFAULT_PHOTOS_DESCRIPTION: PhotosDescription = { description: "" };

const DEFAULT_SERVICES_INFO: ServicesInfo = {
  secondaryCategories: [],
  services: [],
  attributes: [],
};

const DEFAULT_VERIFICATION_INFO: VerificationInfo = {
  method: "",
  managers: [],
  agreesToGuidelines: false,
};

const CATEGORY_OPTIONS = [
  { label: "Non-profit organization", value: "Non-profit organization" },
  { label: "Charity", value: "Charity" },
  { label: "Food bank", value: "Food bank" },
  { label: "Homeless shelter", value: "Homeless shelter" },
  { label: "Social services organization", value: "Social services organization" },
  { label: "Youth organization", value: "Youth organization" },
  { label: "Community center", value: "Community center" },
  { label: "Religious organization", value: "Religious organization" },
  { label: "Educational program", value: "Educational program" },
  { label: "Other", value: "Other" },
];

const ATTRIBUTE_OPTIONS = [
  "Identifies as women-led",
  "Identifies as Black-owned",
  "Identifies as veteran-led",
  "LGBTQ+ friendly",
  "Wheelchair accessible entrance",
  "Online donations accepted",
  "Free Wi-Fi",
];

const VERIFICATION_METHOD_OPTIONS = [
  { label: "Phone", value: "Phone" },
  { label: "Email", value: "Email" },
  { label: "Text message", value: "Text" },
  { label: "Video call", value: "Video" },
  { label: "Postcard by mail", value: "Postcard" },
];

const STEPS = [
  { title: "Profile Basics", icon: Building2 },
  { title: "Photos and Description", icon: Camera },
  { title: "Services", icon: ListChecks },
  { title: "Verification", icon: ShieldCheck },
] as const;

type KbSection = { name: string; content: string; steps: string[]; tips: string[] };

const KB_SECTIONS: KbSection[] = (
  knowledgeBase as { sections: KbSection[] }
).sections;

function findKbEntries(keywords: RegExp, max: number): string[] {
  const all = KB_SECTIONS.flatMap((section) => [...section.tips, ...section.steps]);
  const seen = new Set<string>();
  const matches: string[] = [];
  for (const entry of all) {
    if (matches.length >= max) break;
    if (keywords.test(entry) && !seen.has(entry)) {
      seen.add(entry);
      matches.push(entry);
    }
  }
  return matches;
}

const STEP_TIPS: string[][] = [
  findKbEntries(/categor|address|service area|phone|name|claim|NAP|duplicate/i, 4),
  findKbEntries(/photo|description|watermark|file name|keyword/i, 4),
  findKbEntries(/attribute|service|Q&A|secondary categor/i, 4),
  findKbEntries(/verif|manager|messag|donate button/i, 4),
];

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

function todaysHours(hours: DayHours[]): DayHours {
  const jsDay = new Date().getDay(); // 0 = Sunday .. 6 = Saturday
  const index = jsDay === 0 ? 6 : jsDay - 1; // rotate to Monday-first
  return hours[index] ?? hours[0] ?? DEFAULT_HOURS[0]!;
}

function formatTime(value: string): string {
  const [hourStr, minuteStr] = value.split(":");
  const hour = Number(hourStr);
  if (!Number.isFinite(hour)) return value;
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${minuteStr ?? "00"} ${period}`;
}

function wrapText(
  text: string,
  maxW: number,
  font: { widthOfTextAtSize: (t: string, s: number) => number },
  size: number,
): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) > maxW && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function generateChecklistPdf(state: {
  profileBasics: ProfileBasics;
  photosDescription: PhotosDescription;
  photoCount: number;
  servicesInfo: ServicesInfo;
  verificationInfo: VerificationInfo;
}): Promise<Uint8Array> {
  const { profileBasics, photosDescription, photoCount, servicesInfo, verificationInfo } = state;

  const PAGE_W = 612;
  const PAGE_H = 792;
  const MARGIN = 50;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const LH = 15;

  const C_GREEN = rgb(0.24, 0.42, 0.31); // #3D6B50
  const C_GOLD = rgb(0.77, 0.6, 0.31); // #C49A4F
  const C_WHITE = rgb(1, 1, 1);
  const C_BLACK = rgb(0, 0, 0);
  const C_GRAY = rgb(0.4, 0.4, 0.4);
  const C_LIGHT_GRAY = rgb(0.75, 0.75, 0.75);
  const C_DARK_GRAY = rgb(0.2, 0.2, 0.2);

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  function newPage(): void {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  }

  function ensureSpace(min = 60): void {
    if (y < min) newPage();
  }

  function drawHRule(): void {
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_W - MARGIN, y },
      thickness: 0.5,
      color: C_LIGHT_GRAY,
    });
  }

  function drawText(
    content: string,
    opts: { x?: number; size?: number; useBold?: boolean; color?: ReturnType<typeof rgb> } = {},
  ): void {
    page.drawText(content, {
      x: opts.x ?? MARGIN,
      y,
      size: opts.size ?? 9,
      font: opts.useBold ? bold : font,
      color: opts.color ?? C_BLACK,
    });
  }

  function field(label: string, value: string | null | undefined): void {
    if (value == null || value === "") return;
    ensureSpace();
    drawText(label + ":", { useBold: true, color: C_GRAY });
    drawText(value, { x: MARGIN + 155 });
    y -= LH;
  }

  function sectionHead(title: string): void {
    ensureSpace(90);
    y -= 6;
    drawHRule();
    y -= 14;
    drawText(title, { useBold: true, size: 10, color: C_GREEN });
    y -= 16;
  }

  function checklistItem(text: string): void {
    const lines = wrapText(text, CONTENT_W - 20, font, 9);
    for (let i = 0; i < lines.length; i++) {
      ensureSpace();
      drawText(i === 0 ? `[ ] ${lines[i]}` : `    ${lines[i]}`, { color: C_DARK_GRAY });
      y -= LH;
    }
  }

  function bulletItem(text: string): void {
    const lines = wrapText(text, CONTENT_W - 14, font, 9);
    for (let i = 0; i < lines.length; i++) {
      ensureSpace();
      drawText(i === 0 ? `- ${lines[i]}` : `  ${lines[i]}`, { color: C_DARK_GRAY });
      y -= LH;
    }
  }

  // Header
  page.drawRectangle({ x: 0, y: PAGE_H - 85, width: PAGE_W, height: 85, color: C_GREEN });
  page.drawText("GOOGLE BUSINESS PROFILE CHECKLIST", {
    x: MARGIN,
    y: PAGE_H - 38,
    size: 18,
    font: bold,
    color: C_WHITE,
  });
  page.drawText(profileBasics.orgName || "Untitled organization", {
    x: MARGIN,
    y: PAGE_H - 57,
    size: 10,
    font: bold,
    color: C_WHITE,
  });
  page.drawText("Prepared with Benavora", {
    x: MARGIN,
    y: PAGE_H - 73,
    size: 8,
    font,
    color: C_GOLD,
  });
  y = PAGE_H - 100;

  // Profile details
  sectionHead("YOUR PROFILE DETAILS");
  field("Organization name", profileBasics.orgName);
  field("Primary category", profileBasics.category);
  field(
    "Location",
    profileBasics.hasPhysicalAddress
      ? [profileBasics.addressLine1, profileBasics.city, profileBasics.state, profileBasics.postalCode]
          .filter(Boolean)
          .join(", ")
      : profileBasics.serviceArea
        ? `Service area: ${profileBasics.serviceArea}`
        : null,
  );
  field("Phone", profileBasics.phone);
  field("Website", profileBasics.website);
  field(
    "Description",
    photosDescription.description
      ? `${photosDescription.description.length} / 750 characters written`
      : null,
  );
  field("Photos attached", photoCount > 0 ? String(photoCount) : null);
  field(
    "Secondary categories",
    servicesInfo.secondaryCategories.length
      ? servicesInfo.secondaryCategories.join(", ")
      : null,
  );
  field(
    "Services listed",
    servicesInfo.services.length ? String(servicesInfo.services.length) : null,
  );
  field("Verification method", verificationInfo.method || null);

  // Setup checklist pulled from the knowledge base
  const setupSection = KB_SECTIONS.find((s) => s.name === "Business Profile Setup");
  if (setupSection) {
    sectionHead("SETUP CHECKLIST (business.google.com)");
    for (const step of setupSection.steps) {
      checklistItem(step);
    }
  }

  // Optimization tips
  const optimizationSection = KB_SECTIONS.find((s) => s.name === "Optimization Tips");
  if (optimizationSection) {
    sectionHead("KEEP IN MIND");
    for (const tip of optimizationSection.tips) {
      bulletItem(tip);
    }
  }

  // Footer on the last page
  ensureSpace(60);
  y = 60;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_W - MARGIN, y },
    thickness: 0.5,
    color: C_LIGHT_GRAY,
  });
  page.drawText(
    `Generated by Benavora on ${new Date().toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })}`,
    { x: MARGIN, y: y - 16, size: 7, font, color: C_GRAY },
  );

  return pdfDoc.save();
}

function TagListEditor({
  label,
  placeholder,
  values,
  onChange,
}: {
  label: string;
  placeholder: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const trimmed = draft.trim();
    if (!trimmed || values.includes(trimmed)) return;
    onChange([...values, trimmed]);
    setDraft("");
  }

  return (
    <div>
      <p className="mb-1.5 block text-sm font-medium text-slate-700">{label}</p>
      <div className="flex gap-2">
        <Input
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="secondary" onClick={add}>
          <Plus className="h-4 w-4" aria-hidden />
          Add
        </Button>
      </div>
      {values.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {values.map((value) => (
            <span
              key={value}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 py-1 pl-3 pr-2 text-xs font-medium text-slate-700"
            >
              {value}
              <button
                type="button"
                onClick={() => onChange(values.filter((v) => v !== value))}
                className="rounded-full p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                aria-label={`Remove ${value}`}
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function TipsPanel({ tips }: { tips: string[] }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-surface p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <Info className="h-4 w-4" style={{ color: GOLD }} aria-hidden />
        <h3 className="text-sm font-semibold text-slate-900">Tips for this step</h3>
      </div>
      <p className="mt-0.5 text-xs text-slate-400">From the Google Business Profile knowledge base</p>
      <ul className="mt-3 space-y-2.5">
        {tips.map((tip) => (
          <li key={tip} className="flex gap-2 text-xs leading-relaxed text-slate-600">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full" style={{ backgroundColor: GOLD }} />
            {tip}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProfilePreview({
  profileBasics,
  description,
  photos,
  servicesInfo,
  verificationInfo,
}: {
  profileBasics: ProfileBasics;
  description: string;
  photos: PhotoAsset[];
  servicesInfo: ServicesInfo;
  verificationInfo: VerificationInfo;
}) {
  const today = todaysHours(profileBasics.hours);
  const isVerified = verificationInfo.method !== "" && verificationInfo.agreesToGuidelines;

  return (
    <div className="rounded-2xl border border-slate-200 bg-surface p-5 shadow-sm">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">
        Live preview
      </p>

      <div className="flex items-start gap-3">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white"
          style={{ backgroundColor: FOREST_GREEN }}
        >
          <Building2 className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate text-base font-bold text-slate-900">
            {profileBasics.orgName || "Your organization name"}
          </p>
          <p className="truncate text-xs text-slate-500">
            {profileBasics.category || "Business category"}
          </p>
          <div className="mt-1 flex items-center gap-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star key={i} className="h-3 w-3 text-slate-300" aria-hidden />
            ))}
            <span className="ml-1 text-[11px] text-slate-400">New listing</span>
          </div>
        </div>
      </div>

      {photos.length > 0 ? (
        <div className="mt-3 flex gap-2 overflow-x-auto">
          {photos.slice(0, 4).map((photo) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={photo.id}
              src={photo.url}
              alt={photo.name}
              className="h-16 w-16 shrink-0 rounded-lg border border-slate-200 object-cover"
            />
          ))}
          {photos.length > 4 && (
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-500">
              +{photos.length - 4}
            </span>
          )}
        </div>
      ) : (
        <div className="mt-3 flex h-16 items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-400">
          No photos yet
        </div>
      )}

      {description && (
        <p className="mt-3 line-clamp-3 text-xs leading-relaxed text-slate-600">{description}</p>
      )}

      <dl className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 text-xs text-slate-600">
        <div className="flex items-center gap-2">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
          <span className="truncate">
            {profileBasics.hasPhysicalAddress
              ? [profileBasics.addressLine1, profileBasics.city, profileBasics.state]
                  .filter(Boolean)
                  .join(", ") || "Address not set"
              : profileBasics.serviceArea || "Service area not set"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Phone className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
          <span className="truncate">{profileBasics.phone || "Phone not set"}</span>
        </div>
        <div className="flex items-center gap-2">
          <Globe className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
          <span className="truncate">{profileBasics.website || "Website not set"}</span>
        </div>
        <div className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
          <span className="truncate">
            {today.closed ? `Closed today (${today.day})` : `Open today ${formatTime(today.open)} - ${formatTime(today.close)}`}
          </span>
        </div>
      </dl>

      {servicesInfo.attributes.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
          {servicesInfo.attributes.map((attr) => (
            <span
              key={attr}
              className="rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{ backgroundColor: "#F2E9D8", color: "#8A6A2F" }}
            >
              {attr}
            </span>
          ))}
        </div>
      )}

      {servicesInfo.services.length > 0 && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="text-[11px] font-semibold text-slate-500">Services</p>
          <ul className="mt-1 space-y-0.5">
            {servicesInfo.services.slice(0, 4).map((service) => (
              <li key={service.name} className="truncate text-xs text-slate-600">
                {service.name}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 flex items-center gap-1.5 border-t border-slate-100 pt-3 text-xs font-medium">
        <ShieldCheck
          className="h-3.5 w-3.5"
          style={{ color: isVerified ? FOREST_GREEN : "#CBD5E1" }}
          aria-hidden
        />
        <span style={{ color: isVerified ? FOREST_GREEN : "#94A3B8" }}>
          {isVerified ? `Verification: ${verificationInfo.method}` : "Not yet verified"}
        </span>
      </div>
    </div>
  );
}

export type GoogleBusinessProfileWizardProps = {
  /** Called after the checklist PDF has been generated and downloaded. */
  onChecklistDownloaded?: () => void;
};

export default function GoogleBusinessProfileWizard({
  onChecklistDownloaded,
}: GoogleBusinessProfileWizardProps) {
  const [step, setStep] = useState(0);
  const [profileBasics, setProfileBasics] = useState<ProfileBasics>(DEFAULT_PROFILE_BASICS);
  const [photosDescription, setPhotosDescription] = useState<PhotosDescription>(
    DEFAULT_PHOTOS_DESCRIPTION,
  );
  const [photos, setPhotos] = useState<PhotoAsset[]>([]);
  const [servicesInfo, setServicesInfo] = useState<ServicesInfo>(DEFAULT_SERVICES_INFO);
  const [verificationInfo, setVerificationInfo] = useState<VerificationInfo>(
    DEFAULT_VERIFICATION_INFO,
  );

  const [hydrated, setHydrated] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfDownloaded, setPdfDownloaded] = useState(false);

  const photosRef = useRef(photos);
  photosRef.current = photos;

  // Restore any saved draft after mount so server and first client render match.
  useEffect(() => {
    const draft = loadDraft();
    if (draft) {
      setStep(draft.step ?? 0);
      setProfileBasics({ ...DEFAULT_PROFILE_BASICS, ...draft.profileBasics });
      setPhotosDescription({ ...DEFAULT_PHOTOS_DESCRIPTION, ...draft.photosDescription });
      setServicesInfo({ ...DEFAULT_SERVICES_INFO, ...draft.servicesInfo });
      setVerificationInfo({ ...DEFAULT_VERIFICATION_INFO, ...draft.verificationInfo });
    }
    setHydrated(true);
  }, []);

  // Persist progress on every change once the initial draft has loaded.
  // Photos are object URLs backed by in-memory Files and can't be serialized,
  // so they must be re-attached after a reload, same as file uploads elsewhere.
  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    const draft: Draft = { step, profileBasics, photosDescription, servicesInfo, verificationInfo };
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  }, [hydrated, step, profileBasics, photosDescription, servicesInfo, verificationInfo]);

  // Revoke object URLs on unmount to avoid leaking memory.
  useEffect(() => {
    return () => {
      for (const photo of photosRef.current) {
        URL.revokeObjectURL(photo.url);
      }
    };
  }, []);

  function handlePhotoUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!files) return;
    const next: PhotoAsset[] = Array.from(files).map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}`,
      name: file.name,
      url: URL.createObjectURL(file),
    }));
    setPhotos((current) => [...current, ...next]);
    event.target.value = "";
  }

  function removePhoto(id: string) {
    setPhotos((current) => {
      const target = current.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return current.filter((p) => p.id !== id);
    });
  }

  function updateHour(day: (typeof DAYS)[number], patch: Partial<DayHours>) {
    setProfileBasics((s) => ({
      ...s,
      hours: s.hours.map((h) => (h.day === day ? { ...h, ...patch } : h)),
    }));
  }

  function toggleAttribute(attr: string) {
    setServicesInfo((s) => ({
      ...s,
      attributes: s.attributes.includes(attr)
        ? s.attributes.filter((a) => a !== attr)
        : [...s.attributes, attr],
    }));
  }

  function addService() {
    setServicesInfo((s) => ({
      ...s,
      services: [...s.services, { name: "", description: "" }],
    }));
  }

  function updateService(index: number, patch: Partial<ServiceEntry>) {
    setServicesInfo((s) => ({
      ...s,
      services: s.services.map((svc, i) => (i === index ? { ...svc, ...patch } : svc)),
    }));
  }

  function removeService(index: number) {
    setServicesInfo((s) => ({
      ...s,
      services: s.services.filter((_, i) => i !== index),
    }));
  }

  const canProceed = useMemo(() => {
    switch (step) {
      case 0:
        return Boolean(
          profileBasics.orgName &&
            profileBasics.category &&
            profileBasics.phone &&
            (profileBasics.hasPhysicalAddress
              ? profileBasics.addressLine1 && profileBasics.city
              : profileBasics.serviceArea),
        );
      case 1:
        return Boolean(photosDescription.description.trim());
      case 2:
        return true;
      case 3:
        return Boolean(verificationInfo.method && verificationInfo.agreesToGuidelines);
      default:
        return true;
    }
  }, [step, profileBasics, photosDescription, verificationInfo]);

  const isLast = step === STEPS.length - 1;

  function goNext() {
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function goBack() {
    setStep((s) => Math.max(s - 1, 0));
  }

  async function handleDownloadChecklist() {
    setGeneratingPdf(true);
    setPdfError(null);
    try {
      const pdfBytes = await generateChecklistPdf({
        profileBasics,
        photosDescription,
        photoCount: photos.length,
        servicesInfo,
        verificationInfo,
      });
      const blob = new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const filename = `google-business-profile-checklist${
        profileBasics.orgName ? `-${profileBasics.orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : ""
      }.pdf`;
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setPdfDownloaded(true);
      onChecklistDownloaded?.();
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : "Could not generate the checklist PDF.");
    } finally {
      setGeneratingPdf(false);
    }
  }

  const tips = STEP_TIPS[step] ?? [];

  return (
    <div className="mx-auto w-full max-w-6xl">
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
                  {isDone ? <Check className="h-4 w-4" aria-hidden /> : <StepIcon className="h-4 w-4" aria-hidden />}
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm sm:p-8">
          <h2 className="text-xl font-bold tracking-tight text-slate-900">{STEPS[step]!.title}</h2>

          {/* Step 0: Profile Basics */}
          {step === 0 && (
            <div className="mt-6 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Organization name"
                  required
                  value={profileBasics.orgName}
                  onChange={(e) => setProfileBasics((s) => ({ ...s, orgName: e.target.value }))}
                  helperText="Use the exact name from your website and official materials"
                />
                <Select
                  label="Primary category"
                  required
                  placeholder="Select a category"
                  options={CATEGORY_OPTIONS}
                  value={profileBasics.category}
                  onChange={(e) => setProfileBasics((s) => ({ ...s, category: e.target.value }))}
                />
              </div>

              <div className="space-y-3 rounded-xl border border-slate-200 p-4">
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="location-type"
                      style={{ accentColor: FOREST_GREEN }}
                      checked={profileBasics.hasPhysicalAddress}
                      onChange={() => setProfileBasics((s) => ({ ...s, hasPhysicalAddress: true }))}
                    />
                    Visitors come to a physical address
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="location-type"
                      style={{ accentColor: FOREST_GREEN }}
                      checked={!profileBasics.hasPhysicalAddress}
                      onChange={() => setProfileBasics((s) => ({ ...s, hasPhysicalAddress: false }))}
                    />
                    I deliver goods and services to a service area
                  </label>
                </div>

                {profileBasics.hasPhysicalAddress ? (
                  <div className="space-y-3">
                    <Input
                      label="Address"
                      required
                      value={profileBasics.addressLine1}
                      onChange={(e) => setProfileBasics((s) => ({ ...s, addressLine1: e.target.value }))}
                    />
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Input
                        label="City"
                        required
                        value={profileBasics.city}
                        onChange={(e) => setProfileBasics((s) => ({ ...s, city: e.target.value }))}
                      />
                      <Input
                        label="State / province"
                        value={profileBasics.state}
                        onChange={(e) => setProfileBasics((s) => ({ ...s, state: e.target.value }))}
                      />
                      <Input
                        label="Postal code"
                        value={profileBasics.postalCode}
                        onChange={(e) => setProfileBasics((s) => ({ ...s, postalCode: e.target.value }))}
                      />
                    </div>
                  </div>
                ) : (
                  <Input
                    label="Service area"
                    required
                    placeholder="e.g. San Francisco Bay Area"
                    value={profileBasics.serviceArea}
                    onChange={(e) => setProfileBasics((s) => ({ ...s, serviceArea: e.target.value }))}
                  />
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Phone"
                  type="tel"
                  required
                  value={profileBasics.phone}
                  onChange={(e) => setProfileBasics((s) => ({ ...s, phone: e.target.value }))}
                />
                <Input
                  label="Website"
                  type="url"
                  value={profileBasics.website}
                  onChange={(e) => setProfileBasics((s) => ({ ...s, website: e.target.value }))}
                />
              </div>

              <div>
                <p className="mb-2 text-sm font-medium text-slate-700">Hours of operation</p>
                <div className="space-y-2 rounded-xl border border-slate-200 p-4">
                  {profileBasics.hours.map((h) => (
                    <div key={h.day} className="flex flex-wrap items-center gap-3">
                      <label className="flex w-32 items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          style={{ accentColor: FOREST_GREEN }}
                          className="h-4 w-4 rounded border-slate-300"
                          checked={!h.closed}
                          onChange={(e) => updateHour(h.day, { closed: !e.target.checked })}
                        />
                        {h.day}
                      </label>
                      {h.closed ? (
                        <span className="text-xs text-slate-400">Closed</span>
                      ) : (
                        <div className="flex items-center gap-2 text-sm text-slate-600">
                          <input
                            type="time"
                            value={h.open}
                            onChange={(e) => updateHour(h.day, { open: e.target.value })}
                            className="rounded-md border border-slate-200 bg-surface px-2 py-1 text-xs"
                          />
                          <span>to</span>
                          <input
                            type="time"
                            value={h.close}
                            onChange={(e) => updateHour(h.day, { close: e.target.value })}
                            className="rounded-md border border-slate-200 bg-surface px-2 py-1 text-xs"
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 1: Photos and Description */}
          {step === 1 && (
            <div className="mt-6 space-y-4">
              <Textarea
                label="Business description"
                required
                rows={5}
                maxLength={750}
                value={photosDescription.description}
                onChange={(e) =>
                  setPhotosDescription({ description: e.target.value.slice(0, 750) })
                }
                helperText={`${photosDescription.description.length} / 750 characters — cover the mission, who you serve, and what makes you distinct`}
              />

              <div className="rounded-xl border border-slate-200 bg-surface p-4">
                <p className="text-sm font-medium text-slate-700">Photos</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Logo, cover photo, interior/exterior, and team or volunteers at work
                </p>

                {photos.length > 0 && (
                  <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4">
                    {photos.map((photo) => (
                      <div key={photo.id} className="group relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={photo.url}
                          alt={photo.name}
                          className="h-20 w-full rounded-lg border border-slate-200 object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => removePhoto(photo.id)}
                          className="absolute right-1 top-1 rounded-md bg-white/90 p-1 text-slate-500 opacity-0 shadow-sm transition group-hover:opacity-100 hover:text-red-600"
                          aria-label={`Remove ${photo.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-4 text-sm text-slate-500 transition hover:border-[#3D6B50] hover:text-[#3D6B50]">
                  <Camera className="h-4 w-4" aria-hidden />
                  Add photos
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="sr-only"
                    onChange={handlePhotoUpload}
                  />
                </label>
              </div>
            </div>
          )}

          {/* Step 2: Services */}
          {step === 2 && (
            <div className="mt-6 space-y-4">
              <TagListEditor
                label="Secondary categories"
                placeholder="e.g. Social services organization"
                values={servicesInfo.secondaryCategories}
                onChange={(values) => setServicesInfo((s) => ({ ...s, secondaryCategories: values }))}
              />

              <div>
                <p className="mb-2 text-sm font-medium text-slate-700">Services and programs</p>
                <div className="space-y-3">
                  {servicesInfo.services.map((service, i) => (
                    <div
                      key={i}
                      className="grid gap-3 rounded-xl border border-slate-200 p-4 sm:grid-cols-[1fr_2fr_auto]"
                    >
                      <Input
                        placeholder="Service name"
                        value={service.name}
                        onChange={(e) => updateService(i, { name: e.target.value })}
                      />
                      <Input
                        placeholder="Short description"
                        value={service.description}
                        onChange={(e) => updateService(i, { description: e.target.value })}
                      />
                      <button
                        type="button"
                        onClick={() => removeService(i)}
                        className="shrink-0 rounded-md p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                        aria-label={`Remove ${service.name || "service"}`}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  ))}
                </div>
                <Button type="button" variant="secondary" className="mt-3" onClick={addService}>
                  <Plus className="h-4 w-4" aria-hidden />
                  Add service
                </Button>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium text-slate-700">Attributes</p>
                <div className="grid gap-2 rounded-xl border border-slate-200 p-4 sm:grid-cols-2">
                  {ATTRIBUTE_OPTIONS.map((attr) => (
                    <label key={attr} className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        style={{ accentColor: FOREST_GREEN }}
                        className="h-4 w-4 rounded border-slate-300"
                        checked={servicesInfo.attributes.includes(attr)}
                        onChange={() => toggleAttribute(attr)}
                      />
                      {attr}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Verification */}
          {step === 3 && (
            <div className="mt-6 space-y-4">
              <Select
                label="Verification method"
                required
                placeholder="Select a method"
                options={VERIFICATION_METHOD_OPTIONS}
                value={verificationInfo.method}
                onChange={(e) => setVerificationInfo((s) => ({ ...s, method: e.target.value }))}
                helperText="The profile isn't publicly visible on Search or Maps until verification completes"
              />

              <TagListEditor
                label="Profile managers"
                placeholder="teammate@yourorg.org"
                values={verificationInfo.managers}
                onChange={(values) => setVerificationInfo((s) => ({ ...s, managers: values }))}
              />

              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  style={{ accentColor: FOREST_GREEN }}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300"
                  checked={verificationInfo.agreesToGuidelines}
                  onChange={(e) =>
                    setVerificationInfo((s) => ({ ...s, agreesToGuidelines: e.target.checked }))
                  }
                />
                <span>
                  I agree to follow Google Business Profile&apos;s content and review guidelines.
                  <span className="ml-0.5 text-red-500">*</span>
                </span>
              </label>

              {pdfError && (
                <p className="text-sm text-red-600">{pdfError}</p>
              )}

              {pdfDownloaded && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                  <Check className="h-4 w-4 shrink-0" aria-hidden />
                  Checklist downloaded. Follow it on business.google.com to finish setup.
                </div>
              )}

              <Button
                type="button"
                onClick={handleDownloadChecklist}
                isLoading={generatingPdf}
                className="bg-[#C49A4F] hover:bg-[#a97f3c]"
              >
                {generatingPdf ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Download className="h-4 w-4" aria-hidden />
                )}
                Download checklist PDF
              </Button>
            </div>
          )}
        </div>

        {/* Sidebar: live preview + tips */}
        <div className="space-y-6">
          <ProfilePreview
            profileBasics={profileBasics}
            description={photosDescription.description}
            photos={photos}
            servicesInfo={servicesInfo}
            verificationInfo={verificationInfo}
          />
          <TipsPanel tips={tips} />
        </div>
      </div>

      {/* Footer navigation */}
      <div className="mt-6 flex items-center justify-between gap-3">
        <Button type="button" variant="ghost" onClick={goBack} disabled={step === 0}>
          Back
        </Button>

        {!isLast && (
          <Button type="button" onClick={goNext} disabled={!canProceed}>
            Continue
          </Button>
        )}
      </div>
    </div>
  );
}
