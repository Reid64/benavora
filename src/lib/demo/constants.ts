// Tailored demo (/demo) shared constants. Field set and role taxonomy come
// directly from BENAVORA MARKETING PAGE.docx section 6 ("The demo should be
// a deliverable" - exactly four fields before the calendar: work email,
// organization website, role, primary funding challenge) and section 14
// ("Build for multiple decision-makers" - the named personas below).

export const DEMO_ROLE_OPTIONS = [
  { value: "executive_director", label: "Executive Director" },
  { value: "development_director", label: "Development Director" },
  { value: "grant_writer", label: "Grant Writer" },
  { value: "cfo", label: "CFO" },
  { value: "it_security", label: "IT / Security" },
  { value: "board_member", label: "Board Member" },
  { value: "consultant", label: "Consultant" },
  { value: "other", label: "Other" },
] as const;

export const DEMO_ROLE_VALUES = DEMO_ROLE_OPTIONS.map((r) => r.value) as [string, ...string[]];
export type DemoRole = (typeof DEMO_ROLE_OPTIONS)[number]["value"];

export const DEMO_PREPARATION_ACTION_VALUES = ["proposal_upload", "opportunity_reference"] as [
  string,
  ...string[],
];
export type DemoPreparationAction = "proposal_upload" | "opportunity_reference";

/** Matches this repo's other public-storage bucket migrations (044, 140),
 * which don't rely on storage.buckets.file_size_limit - enforced here in the
 * API route instead. */
export const DEMO_PROPOSAL_MAX_BYTES = 15 * 1024 * 1024; // 15MB

export const DEMO_PROPOSAL_ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export const DEMO_PROPOSAL_ALLOWED_EXTENSIONS = [".pdf", ".doc", ".docx"] as const;
