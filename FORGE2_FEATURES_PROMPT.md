# FORGE 2.0 Feature Build Prompt
# Paste this into the FORGE 2.0 project chat (C:\Users\manag\Documents\forge-2)
# This is a single chained CC session, not a FORGE queue

---

Work in C:\Users\manag\Documents\forge-2. ASCII-only. Read the entire existing codebase structure first with a recursive directory listing before touching any file. Read every existing source file you will modify before editing it.

This session builds three native features into FORGE 2.0: prompt caching, a live dashboard, and Slack notifications. All three must integrate cleanly with the existing orchestrator architecture. Do not break any existing behavior.

=== PART 1: PROMPT CACHING ===

1. Find the function or module that constructs the Anthropic API request payload (the messages array sent to api.anthropic.com/v1/messages). Read it in full.

2. Find where governance documents are injected into the prompt context. Read that code in full.

3. Add prompt caching to the governance document injection. Implementation:
   - Governance docs are injected as content blocks in the messages array
   - Add cache_control: { type: "ephemeral" } to the LAST governance doc content block
   - This causes Anthropic to cache all content up to and including that block
   - Cache TTL is 5 minutes, refreshed on each use within a queue run
   - Add a typed interface CachedContentBlock extending the existing content block type
   - Add a config flag enablePromptCaching: boolean (default true) to the orchestrator config
   - When enablePromptCaching is false, governance docs are injected without cache_control
   - Log: "[CACHE] Governance docs cached after prompt 1 - subsequent prompts read from cache (~90% cheaper)"
   - Log on each subsequent prompt: "[CACHE] Cache hit - governance docs read from cache"
   - Track cache_read_input_tokens and cache_creation_input_tokens from the API response usage field and accumulate them in the run summary

4. Update the run report to include: total_input_tokens, total_output_tokens, total_cache_creation_tokens, total_cache_read_tokens, estimated_cost_saved (cache_read_tokens * 0.9 * base_input_price_per_token).

5. Unit test: mock the Anthropic API, run two prompts with the same governance docs, confirm the second call's payload contains no cache_creation in usage (it was a cache read). Use the existing test framework in the project.

=== PART 2: LIVE DASHBOARD ===

6. Read the existing orchestrator event system if one exists. If not, identify where prompt start, pass, fail, and pipeline complete events are emitted (or logged).

