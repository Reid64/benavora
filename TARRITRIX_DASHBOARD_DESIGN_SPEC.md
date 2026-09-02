# TARRITRIX OPERATOR COMMAND CENTER — DESIGN SPECIFICATION
**Version:** 1.0  
**Date:** 2026-07-04  
**Status:** LOCKED — do not build without this spec present  
**Replaces:** All prior dashboard implementations — demolish completely before building

---

## CORE DESIGN PHILOSOPHY

**Not a dashboard. A command surface.**

Every element earns its place by enabling a decision or action. Nothing decorative. Nothing that requires the operator to hunt for meaning. Ambient context — short instructional labels — lives beside every control so no training is required.

**Visual identity:** Mid-tone slate. Not dark mode, not light mode. A surface that reads as purposeful and professional under any lighting condition. Strong contrast between surface layers. A single cyan accent (`#06b6d4`) inherited from the approved MonthlyGrowthTimeline component. A secondary green (`#10b981`) for success states. Amber (`#f59e0b`) for warnings. Red (`#ef4444`) for critical. No gradients except on the Index Health Score gauge.

**Typography:** Inter or system-ui. Not a display font. Operators read this at 6am — legibility over style.

**Motion:** Subtle. Data updates pulse once. Alerts animate in. Nothing spins.

---

## COLOR TOKENS

```
--bg-base:        #1c2030   (page background)
--bg-surface:     #242b3d   (panels, cards)
--bg-elevated:    #2d3650   (nested cards, inputs)
--bg-overlay:     #353f5c   (modals, dropdowns)

--text-primary:   #f0f4ff   (headings, values)
--text-secondary: #8b9dc3   (labels, descriptions)
--text-muted:     #4d5f82   (timestamps, metadata)

--accent-cyan:    #06b6d4   (primary accent, links, active states)
--accent-green:   #10b981   (success, indexed, healthy)
--accent-amber:   #f59e0b   (attention, warnings)
--accent-red:     #ef4444   (critical, errors, risk)
--accent-purple:  #8b5cf6   (AI/LLM indicators)

--border:         rgba(255,255,255,0.06)
--border-strong:  rgba(255,255,255,0.12)
```

---

## LAYOUT ARCHITECTURE

### Global Shell
```
┌─────────────────────────────────────────────────────────┐
│  TOP NAV (56px fixed)                                   │
│  [TARRITRIX logo] [CLIENT SELECTOR ▾] ... [alerts] [OP] │
├──────────┬──────────────────────────────────────────────┤
│          │                                              │
│ LEFT NAV │  MAIN CANVAS                                 │
│ (220px)  │  (fluid, scrollable)                        │
│          │                                              │
└──────────┴──────────────────────────────────────────────┘
```

### Master View (no client selected)
```
┌─────────────────────────────────────────────────────────┐
│ PLATFORM PULSE BAR (full width, 80px)                   │
│ Pages 24h · Backlinks · Refreshes · Validations · Costs │
├───────────────────┬─────────────────────────────────────┤
│ RISK COMMAND      │ ACTIVITY STREAM                     │
│ (40% width)       │ (60% width)                         │
│                   │                                     │
│ Index Health Score│ Live agent event feed               │
│ Risk signal list  │ Filterable by agent/client/status   │
│ Throttle controls │                                     │
├───────────────────┴─────────────────────────────────────┤
│ PRIORITY COMMAND SURFACE (full width)                   │
│ [CRITICAL lane] [ATTENTION lane] [INFORMATIONAL lane]   │
├─────────────────────────────────────────────────────────┤
│ INTELLIGENCE ROW (full width, 3 panels)                 │
│ Storm Pulse · Indexation Velocity · Revenue Signal      │
└─────────────────────────────────────────────────────────┘
```

### Client-Selected View
When a client is selected from the top nav selector, the master view SHRINKS to a 280px left column showing platform-wide summary only. The client detail EXPANDS to fill the remaining canvas — no navigation away, no page reload, context switch in place.

```
┌──────────┬──────────────────────────────────────────────┐
│ PLATFORM │ CLIENT COMMAND VIEW                          │
│ SUMMARY  │                                              │
│ (280px)  │ Campaign header                              │
│          │ Page inventory dropdown                      │
│ Pulse    │ Dual timeline (pages + drip rate)            │
│ Risk #   │ GBP Performance panel                        │
│ Alerts   │ Per-page analytics (on page click)           │
│          │                                              │
└──────────┴──────────────────────────────────────────────┘
```

---

## COMPONENT SPECIFICATIONS

### 1. TOP NAVIGATION BAR

**Height:** 56px fixed  
**Background:** `--bg-surface` with bottom border `--border`

**Left:** TARRITRIX wordmark in `--text-primary`, weight 700, tracking 2px

