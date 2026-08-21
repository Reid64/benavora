// Pure guard logic for scripts/seed-foundation-prospects.ts (WGR-156). Split
// out from the script itself so it's testable without a live DB connection
// (the script's main() makes real Supabase calls as soon as it's imported).

export const TEST_ORG_PATTERN = /benavora-test|Beta Org/i;
export const DEFAULT_SEED_LIMIT = 200;

export interface SeedCliArgs {
  orgId: string;
  allowRealOrg: boolean;
  limit: number;
}

export function parseSeedArgs(argv: string[], defaultOrgId: string): SeedCliArgs {
  let orgId = defaultOrgId;
  let allowRealOrg = false;
  let limit = DEFAULT_SEED_LIMIT;

  for (const arg of argv) {
    if (arg === "--allow-real-org") {
      allowRealOrg = true;
    } else if (arg.startsWith("--org-id=")) {
      orgId = arg.slice("--org-id=".length);
    } else if (arg.startsWith("--limit=")) {
      const parsed = Number(arg.slice("--limit=".length));
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`--limit must be a positive number, got "${arg}"`);
      }
      limit = parsed;
    }
  }

  return { orgId, allowRealOrg, limit };
}

export interface SeedOrgIdentity {
  name: string | null;
  email: string | null;
  contact_email: string | null;
}

/** True if the org's name/email/contact_email marks it as a test org. */
export function looksLikeTestOrg(org: SeedOrgIdentity): boolean {
  return (
    TEST_ORG_PATTERN.test(org.name ?? "") ||
    TEST_ORG_PATTERN.test(org.email ?? "") ||
    TEST_ORG_PATTERN.test(org.contact_email ?? "")
  );
}

/** True if the script should proceed seeding into this org. */
export function isAllowedToSeed(org: SeedOrgIdentity, allowRealOrg: boolean): boolean {
  return looksLikeTestOrg(org) || allowRealOrg;
}
