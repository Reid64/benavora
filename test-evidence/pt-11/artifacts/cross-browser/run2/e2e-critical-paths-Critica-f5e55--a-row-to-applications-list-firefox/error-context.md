# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e\critical-paths.spec.ts >> Critical paths >> 3. creating an application from an opportunity adds a row to /applications/list
- Location: e2e\critical-paths.spec.ts:205:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('row', { name: /Critical Paths Spec Grant (E2E Seed)/ })
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 15000ms
  - waiting for getByRole('row', { name: /Critical Paths Spec Grant (E2E Seed)/ })

```

```yaml
- complementary "Primary navigation":
  - link "Benavora - go to dashboard":
    - /url: /dashboard
    - img "Benavora"
    - text: Fund More. Do More. Change More.
  - navigation "Main navigation":
    - link "1 item needs attention Alerts":
      - /url: /alerts
      - text: 1 Alerts
    - link "Activity":
      - /url: /activity
    - link "Funders":
      - /url: /funders
    - link "Foundations":
      - /url: /foundations
    - link "Contacts":
      - /url: /contacts
    - link "Applications":
      - /url: /applications/list
    - link "Documents":
      - /url: /documents
    - link "Knowledge Base":
      - /url: /knowledge-base
    - link "Intelligence Library":
      - /url: /intelligence-library
    - link "Agent Marketplace":
      - /url: /agents/marketplace
    - link "Deadlines":
      - /url: /deadlines
    - link "Compliance":
      - /url: /compliance
    - link "Outcomes & Analytics":
      - /url: /outcomes
    - link "Financials":
      - /url: /financials
    - link "Marketplace":
      - /url: /marketplace
    - link "Reports":
      - /url: /reports
    - link "Intelligence":
      - /url: /intelligence
    - link "Email":
      - /url: /email
    - link "Outreach":
      - /url: /outreach
    - paragraph: Resources
    - link "Nonprofit Directory":
      - /url: /nonprofits
    - paragraph: Platform
    - link "Command Center":
      - /url: /command-center
    - link "Organizations":
      - /url: /admin/orgs
    - link "System Health":
      - /url: /admin/system
    - link "Import":
      - /url: /import
    - link "Sales Outreach":
      - /url: /admin/sales-outreach
    - link "AutoApply Ops":
      - /url: /admin/autoapply-ops
    - link "Monitor":
      - /url: /admin/monitor
    - link "Improvements":
      - /url: /admin/improvements
    - link "Audit Log":
      - /url: /admin/audit-log
  - link "Settings":
    - /url: /settings
  - paragraph: My Organization
  - paragraph: Nonprofit funding automation
- banner:
  - navigation "Primary sections":
    - link "Dashboard":
      - /url: /dashboard
    - link "Research":
      - /url: /research
    - link "Opportunities":
      - /url: /opportunities
    - link "AutoApply":
      - /url: /autoapply
    - link "Draft Generator":
      - /url: /draft-generator
    - link "Donor Discovery":
      - /url: /donor-discovery
  - textbox "Search Benavora":
    - /placeholder: Search...
  - button "Notifications"
  - button "Organization menu": My Organization
- main:
  - heading "Applications" [level=1]
  - paragraph: Every application in your pipeline, as a sortable list.
  - link "Board":
    - /url: /applications
  - text: List
  - link "Renewals":
    - /url: /renewals
  - searchbox "Search applications"
  - combobox "Filter by stage":
    - option "All stages" [selected]
    - option "Discovered"
    - option "Eligibility Review"
    - option "Qualified"
    - option "Drafting"
    - option "Awaiting Documents"
    - option "Ready for Review"
    - option "Submitted"
    - option "Follow-up Due"
    - option "Awarded"
    - option "Denied"
    - option "Reporting Required"
    - option "Renewal Opportunity"
  - table:
    - rowgroup:
      - row "Opportunity Stage Requested Deadline Days in stage Updated":
        - columnheader "Opportunity":
          - button "Opportunity"
        - columnheader "Stage":
          - button "Stage"
        - columnheader "Requested":
          - button "Requested"
        - columnheader "Deadline":
          - button "Deadline"
        - columnheader "Days in stage":
          - button "Days in stage"
        - columnheader "Updated":
          - button "Updated"
    - rowgroup:
      - row "Critical Paths Spec Grant (E2E Seed) Critical Paths Spec Funder (E2E Seed) Discovered - - 0 less than a minute ago":
        - cell "Critical Paths Spec Grant (E2E Seed) Critical Paths Spec Funder (E2E Seed)"
        - cell "Discovered"
        - cell "-"
        - cell "-"
        - cell "0"
        - cell "less than a minute ago"
  - paragraph: Showing 1-1 of 1
  - button "Previous" [disabled]
  - text: Page 1 of 1
  - button "Next" [disabled]
- alert
```

# Test source

```ts
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
  168 |   await page.waitForURL("**/dashboard", { timeout: 30_000 });
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
> 225 |     ).toBeVisible();
      |       ^ Error: expect(locator).toBeVisible() failed
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
  269 |     ).toBeVisible();
  270 |     await expect(
  271 |       page.getByRole("heading", { level: 2, name: "Relationship Builder (AG-19)" }),
  272 |     ).toBeVisible();
  273 | 
  274 |     expect(clientErrors, `Uncaught client-side errors: ${clientErrors.join("; ")}`).toEqual([]);
  275 |   });
  276 | });
  277 | 
```