**Center:** Client Selector — a search-enabled dropdown showing all active clients with tier badge and last-activity timestamp. Placeholder: "Select a client to drill in →". Selecting a client triggers the layout transition. An X clears the selection and returns to master view.

**Right (left to right):**
- Storm pulse indicator: colored dot + count ("2 active events") — cyan if watches, red if warnings, gray if clear. Tooltip: "Click to see which clients are in affected areas."
- Risk indicator: red badge with total risk signal count. Tooltip: "Active SEO risk signals across all clients. Click to open Risk Command panel."
- LLM cost chip: "$23.40 today" in purple. Tooltip: "Total LLM spend today across all agents. Click for 24h / 7d / MTD breakdown."
- Operator avatar/initials with role badge

---

### 2. PLATFORM PULSE BAR

**Purpose:** Single-glance platform health. What did the machine do in the last 24 hours?  
**Height:** 80px  
**Background:** `--bg-elevated`  
**Instructional label:** "Platform activity — last 24 hours across all clients"

Five metric tiles, equal width, separated by `--border-strong` dividers:

| Metric | Label | Instructional text |
|--------|-------|--------------------|
| Pages published | "Pages Live" | "New pages pushed to production today" |
| Validations run | "Quality Checks" | "A-05 validation passes and failures" |
| Content refreshes | "Refreshed" | "Stale pages updated by A-11" |
| Conversions captured | "Leads In" | "Form submissions and call clicks tracked" |
| Agent errors | "Errors" | "Failed agent executions needing attention" |

Each tile: large number in `--text-primary`, label in `--text-secondary` below, instructional text in `--text-muted` below that. Trend arrow (↑↓) vs yesterday. Errors tile uses `--accent-red` for the number if > 0.

---

### 3. RISK COMMAND PANEL

**Purpose:** SEO risk visibility and throttle control in one surface.  
**Instructional label:** "Index Health Score — composite risk signal across all monitored factors. Below 70 requires action."

**Index Health Score Gauge:**  
Not a donut chart. A purpose-built arc gauge — think instrument panel, not pie chart. Arc spans 200 degrees. Score 0-100. Color transitions: 0-50 red → 50-70 amber → 70-90 green → 90-100 cyan. Current score displayed large in center. Below it: delta vs 7 days ago.

**Risk Signal List:**  
Scrollable list of active signals, each showing:
- Signal name (e.g. "Page publication velocity elevated")
- Affected client count
- Severity dot (red/amber)
- Brief explanation: "Publishing rate approaching threshold for 2 clients"
- Timestamp

**Throttle Controls:**  
Below the signal list, two operator controls with ambient context:
- "Slow all clients" toggle — "Reduces drip rate to 50% for all active clients until manually re-enabled"
- "Pause specific client" — dropdown to select client + pause button — "Stops all page publishing for selected client without affecting others"

These controls require confirmation modal before executing. Modal shows exactly what will change.

---

### 4. PRIORITY COMMAND SURFACE

**Purpose:** Everything needing operator attention, triaged by urgency.  
**Instructional label:** "Your action queue — items auto-escalate from Attention to Critical after 24 hours without action"

Three horizontal lanes with visual weight differentiation:

**CRITICAL lane** — `--accent-red` left border, slightly elevated background  
Items that block client progress or represent active risk. Examples: flagged pages awaiting approval blocking drip, payment failures, A-44 ingestion failures blocking page generation, storm events with no page response triggered.

**ATTENTION lane** — `--accent-amber` left border  
Items that degrade performance if ignored. Examples: validation failures needing review, GSC connection expired, indexation rate dropping below 70% for a client.

**INFORMATIONAL lane** — `--border-strong` left border, standard background  
Awareness only. Examples: A-11 content refresh completed, new demo request received, weekly indexation report ready.

Each item card shows:
- Priority badge
- Age ("4h ago")
- Client name
- One-sentence description of what happened
- One-sentence description of what the operator should do
- Action button (Approve / Review / Dismiss / View)

Items auto-escalate: Informational → Attention at 12h, Attention → Critical at 24h.

---

### 5. ACTIVITY STREAM

**Purpose:** Live feed of agent execution across all clients.  
**Instructional label:** "Real-time agent activity — every automated action the platform takes across all clients"

Table columns: Time · Agent · Client · Action Type · Status · Cost · Context snippet

Status uses colored dots: green (success) · red (error) · amber (warning) · gray (running)

Filter bar above table: All · By agent (A-01 through A-44) · By client · Errors only · Last hour / 24h / 7d

No pagination — virtual scroll. 500 rows max before truncation with "Load earlier" link.

---

### 6. INTELLIGENCE ROW

Three equal panels in a row below the main content:

