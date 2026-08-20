# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e\visual-regression.spec.ts >> Visual regression >> autoapply
- Location: e2e\visual-regression.spec.ts:118:7

# Error details

```
Error: expect(page).toHaveScreenshot(expected) failed

  194 pixels (ratio 0.01 of all image pixels) are different.

  Snapshot: autoapply.png

Call log:
  - Expect "toHaveScreenshot(autoapply.png)" with timeout 15000ms
    - verifying given screenshot expectation
  - taking page screenshot
    - disabled all CSS animations
  - waiting for fonts to load...
  - fonts loaded
  - 194 pixels (ratio 0.01 of all image pixels) are different.
  - waiting 100ms before taking screenshot
  - taking page screenshot
    - disabled all CSS animations
  - waiting for fonts to load...
  - fonts loaded
  - captured a stable screenshot
  - 194 pixels (ratio 0.01 of all image pixels) are different.

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
            - /url: /applications
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
          - generic [ref=e250]:
            - generic [ref=e251]:
              - heading "AUTOAPPLY ENGINE" [level=1] [ref=e252]
              - paragraph [ref=e253]: Automated form submission engine. Queue funders, analyze portal forms, and submit applications automatically.
            - generic [ref=e254]:
              - generic [ref=e255]: IDLE
              - generic [ref=e257]:
                - generic [ref=e260]: Worker Online
                - generic [ref=e261]: "Heartbeat: -1s ago"
                - generic [ref=e262]: 4 processed · 0 failed
              - link "Settings" [ref=e263] [cursor=pointer]:
                - /url: /autoapply/settings
                - button "Settings" [ref=e264]:
                  - img [ref=e265]
                  - text: Settings
              - button "Add to Queue" [ref=e268] [cursor=pointer]:
                - img [ref=e269]
                - text: Add to Queue
          - generic [ref=e270]:
            - generic [ref=e272]:
              - paragraph [ref=e273]: "0"
              - paragraph [ref=e274]: Sessions Today
            - generic [ref=e276]:
              - paragraph [ref=e277]: —
              - paragraph [ref=e278]: Success Rate
            - generic [ref=e280]:
              - paragraph [ref=e281]: —
              - paragraph [ref=e282]: Avg Fill Time
            - generic [ref=e284]:
              - paragraph [ref=e285]: "0"
              - paragraph [ref=e286]: Forms Queued
          - generic [ref=e287]:
            - generic [ref=e290]:
              - generic [ref=e291]:
                - generic [ref=e292]:
                  - heading "Live Session Viewer" [level=3] [ref=e293]
                  - paragraph [ref=e294]: Real-time browser automation stream from the AutoApply worker
                - button "Expand to fullscreen" [ref=e295] [cursor=pointer]:
                  - img [ref=e296]
              - generic [ref=e303]:
                - generic [ref=e305]: BENAVORA AUTOAPPLY
                - generic [ref=e307]:
                  - img [ref=e308]
                  - generic [ref=e310]:
                    - paragraph [ref=e311]: No active session
                    - paragraph [ref=e312]: Start a session from the queue to see live browser automation here.
                  - button "Start Session" [ref=e313] [cursor=pointer]
                - generic [ref=e316]: OFFLINE
            - generic [ref=e320]:
              - generic [ref=e322]:
                - generic [ref=e323]:
                  - paragraph [ref=e324]: QUEUE
                  - generic [ref=e325]: "0"
                - paragraph [ref=e326]: Queue is empty.
              - generic [ref=e328]:
                - paragraph [ref=e329]: CONTROLS
                - button "Start Session" [ref=e330] [cursor=pointer]
                - link "Pause" [ref=e331] [cursor=pointer]:
                  - /url: /autoapply/controls
                  - button "Pause" [ref=e332]
                - link "View All Sessions" [ref=e333] [cursor=pointer]:
                  - /url: "#session-list"
                  - button "View All Sessions" [ref=e334]
          - generic [ref=e335]:
            - generic [ref=e337]:
              - heading "AutoApply Mode" [level=3] [ref=e338]
              - paragraph [ref=e339]: Controls how much autonomy the AutoApply engine has when submitting applications.
            - generic [ref=e341]:
              - button "Manual" [ref=e342] [cursor=pointer]
              - button "Semi-Auto" [ref=e343] [cursor=pointer]
              - button "Autonomous" [ref=e344] [cursor=pointer]
          - generic [ref=e345]:
            - generic [ref=e346]:
              - img [ref=e347]
              - generic [ref=e349]: Autonomous overnight submissions are disabled for this organization.
            - link "Configure Autonomous Mode" [ref=e350] [cursor=pointer]:
              - /url: /autoapply/controls
          - generic [ref=e351]:
            - generic [ref=e352]:
              - generic [ref=e353]:
                - paragraph [ref=e354]: Queue Depth
                - img [ref=e355]
              - paragraph [ref=e358]: "0"
              - paragraph [ref=e359]: pending items
            - generic [ref=e360]:
              - generic [ref=e361]:
                - paragraph [ref=e362]: Processing Rate
                - img [ref=e363]
              - paragraph [ref=e366]: 0.0/hr
              - paragraph [ref=e367]: completed, last 24h
            - generic [ref=e368]:
              - generic [ref=e369]:
                - paragraph [ref=e370]: Est. Completion
                - img [ref=e371]
              - paragraph [ref=e374]: —
              - paragraph [ref=e375]: no recent activity
          - generic [ref=e376]:
            - generic [ref=e378]:
              - img [ref=e379]
              - heading "Queue Preview" [level=2] [ref=e382]
            - generic [ref=e383]:
              - paragraph [ref=e385]:
                - generic [ref=e386]: 0 funders eligible for auto-queue
              - button "Preview Tonight's Queue" [ref=e388] [cursor=pointer]
          - generic [ref=e389]:
            - generic [ref=e390]:
              - button "Queue Panel" [ref=e391] [cursor=pointer]
              - button "Manual Queue" [ref=e392] [cursor=pointer]
            - generic [ref=e393]:
              - generic [ref=e395]:
                - heading "Queue Panel" [level=3] [ref=e396]
                - paragraph [ref=e397]: Live submission queue with real-time status updates
              - generic [ref=e398]:
                - generic [ref=e399]:
                  - generic [ref=e400]:
                    - paragraph [ref=e401]: Pending
                    - paragraph [ref=e402]: "0"
                  - generic [ref=e403]:
                    - paragraph [ref=e404]: Processing
                    - paragraph [ref=e405]: "0"
                  - generic [ref=e406]:
                    - paragraph [ref=e407]: Completed Today
                    - paragraph [ref=e408]: "0"
                  - generic [ref=e409]:
                    - paragraph [ref=e410]: Failed Today
                    - paragraph [ref=e411]: "0"
                - generic [ref=e414]:
                  - img [ref=e416]
                  - heading "Queue is empty" [level=3] [ref=e419]
                  - paragraph [ref=e420]: Add funders to the queue to begin automated submission.
          - generic [ref=e422]:
            - generic [ref=e424]:
              - heading "Session List" [level=3] [ref=e425]
              - paragraph [ref=e426]: Funders pending or processed by automated form submission
            - generic [ref=e430]:
              - img [ref=e432]
              - heading "Queue is empty" [level=3] [ref=e434]
              - paragraph [ref=e435]: Click "Add to Queue" to select funders for automated submission.
          - generic [ref=e436]:
            - generic [ref=e437]:
              - generic [ref=e438]:
                - heading "Submission History" [level=3] [ref=e439]
                - paragraph [ref=e440]: All AutoApply form submission attempts
              - combobox "Filter by status" [ref=e442]:
                - option "All statuses" [selected]
                - option "Submitted"
                - option "In Progress"
                - option "Failed"
                - option "CAPTCHA Blocked"
                - option "Account Required"
                - option "Site Error"
                - option "Already Submitted"
                - option "Queued"
            - generic [ref=e446]:
              - img [ref=e448]
              - heading "No submissions found" [level=3] [ref=e453]
              - paragraph [ref=e454]: Submissions will appear here after AutoApply runs.
          - generic [ref=e455]:
            - generic [ref=e457]:
              - heading "Review Queue" [level=3] [ref=e458]
              - paragraph [ref=e459]: Failed submissions requiring human review
            - generic [ref=e462]:
              - img [ref=e463]
              - paragraph [ref=e465]: No items in review queue.
          - generic [ref=e467]:
            - generic [ref=e469]:
              - heading "Form Templates" [level=3] [ref=e470]
              - paragraph [ref=e471]: Cached portal form structures for rapid submission
            - generic [ref=e475]:
              - img [ref=e477]
              - heading "No templates yet" [level=3] [ref=e482]
              - paragraph [ref=e483]: Run "Analyze Forms" on queued funders to build form templates.
          - generic [ref=e485]:
            - generic [ref=e486]:
              - heading "Analytics" [level=3] [ref=e487]
              - paragraph [ref=e488]: Submission performance, success rates, and trends
            - button "Expand analytics" [ref=e490] [cursor=pointer]:
              - img [ref=e491]
              - text: Expand
  - alert [ref=e494]
```

