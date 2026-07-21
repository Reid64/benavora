/** Masks a donor's full name for display, keeping the first name and last initial. */
export function maskDonorName(name: string | null | undefined): string {
  if (!name || !name.trim()) return "Anonymous";
  const parts = name.trim().split(/\s+/);
  const first = parts[0] ?? "";
  if (parts.length === 1) {
    return first.length <= 1 ? `${first}.` : `${first[0]}${"*".repeat(first.length - 1)}`;
  }
  const last = parts[parts.length - 1] ?? "";
  const lastInitial = last[0]?.toUpperCase() ?? "";
  return `${first} ${lastInitial}.`;
}