**Storm Pulse Panel**  
Instructional label: "Active weather events in your clients' service areas — storm events trigger priority page generation opportunities"  
Shows: active watches/warnings by state, affected client count per event, "Generate storm pages" button that pre-selects affected clients and opens page build flow.

**Indexation Velocity Panel**  
Instructional label: "Percentage of published pages confirmed indexed by Google in the last 7 days — below 70% means slow your publishing rate"  
Shows: large percentage, trend line (7 days), per-client breakdown on hover, automated throttle status.

**Revenue Signal Panel**  
Instructional label: "Subscription health — active clients, payment status, and monthly recurring revenue"  
Shows: MRR, active client count, any payment failures highlighted in red, MTD vs last month.

---

### 7. LLM COST BREAKDOWN (modal)

Triggered by clicking the cost chip in top nav.  
Three tabs: Today · This Week · Month to Date  
Per-agent cost breakdown table: Agent ID · Runs · Total cost · Avg cost per run  
Total at bottom. Export CSV button.

---

## CLIENT-SELECTED VIEW COMPONENTS

### 8. CLIENT COMMAND HEADER

When client selected, top of client canvas shows:
- Client business name (large) + tier badge + status indicator
- Campaign start date: "Campaign started March 14, 2026 — Day 112"
- Primary trade + service area
- Quick stats row: Total pages · Published · Indexed · Conversions · Reviews

---

### 9. PAGE INVENTORY

**Instructional label:** "Every page generated for this client — click any page to view its content and performance analytics"

Organized dropdown structure:
```
▾ Roof Replacement (14 pages)
  Georgetown, TX — Roof Replacement [published · indexed]
  Round Rock, TX — Roof Replacement [published · pending index]
  Cedar Park, TX — Roof Replacement [draft · awaiting validation]
▾ Hail Damage (8 pages)
  Georgetown, TX — Hail Damage [published · indexed]
  ...
▾ Emergency Tarping (3 pages)
  ...
```

Each page row: page name · status badge · indexation status · last modified  
Click any page → page detail panel slides in from right showing:
- Page content (rendered preview)
- Performance analytics: impressions, clicks, CTR, avg position, conversions from this page
- Validation gate results (all 16 gates)
- Actions: Edit content · Re-validate · Trigger refresh

---

### 10. DUAL TIMELINE

**Instructional label:** "Page production progress vs your weekly targets — the lower timeline shows your current drip rate and how it increases over time"

Two parallel horizontal timelines stacked:

**Top timeline — Page production:**  
X-axis: campaign weeks. Y-axis: cumulative page count. Target line (dashed) showing total goal. Actual line (solid cyan) showing pages built. Today marker.

**Bottom timeline — Drip rate:**  
X-axis: same campaign weeks. Shows weekly drip rate as step function — week 1 at rate X, week 2 at rate Y, projected increases shown as lighter future steps. Today marker. Current rate highlighted.

---

### 11. GBP PERFORMANCE PANEL

**Instructional label:** "Google Business Profile performance — requires GBP API connection. Connect in client settings."

When connected: 7 metrics in tile format (Views, Calls, Website clicks, Direction requests, Search queries, Reviews, Photos) with trend vs prior period.

When not connected: Grayed panel with "Connect Google Business Profile" CTA and explanation of what this unlocks.

---

## NAVIGATION (LEFT SIDEBAR)

Items in order:
1. Command Center (master dashboard)
2. Clients
3. Pages
4. Agents
5. Storm Intelligence
6. Compliance
7. Billing
8. Settings

Each item has a one-line ambient description visible on hover: "Clients — manage active accounts and trigger campaign actions"

---

## DEMOLITION INSTRUCTION FOR FORGE

Before building any component, CC must:
1. Read this spec in full
2. Read BLUEPRINT.md, SCHEMA_REGISTRY.md, STATE_OF_THE_BUILD.md
3. DELETE src/app/dashboard/page.tsx completely
4. DELETE src/app/api/dashboard/stats/route.ts completely
5. DELETE src/app/api/dashboard/activity-feed/route.ts completely
6. DELETE src/app/api/dashboard/charts/route.ts completely
7. DELETE src/app/api/dashboard/signals/route.ts completely
8. Rebuild from this spec only — no reference to prior implementations

---

## WHAT IS NOT IN PASS 1

The following are specified for Pass 2 and Pass 3 FORGE queues:
- SEO Risk Engine live signal computation (22 signals) — Pass 2
- GBP API OAuth connection and live data — Pass 2  
- Lighthouse automated scoring — Pass 2
- Heat map with pulsing job location dots — Pass 3
- Per-page analytics from real GSC data — Pass 2 (synthetic data in Pass 1)
- Storm proximity matching and auto-page-trigger — Pass 3

Pass 1 builds the correct layout, visual identity, and data connections to what already exists in the database. Empty states for Pass 2/3 features are designed in, not omitted.

