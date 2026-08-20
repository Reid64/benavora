# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e\critical-paths.spec.ts >> Critical paths >> 3. creating an application from an opportunity adds a row to /applications/list
- Location: e2e\critical-paths.spec.ts:205:7

# Error details

```
TimeoutError: page.waitForURL: Timeout 15000ms exceeded.
=========================== logs ===========================
waiting for navigation until "load"
============================================================
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - complementary "Primary navigation" [ref=e3]:
      - link "Benavora - go to dashboard" [ref=e5] [cursor=pointer]:
        - /url: /dashboard
        - generic [ref=e6]:
          - img "Benavora" [ref=e8]
          - generic [ref=e9]: Fund More. Do More. Change More.
      - navigation "Main navigation" [ref=e10]:
        - generic [ref=e11]:
          - link "1 item needs attention Alerts" [ref=e13] [cursor=pointer]:
            - /url: /alerts
            - generic [ref=e14]:
              - img [ref=e15]
              - generic "1 item needs attention" [ref=e18]: "1"
            - generic [ref=e19]: Alerts
          - link "Activity" [ref=e21] [cursor=pointer]:
            - /url: /activity
            - img [ref=e23]
            - generic [ref=e25]: Activity
          - link "Funders" [ref=e27] [cursor=pointer]:
            - /url: /funders
            - img [ref=e29]
            - generic [ref=e33]: Funders
          - link "Foundations" [ref=e35] [cursor=pointer]:
            - /url: /foundations
            - img [ref=e37]
            - generic [ref=e39]: Foundations
          - link "Contacts" [ref=e41] [cursor=pointer]:
            - /url: /contacts
            - img [ref=e43]
            - generic [ref=e48]: Contacts
          - link "Applications" [ref=e50] [cursor=pointer]:
            - /url: /applications/new?opportunityId=da525aeb-8041-456b-be10-cf69beb508f2
            - img [ref=e52]
            - generic [ref=e54]: Applications
          - link "Documents" [ref=e56] [cursor=pointer]:
            - /url: /documents
            - img [ref=e58]
            - generic [ref=e60]: Documents
          - link "Knowledge Base" [ref=e62] [cursor=pointer]:
            - /url: /knowledge-base
            - img [ref=e64]
            - generic [ref=e74]: Knowledge Base
          - link "Intelligence Library" [ref=e76] [cursor=pointer]:
            - /url: /intelligence-library
            - img [ref=e78]
            - generic [ref=e80]: Intelligence Library
          - link "Agent Marketplace" [ref=e82] [cursor=pointer]:
            - /url: /agents/marketplace
            - img [ref=e84]
            - generic [ref=e87]: Agent Marketplace
          - link "Deadlines" [ref=e89] [cursor=pointer]:
            - /url: /deadlines
            - img [ref=e91]
            - generic [ref=e93]: Deadlines
          - link "Compliance" [ref=e95] [cursor=pointer]:
            - /url: /compliance
            - img [ref=e97]
            - generic [ref=e100]: Compliance
          - link "Outcomes & Analytics" [ref=e102] [cursor=pointer]:
            - /url: /outcomes
            - img [ref=e104]
            - generic [ref=e106]: Outcomes & Analytics
          - link "Financials" [ref=e108] [cursor=pointer]:
            - /url: /financials
            - img [ref=e110]
            - generic [ref=e112]: Financials
          - link "Marketplace" [ref=e114] [cursor=pointer]:
            - /url: /marketplace
            - img [ref=e116]
            - generic [ref=e120]: Marketplace
          - link "Reports" [ref=e122] [cursor=pointer]:
            - /url: /reports
            - img [ref=e124]
            - generic [ref=e127]: Reports
          - link "Intelligence" [ref=e129] [cursor=pointer]:
            - /url: /intelligence
            - img [ref=e131]
            - generic [ref=e135]: Intelligence
          - link "Email" [ref=e137] [cursor=pointer]:
            - /url: /email
            - img [ref=e139]
            - generic [ref=e142]: Email
          - link "Outreach" [ref=e144] [cursor=pointer]:
            - /url: /outreach
            - img [ref=e146]
            - generic [ref=e149]: Outreach
        - generic [ref=e150]:
          - paragraph [ref=e151]: Resources
          - link "Nonprofit Directory" [ref=e153] [cursor=pointer]:
            - /url: /nonprofits
            - img [ref=e155]
            - generic [ref=e157]: Nonprofit Directory
        - generic [ref=e158]:
          - paragraph [ref=e159]: Platform
          - generic [ref=e160]:
            - link "Command Center" [ref=e161] [cursor=pointer]:
              - /url: /command-center
              - img [ref=e163]
              - generic [ref=e170]: Command Center
            - link "Organizations" [ref=e171] [cursor=pointer]:
              - /url: /admin/orgs
              - img [ref=e173]
              - generic [ref=e176]: Organizations
            - link "System Health" [ref=e177] [cursor=pointer]:
              - /url: /admin/system
              - img [ref=e179]
              - generic [ref=e182]: System Health
            - link "Import" [ref=e183] [cursor=pointer]:
              - /url: /import
              - img [ref=e185]
              - generic [ref=e188]: Import
            - link "Sales Outreach" [ref=e189] [cursor=pointer]:
              - /url: /admin/sales-outreach
              - img [ref=e191]
              - generic [ref=e194]: Sales Outreach
            - link "AutoApply Ops" [ref=e195] [cursor=pointer]:
              - /url: /admin/autoapply-ops
              - img [ref=e197]
              - generic [ref=e200]: AutoApply Ops
            - link "Monitor" [ref=e201] [cursor=pointer]:
              - /url: /admin/monitor
              - img [ref=e203]
              - generic [ref=e206]: Monitor
            - link "Improvements" [ref=e207] [cursor=pointer]:
              - /url: /admin/improvements
              - img [ref=e209]
              - generic [ref=e211]: Improvements
            - link "Audit Log" [ref=e212] [cursor=pointer]:
              - /url: /admin/audit-log
              - img [ref=e214]
              - generic [ref=e216]: Audit Log
      - generic [ref=e217]:
        - link "Settings" [ref=e218] [cursor=pointer]:
          - /url: /settings
          - img [ref=e220]
          - generic [ref=e223]: Settings
        - paragraph [ref=e224]: My Organization
        - paragraph [ref=e225]: Nonprofit funding automation
    - generic [ref=e226]:
      - banner [ref=e227]:
        - navigation "Primary sections" [ref=e229]:
          - link "Dashboard" [ref=e230] [cursor=pointer]:
            - /url: /dashboard
          - link "Research" [ref=e231] [cursor=pointer]:
            - /url: /research
          - link "Opportunities" [ref=e232] [cursor=pointer]:
            - /url: /opportunities
          - link "AutoApply" [ref=e233] [cursor=pointer]:
            - /url: /autoapply
          - link "Draft Generator" [ref=e234] [cursor=pointer]:
            - /url: /draft-generator
          - link "Donor Discovery" [ref=e235] [cursor=pointer]:
            - /url: /donor-discovery
        - generic [ref=e236]:
          - generic [ref=e237]:
            - img
            - textbox "Search Benavora" [ref=e238]:
              - /placeholder: Search...
            - generic: Ctrl K
          - button "Notifications" [ref=e240] [cursor=pointer]:
            - img [ref=e241]
          - button "Organization menu" [ref=e245] [cursor=pointer]:
            - generic [ref=e246]: My Organization
            - generic [ref=e247]: MO
      - main [ref=e248]:
        - generic [ref=e249]:
          - link "Back to opportunities" [ref=e250] [cursor=pointer]:
            - /url: /opportunities
            - img [ref=e251]
            - text: Back to opportunities
          - generic [ref=e253]:
            - heading "Start an application" [level=3] [ref=e256]
            - generic [ref=e258]:
              - paragraph [ref=e259]: Create an application for "Critical Paths Spec Grant (E2E Seed)".
              - button "Create application" [disabled] [ref=e260]:
                - img [ref=e261]
                - img [ref=e263]
                - text: Create application
  - alert [ref=e265]
```

# Test source

```ts
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
> 217 |     await page.waitForURL(/\/applications\/[0-9a-f-]{36}$/, { timeout: 15_000 });
      |                ^ TimeoutError: page.waitForURL: Timeout 15000ms exceeded.
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