# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e\critical-paths.spec.ts >> Critical paths >> 5. funder Relationship Builder page loads without 404 or 500
- Location: e2e\critical-paths.spec.ts:256:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: 'Critical Paths Spec Funder (E2E Seed) — Relationship', level: 1 })
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 15000ms
  - waiting for getByRole('heading', { name: 'Critical Paths Spec Funder (E2E Seed) — Relationship', level: 1 })

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
      - /url: /funders/90a87e16-e95e-4053-b425-c6861beec05a/relationship
    - link "Foundations":
      - /url: /foundations
    - link "Contacts":
      - /url: /contacts
    - link "Applications":
      - /url: /applications
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
  - link "Back to funder":
    - /url: /funders/90a87e16-e95e-4053-b425-c6861beec05a
  - status: Loading
- alert
```

# Test source

```ts
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
> 266 |     ).toBeVisible();
      |       ^ Error: expect(locator).toBeVisible() failed
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