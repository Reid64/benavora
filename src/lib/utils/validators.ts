import {
  ALLOWED_UPLOAD_EXTENSIONS,
  MAX_UPLOAD_BYTES,
} from "@/lib/utils/constants";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Basic email shape validation. */
export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/** True if a string is non-empty after trimming. */
export function isNonEmpty(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Validate an uploaded file against allowed type + size (Behavioral Contracts §7). */
export function validateUpload(file: {
  name: string;
  size: number;
}): { ok: true } | { ok: false; error: string } {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!(ALLOWED_UPLOAD_EXTENSIONS as readonly string[]).includes(ext)) {
    return { ok: false, error: `File type ".${ext}" is not allowed.` };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "File exceeds the 10 MB upload limit." };
  }
  return { ok: true };
}