7. CREATE src/dashboard/server.ts — a lightweight HTTP server (use Node's built-in http module, no express) that:
   - Starts on port 7734 with fallback to 7735, 7736
   - Serves GET / with the full HTML dashboard (inline, no external files)
   - Serves GET /api/data returning a JSON snapshot of current run state
   - Serves POST /api/stop for clean shutdown
   - Accepts state updates via a typed function updateDashboardState(state: DashboardState)
   - DashboardState type: { project: string, totalPrompts: number, passed: number, failed: number, prompts: PromptResult[], currentPromptId: string | null, currentPromptName: string | null, currentPromptStartedAt: number | null, isComplete: boolean, cacheStats: { saved: number, creationTokens: number, readTokens: number } }

8. The HTML dashboard (inline in server.ts as a template literal):
   - Dark background #0D1117, card background #161B22, text #E6EDF3
   - Circular SVG progress ring: radius 80, stroke-width 12, animated, color: gold #B88A2E while running, green #3FB950 on complete all pass, red #F85149 on any fail
   - Three counters: PASSED (green), FAILED (red), REMAINING (grey)
   - Cache savings card: "Saved ~$X.XX" in gold, showing cache read vs creation tokens
   - Current prompt card with live elapsed timer (JS setInterval every second)
   - Prompt history table: ID, Name, Status badge (PASS green / FAIL red / RUNNING animated gold / PENDING grey), Duration
   - Live log tail: last 10 lines, monospace, auto-scroll, new lines fade in with CSS transition
   - Completion banner: full-width, green all-pass or red any-fail, with summary
   - Auto-fetches /api/data every 3 seconds, updates DOM without reload
   - No external dependencies

9. CREATE src/dashboard/index.ts exporting startDashboard(initialState: DashboardState): { update: (state: DashboardState) => void; stop: () => void }

10. INTEGRATE into the orchestrator: import startDashboard; call it after preflight (before prompt loop) when config.dashboard is true (default true, suppressible with --no-dashboard flag); call update() on every prompt start, pass, fail, and complete event; call stop() after the run report is written. Print "[DASHBOARD] Live at http://localhost:7734" to stdout.

=== PART 3: SLACK NOTIFICATIONS ===

11. CREATE src/notifications/slack.ts exporting:
    - interface SlackConfig { webhookUrl: string }
    - function getSlackConfig(): SlackConfig | null — reads FORGE_SLACK_WEBHOOK env var, returns null if unset (all callers silently skip)
    - async function notifyStart(config: SlackConfig, project: string, totalPrompts: number): Promise<void>
    - async function notifyPromptPass(config: SlackConfig, project: string, promptId: string, promptName: string, durationMs: number): Promise<void>
    - async function notifyPromptFail(config: SlackConfig, project: string, promptId: string, promptName: string, retries: number): Promise<void>
    - async function notifyComplete(config: SlackConfig, project: string, passed: number, failed: number, failedIds: string[], durationMs: number, cacheSaved: number): Promise<void>
    - Each function sends a rich Slack attachment block via fetch() to the webhook URL
    - Pass: green (#36a64f) attachment with prompt name and duration
    - Fail: red (#e01e5a) attachment with prompt name and retry count
    - Complete: green or red based on failed count, fields showing passed/failed/duration/cache saved
    - All functions catch network errors silently (never throw, never crash FORGE)
    - Use native fetch() (Node 18+); no axios or node-fetch dependency

12. INTEGRATE into the orchestrator: import getSlackConfig and notification functions; call getSlackConfig() once at startup; pass the config through to each event hook; all calls wrapped in try-catch. If FORGE_SLACK_WEBHOOK is unset, all notification calls are no-ops.

13. Add to the run report: slack_notifications_sent: number (count of successful webhook calls).

=== PART 4: PROMPT DENSITY ENFORCEMENT ===

14. CREATE src/validation/promptDensity.ts exporting:
    - function validatePrompt(prompt: string, id: string): { valid: boolean; warnings: string[]; errors: string[] }
    - Rules enforced as errors (block queue from starting):
      * Prompt contains the phrases "background", "nohup", "Start-Job", "Invoke-Expression" combined with "ingest", "fetch", "embed", "download" — likely backgrounding network work
      * Prompt contains more than 15 distinct URL patterns (http/https) without a --dry-run escape hatch
    - Rules enforced as warnings (logged but not blocking):
      * Prompt estimated token count exceeds 8000 (estimate: 4 chars per token)
      * Prompt contains both fetch/download AND embed/vector operations (suggest splitting)
    - Log each warning as "[DENSITY] prompt {id}: {warning}"
    - Log each error as "[DENSITY] ERROR prompt {id}: {error} - queue will not start"

15. INTEGRATE into the orchestrator preflight: run validatePrompt on every prompt before the queue starts; if any prompt has errors, print all errors and exit without running any prompts. Print a summary of warnings.

=== CLOSE ===

16. pnpm run build exit 0. pnpm test exit 0 (or equivalent test command for this project). Run a dry-run of the orchestrator against a minimal test queue (create one with 2 prompts if none exists) and confirm: dashboard starts and is reachable at localhost:7734, caching flag appears in the constructed API payload, Slack no-ops silently with no env var set, density validation runs and prints warnings/errors.

17. Update the governance docs for FORGE 2.0 (STATE_OF_THE_BUILD.md, SESSION_STATE.md if they exist in the forge-2 repo) with what was built. Commit "feat: prompt caching, live dashboard, Slack notifications, prompt density enforcement". Push to origin.

18. Print: files created, files modified, test results, dashboard URL confirmation, cache payload evidence (the content block with cache_control shown), density validation output on the test queue.
