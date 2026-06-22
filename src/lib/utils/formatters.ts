import { format, formatDistanceToNow, isValid } from "date-fns";

/** Format a number as USD currency. Returns an em dash for null/undefined. */
export function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) {
    return "-";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Format a date (or ISO string) as e.g. "Jun 8, 2026". */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const date = typeof value === "string" ? new Date(value) : value;
  if (!isValid(date)) return "-";
  return format(date, "MMM d, yyyy");
}

/** Relative time, e.g. "3 days ago". */
export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const date = typeof value === "string" ? new Date(value) : value;
  if (!isValid(date)) return "-";
  return formatDistanceToNow(date, { addSuffix: true });
}

/** Decode HTML entities inserted by external APIs (e.g. &amp; → &, &#39; → '). */
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, dec: string) =>
      String.fromCharCode(parseInt(dec, 10)),
    );
}

/** Convert a snake_case enum value to a human label, e.g. "private_foundation" -> "Private Foundation". */
export function humanizeEnum(value: string | null | undefined): string {
  if (!value) return "-";
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
