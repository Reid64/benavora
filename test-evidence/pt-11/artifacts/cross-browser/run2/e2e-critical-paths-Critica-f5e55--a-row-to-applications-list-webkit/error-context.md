# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e\critical-paths.spec.ts >> Critical paths >> 3. creating an application from an opportunity adds a row to /applications/list
- Location: e2e\critical-paths.spec.ts:205:7

# Error details

```
TimeoutError: page.waitForURL: Timeout 30000ms exceeded.
=========================== logs ===========================
waiting for navigation to "**/dashboard" until "load"
============================================================
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - main [ref=e2]:
    - complementary [ref=e3]:
      - img "Benavora" [ref=e6]
      - generic [ref=e7]:
        - heading "Fund More. Do More. Change More." [level=1] [ref=e8]
        - paragraph [ref=e9]: AI-powered grant research, drafting, and lifecycle tracking - built so a single operator can run hundreds of opportunities without anything slipping through.
      - paragraph [ref=e10]: Nonprofit funding automation platform
    - generic [ref=e12]:
      - heading "Welcome back" [level=2] [ref=e13]
      - paragraph [ref=e14]: Sign in to your organization’s workspace.
      - generic [ref=e15]:
        - alert [ref=e16]: Enter a valid email address.
        - generic [ref=e17]:
          - generic [ref=e18]: Email
          - textbox "Email" [ref=e19]:
            - /placeholder: you@organization.org
        - generic [ref=e20]:
          - generic [ref=e21]:
            - generic [ref=e22]: Password
            - link "Forgot password?" [ref=e23]:
              - /url: /forgot-password
          - textbox "Password" [ref=e24]:
            - /placeholder: ••••••••
            - text: BetaTest2026
        - button "Sign in" [ref=e25] [cursor=pointer]
      - paragraph [ref=e26]:
        - text: Don’t have an account?
        - link "Create one" [ref=e27]:
          - /url: /register
  - alert [ref=e28]
```

# Test source

