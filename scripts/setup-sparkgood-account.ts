// One-time guided setup for an org's Walmart Spark Good donor account.
//
// AutoApply's queue worker (worker/queue-processor.ts) can log a browser
// session into a portal and fill/submit a form, but it cannot click a link
// inside a human's inbox. Walmart's Spark Good signup gates a brand-new
// account behind a "Deed" email verification step — the worker hits that
// wall on every run and has nowhere to go from there (see
// handleLoginGating()'s `SkipError('awaiting_confirmation')`).
//
// This script runs that registration flow once, with a *visible* browser,
// and pauses so a human can open their email, click the Deed verification
// link, and hand control back. Once verified, the account + credentials are
// persisted (org_portal_accounts for verification state, funder_credentials
// via CredentialManager for the actual login secret) so every future
// AutoApply run against Walmart can log straight in instead of registering.
//
//   pnpm setup:sparkgood [organizationId]

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createAdminClient } from "@/lib/supabase/admin";
import { StealthBrowser } from "@/lib/autoapply/stealth-browser";
import { RegistrationAgent } from "@/lib/autoapply/registration-agent";
import { CredentialManager } from "@/lib/autoapply/credential-manager";

const FAITH_FOUNDATION_ORG_ID = "b1ab7402-dfc2-4712-869f-70ea3566cc1d";
const WALMART_PORTAL_URL = "https://www.walmart.com/nonprofits";
const PORTAL_TYPE = "walmart_sparkgood";

function fatal(message: string): never {
  console.error(`\nFATAL: ${message}`);
  process.exit(1);
}

/** Blocks until the human presses ENTER, then releases stdin so the process can exit normally. */
function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => {
      process.stdin.pause();
      resolve();
    });
  });
}

async function main(): Promise<void> {
  const organizationId = process.argv[2] ?? FAITH_FOUNDATION_ORG_ID;
  const supabase = createAdminClient();

  console.log(`Checking for an existing Walmart Spark Good account for org ${organizationId}...`);
  const { data: existingAccount, error: fetchError } = await supabase
    .from("org_portal_accounts")
    .select("id, account_email, deed_verified, deed_verified_at")
    .eq("organization_id", organizationId)
    .eq("portal_type", PORTAL_TYPE)
    .maybeSingle();
  if (fetchError) fatal(`org_portal_accounts lookup failed: ${fetchError.message}`);

  if (existingAccount && (existingAccount as { deed_verified: boolean }).deed_verified) {
    const acct = existingAccount as { account_email: string | null; deed_verified_at: string | null };
    console.log(
      `Already set up: ${acct.account_email ?? "(no email on file)"} was Deed-verified on ` +
        `${acct.deed_verified_at ?? "an unknown date"}. Nothing to do.`,
    );
    return;
  }

  console.log("Loading org profile to auto-fill the registration form...");
  const { data: orgData, error: orgError } = await supabase
    .from("organizations")
    .select("id, name, phone, email")
    .eq("id", organizationId)
    .maybeSingle();
  if (orgError) fatal(`Org lookup failed: ${orgError.message}`);
  if (!orgData) fatal(`No organization found with id ${organizationId}`);
  const org = orgData as { id: string; name: string; phone: string | null; email: string | null };

  const accountEmail = process.env["AUTOAPPLY_EMAIL"] ?? org.email;
  if (!accountEmail) {
    fatal(
      "Org has no contact email and AUTOAPPLY_EMAIL is not set — cannot register a Spark Good " +
        "account without an email to receive the Deed verification link.",
    );
  }

  console.log(`Org: ${org.name} (Spark Good account email: ${accountEmail})`);
  console.log("Launching a visible browser for guided Walmart Spark Good setup...");

  const stealthBrowser = new StealthBrowser({ headless: false });
  const { browser, page } = await stealthBrowser.launch();
  const registrationAgent = new RegistrationAgent();

  try {
    console.log(`Navigating to ${WALMART_PORTAL_URL}...`);
    await page.goto(WALMART_PORTAL_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });

    const regResult = await registrationAgent.register(page, {
      orgName: org.name,
      orgEmail: accountEmail,
      orgPhone: org.phone ?? "",
      contactName: org.name,
      contactEmail: accountEmail,
    });

    if (!regResult.success) {
      fatal(`Registration failed: ${regResult.error ?? "unknown error"}`);
    }

    if (regResult.confirmationRequired) {
      console.log(
        `\n\n=== ACTION REQUIRED ===\nCheck your email at ${accountEmail} for a Deed verification link.\nClick the link in your email, then press ENTER here to continue...\n`,
      );
      await waitForEnter();

      console.log("Continuing — reloading the portal to pick back up after verification...");
      await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch((e: unknown) => {
        console.warn("Reload after verification failed (continuing anyway):", e instanceof Error ? e.message : String(e));
      });
    }

    console.log("Finding or creating the Walmart funder record...");
    const { data: existingFunder, error: findFunderError } = await supabase
      .from("funders")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("name", "Walmart")
      .maybeSingle();
    if (findFunderError) fatal(`Funder lookup failed: ${findFunderError.message}`);

    let funderId: string;
    if (existingFunder) {
      funderId = (existingFunder as { id: string }).id;
    } else {
      const { data: newFunder, error: insertFunderError } = await supabase
        .from("funders")
        .insert({
          organization_id: organizationId,
          name: "Walmart",
          category: "corporate_foundation",
          description: "Walmart's Spark Good local community grants program.",
          website: "https://www.walmart.com",
          giving_portal_url: WALMART_PORTAL_URL,
          type: "corporate",
          has_giving_page: true,
          notes: "Spark Good local grants portal — account created by scripts/setup-sparkgood-account.ts.",
        })
        .select("id")
        .single();
      if (insertFunderError || !newFunder) {
        fatal(`Failed to create Walmart funder row: ${insertFunderError?.message ?? "no row returned"}`);
      }
      funderId = (newFunder as { id: string }).id;
    }

    const credentialManager = new CredentialManager(supabase);
    await credentialManager.storeCredentials({
      organizationId,
      funderId,
      portalUrl: WALMART_PORTAL_URL,
      username: regResult.username ?? accountEmail,
      password: regResult.password ?? "",
    });

    const now = new Date().toISOString();
    const { error: upsertError } = await supabase
      .from("org_portal_accounts")
      .upsert(
        {
          organization_id: organizationId,
          portal_type: PORTAL_TYPE,
          account_email: regResult.username ?? accountEmail,
          account_created_at: now,
          deed_verified: true,
          deed_verified_at: now,
          notes: "Verified via scripts/setup-sparkgood-account.ts (human-in-the-loop Deed email confirmation).",
        },
        { onConflict: "organization_id,portal_type" },
      );
    if (upsertError) fatal(`Failed to save org_portal_accounts row: ${upsertError.message}`);

    console.log("SUCCESS: Spark Good account verified. AutoApply can now submit to Walmart automatically.");
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  fatal(error instanceof Error ? (error.stack ?? error.message) : String(error));
});