# Test source

```ts
  1   | /**
  2   |  * Visual regression suite (Playwright's built-in `toHaveScreenshot()`),
  3   |  * per build task t4-e2e-002 (follows t4-e2e-001's e2e/critical-paths.spec.ts).
  4   |  * Covers five authenticated pages: /dashboard, /opportunities,
  5   |  * /applications/list, /autoapply, /funders. Logs in as the same dedicated
  6   |  * beta account used by e2e/critical-paths.spec.ts (beta1@benavora-test.com,
  7   |  * per scripts/seed-beta-users.ts), supporting the same
  8   |  * PLAYWRIGHT_TEST_EMAIL / PLAYWRIGHT_TEST_PASSWORD overrides, and runs under
  9   |  * the "critical-paths" Playwright project (playwright.config.ts) alongside
  10  |  * it.
  11  |  *
  12  |  * Every page here renders at least one live value that changes from run to
  13  |  * run even with no UI change at all - a clock ("Live · 2:45 PM"), a "today's
  14  |  * date" header, relative-age text on agent/queue activity ("3 days ago",
  15  |  * "Just now"), etc. `timestampMasks()` below covers those generically
  16  |  * (native <time> elements, common timestamp data-attributes, relative-age
  17  |  * phrases, clock times, and absolute month/day/year dates) so a screenshot
  18  |  * taken today and one taken next week diff as identical everywhere except
  19  |  * that data.
  20  |  *
  21  |  * BASELINES: the committed PNGs under
  22  |  * e2e/visual-regression.spec.ts-snapshots/ are the source of truth for
  23  |  * `pnpm test:visual`, which only *compares* against them - it never
  24  |  * regenerates. Baselines must be regenerated DELIBERATELY, with an explicit
  25  |  * command and a reviewed diff, any time an intentional UI change is made:
  26  |  *
  27  |  *     npx playwright test e2e/visual-regression.spec.ts --update-snapshots
  28  |  *
  29  |  * Never let a baseline update happen silently as a side effect of a normal
  30  |  * `pnpm test:visual` / `pnpm test` / CI run.
  31  |  */
  32  | 
  33  | import { test, expect, type Locator, type Page } from "@playwright/test";
  34  | 
  35  | const TEST_EMAIL = process.env.PLAYWRIGHT_TEST_EMAIL ?? "beta1@benavora-test.com";
  36  | const TEST_PASSWORD = process.env.PLAYWRIGHT_TEST_PASSWORD ?? "BetaTest2026";
  37  | 
  38  | /** Text patterns that indicate a live timestamp or relative/absolute date, not stable UI copy. */
  39  | const TIME_TEXT_PATTERNS: RegExp[] = [
  40  |   // "3 days ago", "1 hour ago", "just now", "today", "yesterday", "tomorrow"
  41  |   /\b\d+\s*(second|minute|hour|day|week|month|year)s?\s+ago\b/i,
  42  |   /\b(just now|today|yesterday|tomorrow)\b/i,
  43  |   // clock times: "2:45 PM", "14:05"
  44  |   /\b\d{1,2}:\d{2}\s?(AM|PM)?\b/i,
  45  |   // absolute dates: "August 13, 2026", "Aug 13", "2026-08-13"
  46  |   /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/i,
  47  |   /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+\d{1,2}(,\s*\d{4})?\b/i,
  48  |   /\b\d{4}-\d{2}-\d{2}\b/,
  49  | ];
  50  | 
  51  | async function login(page: Page): Promise<void> {
  52  |   await page.goto("/login");
  53  |   await page.getByLabel("Email").fill(TEST_EMAIL);
  54  |   await page.getByLabel("Password").fill(TEST_PASSWORD);
  55  |   await page.getByRole("button", { name: "Sign in" }).click();
  56  |   await page.waitForURL("**/dashboard", { timeout: 30_000 });
  57  | }
  58  | 
  59  | /**
  60  |  * Locators for anything on the current page that could render a live
  61  |  * timestamp or relative/absolute date, meant to be passed straight into
  62  |  * `toHaveScreenshot`'s `mask` option. A locator that matches nothing on a
  63  |  * given page is a harmless no-op, so this same broad set is reused across
  64  |  * every page in this file rather than hand-tuned per page.
  65  |  */
  66  | function timestampMasks(page: Page): Locator[] {
  67  |   const masks: Locator[] = [
  68  |     page.locator("time"),
  69  |     page.locator("[data-testid*='timestamp' i]"),
  70  |     page.locator("[data-testid*='updated' i]"),
  71  |     page.locator("[data-testid*='last-run' i]"),
  72  |     page.locator("[data-timestamp]"),
  73  |   ];
  74  |   for (const pattern of TIME_TEXT_PATTERNS) {
  75  |     masks.push(page.getByText(pattern));
  76  |   }
  77  |   return masks;
  78  | }
  79  | 
  80  | async function captureScreenshot(page: Page, name: string): Promise<void> {
  81  |   await page.waitForLoadState("networkidle");
> 82  |   await expect(page).toHaveScreenshot(name, {
      |                      ^ Error: expect(page).toHaveScreenshot(expected) failed
  83  |     fullPage: true,
  84  |     mask: timestampMasks(page),
  85  |   });
  86  | }
  87  | 
  88  | test.describe("Visual regression", () => {
  89  |   test.beforeEach(async ({ page }) => {
  90  |     await login(page);
  91  |   });
  92  | 
  93  |   test("dashboard", async ({ page }) => {
  94  |     test.setTimeout(60_000);
  95  |     await page.goto("/dashboard");
  96  |     await expect(page.locator("h1").first()).toBeVisible();
  97  |     await captureScreenshot(page, "dashboard.png");
  98  |   });
  99  | 
  100 |   test("opportunities", async ({ page }) => {
  101 |     test.setTimeout(60_000);
  102 |     await page.goto("/opportunities");
  103 |     await expect(
  104 |       page.getByRole("heading", { level: 1, name: "Opportunities" }),
  105 |     ).toBeVisible();
  106 |     await captureScreenshot(page, "opportunities.png");
  107 |   });
  108 | 
  109 |   test("applications list", async ({ page }) => {
  110 |     test.setTimeout(60_000);
  111 |     await page.goto("/applications/list");
  112 |     await expect(
  113 |       page.getByRole("heading", { level: 1, name: "Applications" }),
  114 |     ).toBeVisible();
  115 |     await captureScreenshot(page, "applications-list.png");
  116 |   });
  117 | 
  118 |   test("autoapply", async ({ page }) => {
  119 |     test.setTimeout(60_000);
  120 |     await page.goto("/autoapply");
  121 |     await expect(
  122 |       page.getByRole("heading", { level: 1, name: "AUTOAPPLY ENGINE" }),
  123 |     ).toBeVisible();
  124 |     await captureScreenshot(page, "autoapply.png");
  125 |   });
  126 | 
  127 |   test("funders", async ({ page }) => {
  128 |     test.setTimeout(60_000);
  129 |     await page.goto("/funders");
  130 |     await expect(
  131 |       page.getByRole("heading", { level: 1, name: "Funders" }),
  132 |     ).toBeVisible();
  133 |     await captureScreenshot(page, "funders.png");
  134 |   });
  135 | });
  136 | 
```