```ts
  68  |     email: TEST_EMAIL,
  69  |     password: TEST_PASSWORD,
  70  |   });
  71  |   if (signInError || !signIn.user) {
  72  |     throw new Error(`Could not sign in ${TEST_EMAIL}: ${signInError?.message ?? "no user"}`);
  73  |   }
  74  | 
  75  |   const { data: orgId, error: rpcError } = await anon.rpc("register_organization");
  76  |   if (rpcError || !orgId) {
  77  |     throw new Error(
  78  |       `register_organization failed for ${TEST_EMAIL}: ${rpcError?.message ?? "no org id"}`,
  79  |     );
  80  |   }
  81  |   organizationId = orgId as string;
  82  | 
  83  |   const { error: updateError } = await admin
  84  |     .from("organizations")
  85  |     .update({ onboarding_completed: true })
  86  |     .eq("id", organizationId);
  87  |   if (updateError) {
  88  |     throw new Error(`Could not mark ${TEST_EMAIL}'s org onboarded: ${updateError.message}`);
  89  |   }
  90  | 
  91  |   // Find-or-create the dedicated funder + opportunity for this spec.
  92  |   const { data: existingFunder } = await admin
  93  |     .from("funders")
  94  |     .select("id")
  95  |     .eq("organization_id", organizationId)
  96  |     .eq("name", SEED_FUNDER)
  97  |     .maybeSingle();
  98  | 
  99  |   if (existingFunder) {
  100 |     seedFunderId = existingFunder.id as string;
  101 |   } else {
  102 |     const { data: funder, error: funderError } = await admin
  103 |       .from("funders")
  104 |       .insert({
  105 |         organization_id: organizationId,
  106 |         name: SEED_FUNDER,
  107 |         category: "private_foundation",
  108 |         description: "Seeded funder for the critical-paths e2e spec.",
  109 |       })
  110 |       .select("id")
  111 |       .single();
  112 |     if (funderError || !funder) {
  113 |       throw new Error(`Seed funder failed: ${funderError?.message}`);
  114 |     }
  115 |     seedFunderId = funder.id as string;
  116 |   }
  117 | 
  118 |   const { data: existingOpportunity } = await admin
  119 |     .from("opportunities")
  120 |     .select("id")
  121 |     .eq("organization_id", organizationId)
  122 |     .eq("name", SEED_OPPORTUNITY)
  123 |     .maybeSingle();
  124 | 
  125 |   if (existingOpportunity) {
  126 |     seedOpportunityId = existingOpportunity.id as string;
  127 |   } else {
  128 |     const { data: opportunity, error: oppError } = await admin
  129 |       .from("opportunities")
  130 |       .insert({
  131 |         organization_id: organizationId,
  132 |         funder_id: seedFunderId,
  133 |         name: SEED_OPPORTUNITY,
  134 |         category: "housing_grant",
  135 |         description: "Seeded opportunity for the critical-paths e2e spec.",
  136 |         amount_min: 10000,
  137 |         amount_max: 50000,
  138 |         status: "open",
  139 |         source: "manual",
  140 |       })
  141 |       .select("id")
  142 |       .single();
  143 |     if (oppError || !opportunity) {
  144 |       throw new Error(`Seed opportunity failed: ${oppError?.message}`);
  145 |     }
  146 |     seedOpportunityId = opportunity.id as string;
  147 |   }
  148 | 
  149 |   // Idempotency for the "create application" test: delete any application
  150 |   // already attached to this dedicated seeded opportunity (and its pipeline
  151 |   // history) so every run of this spec starts from a clean, no-existing-
  152 |   // application state. Best-effort - fine if there is nothing to delete.
  153 |   const { data: priorApps } = await admin
  154 |     .from("applications")
  155 |     .select("id")
  156 |     .eq("opportunity_id", seedOpportunityId);
  157 |   for (const app of priorApps ?? []) {
  158 |     await admin.from("pipeline_history").delete().eq("application_id", app.id as string);
  159 |     await admin.from("applications").delete().eq("id", app.id as string);
  160 |   }
  161 | });
  162 | 
  163 | async function login(page: Page): Promise<void> {
  164 |   await page.goto("/login");
  165 |   await page.getByLabel("Email").fill(TEST_EMAIL);
  166 |   await page.getByLabel("Password").fill(TEST_PASSWORD);
  167 |   await page.getByRole("button", { name: "Sign in" }).click();
> 168 |   await page.waitForURL("**/dashboard", { timeout: 30_000 });
      |              ^ TimeoutError: page.waitForURL: Timeout 30000ms exceeded.
  169 | }
  170 | 
  171 | /** Collects uncaught client-side exceptions for the life of the page. */
  172 | function watchForClientErrors(page: Page): string[] {
  173 |   const errors: string[] = [];
  174 |   page.on("pageerror", (err) => errors.push(err.message));
  175 |   return errors;
  176 | }
  177 | 
  178 | test.describe("Critical paths", () => {
  179 |   test("1. login redirects to /dashboard", async ({ page }) => {
  180 |     test.setTimeout(60_000);
  181 |     await page.goto("/login");
  182 |     await page.getByLabel("Email").fill(TEST_EMAIL);
  183 |     await page.getByLabel("Password").fill(TEST_PASSWORD);
  184 |     await page.getByRole("button", { name: "Sign in" }).click();
  185 |     await page.waitForURL("**/dashboard", { timeout: 30_000 });
  186 |     await expect(page).toHaveURL(/\/dashboard$/);
  187 |     // The dashboard's H1 renders the org name (Dashboard v2), not a literal
  188 |     // "Dashboard" heading — assert the main content container instead,
  189 |     // matching the pattern e2e/smoke.spec.ts already uses for this page.
  190 |     await expect(page.locator("main, [role='main']").first()).toBeVisible({
  191 |       timeout: 15_000,
  192 |     });
  193 |   });
  194 | 
  195 |   test("2. opportunities list renders real, non-empty data", async ({ page }) => {
  196 |     test.setTimeout(60_000);
  197 |     await login(page);
  198 |     await page.goto("/opportunities");
  199 |     await expect(
  200 |       page.getByRole("heading", { level: 1, name: "Opportunities" }),
  201 |     ).toBeVisible();
  202 |     await expect(page.getByText(SEED_OPPORTUNITY)).toBeVisible();
  203 |   });
  204 | 
  205 |   test("3. creating an application from an opportunity adds a row to /applications/list", async ({
  206 |     page,
  207 |   }) => {
  208 |     test.setTimeout(60_000);
  209 |     await login(page);
  210 | 
  211 |     await page.goto(`/applications/new?opportunityId=${seedOpportunityId}`);
  212 |     await expect(
  213 |       page.getByText(`Create an application for "${SEED_OPPORTUNITY}".`),
  214 |     ).toBeVisible();
  215 | 
  216 |     await page.getByRole("button", { name: "Create application" }).click();
  217 |     await page.waitForURL(/\/applications\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  218 | 
  219 |     await page.goto("/applications/list");
  220 |     await expect(
  221 |       page.getByRole("heading", { level: 1, name: "Applications" }),
  222 |     ).toBeVisible();
  223 |     await expect(
  224 |       page.getByRole("row", { name: new RegExp(SEED_OPPORTUNITY) }),
  225 |     ).toBeVisible();
  226 |   });
  227 | 
  228 |   test("4. AutoApply engine page renders with no uncaught client-side error", async ({
  229 |     page,
  230 |   }) => {
  231 |     test.setTimeout(60_000);
  232 |     const clientErrors = watchForClientErrors(page);
  233 |     await login(page);
  234 | 
  235 |     await page.goto("/autoapply");
  236 |     await expect(
  237 |       page.getByRole("heading", { level: 1, name: "AUTOAPPLY ENGINE" }),
  238 |     ).toBeVisible();
  239 |     // Queue and Form Templates sections both settle to either real rows or
  240 |     // their own explicit empty state - confirms the data-loading path (the
  241 |     // same submission_queue/form_templates reads that previously broke)
  242 |     // completed without throwing.
  243 |     await expect(
  244 |       page.getByText("Queue is empty.").or(page.getByText("Forms Queued")),
  245 |     ).toBeVisible();
  246 |     await expect(
  247 |       page
  248 |         .getByText("No templates yet")
  249 |         .or(page.getByRole("cell", { name: SEED_FUNDER }))
  250 |         .first(),
  251 |     ).toBeVisible();
  252 | 
  253 |     expect(clientErrors, `Uncaught client-side errors: ${clientErrors.join("; ")}`).toEqual([]);
  254 |   });
  255 | 
  256 |   test("5. funder Relationship Builder page loads without 404 or 500", async ({ page }) => {
  257 |     test.setTimeout(60_000);
  258 |     const clientErrors = watchForClientErrors(page);
  259 |     await login(page);
  260 | 
  261 |     const response = await page.goto(`/funders/${seedFunderId}/relationship`);
  262 |     expect(response?.status()).toBe(200);
  263 | 
  264 |     await expect(
  265 |       page.getByRole("heading", { level: 1, name: `${SEED_FUNDER} — Relationship` }),
  266 |     ).toBeVisible();
  267 |     await expect(
  268 |       page.getByRole("heading", { level: 2, name: "Relationship Score" }),
```