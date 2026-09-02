# SPEC_PRICING_ADMIN.md
## AFS — Pricing Administration
**Phase 6**
**Route:** `/admin/pricing`
**See:** PRICING_ENGINE.md for full engine architecture and activation checklist
**Engine status:** DEFERRED — manual pricing mode at launch

---

## IMPLEMENTATION STATUS

```
BUILT IN PHASE 6:
  Pricing rules editor (manual margin targets + waste factor per product)
  PricingEngineComingSoon section

NOT BUILT (activate per PRICING_ENGINE.md checklist):
  Commodity price dashboard
  Margin risk alerts
  "Generate Pricing" auto-populate on estimator form
  Historical price chart
  Cron jobs
```

---

## 1. PAGE SECTIONS (PHASE 6 — MANUAL MODE)

```
AdminShell
  PricingAdminPage

  Section 1 — Pricing Rules Editor
  Section 2 — Pricing Engine (Coming Soon placeholder)
```

---

## 2. SECTION 1 — PRICING RULES EDITOR

```typescript
// Table: all products from products table joined to product_profiles
// BLOCKED: empty until catalog data received (checklist #12-15)

// Columns:
// Product | Material | Cost Notes | Target Margin % | Waste Factor | Rush % | Actions

// "Cost Notes" (text field):
//   Estimator records manual cost basis: "Typically $0.85/LF material + $0.65/LF fab"
//   Not calculated — just a reference note for consistency between estimators
//   Max 200 chars

// Target Margin % (number input):
//   Estimator's target. Not enforced — reminder only in manual mode.
//   When engine activates: this feeds the calculation algorithm.

// Waste Factor (number input):
//   e.g., 1.10 = 10% waste
//   Applied to adjusted quantity display in manual entry form

// Rush % (number input):
//   Rush surcharge percentage to add when is_rush = true
//   Applied manually by estimator in quote creation (no auto-apply in manual mode)

// [Save Row] per row → PATCH /api/admin/pricing/rules/{productId}
// All changes: admin_audit_log entry
```

---

## 3. SECTION 2 — PRICING ENGINE (COMING SOON)

```typescript
// PricingEngineComingSoonCard:
//   bg-afs-bg-surface border border-[var(--afs-border)] rounded p-8
//   Icon: gears or chart icon (afs-chrome-dim)
//   Heading: font-heading text-xl text-afs-chrome-mid "Commodity-Indexed Pricing Engine"
//   Body:
//     "The dynamic pricing engine is in development. When activated, it will
//      auto-populate line item prices for each quote request based on real-time
//      metal commodity prices, historical supplier cost data, and your margin targets."
//   Status: "Targeted for activation: 6–12 months post-launch"
//   Requirements list:
//     "○ 12+ months of historical commodity price data"
//     "○ Supplier invoice history import (3+ years)"
//     "○ Fabrication cost baselines per product"
//   Link: "View activation checklist →" (links to internal doc or admin notes)
```

---

## 4. ESTIMATOR QUOTE CREATION (MANUAL PRICING)

Manual unit price entry is documented in PRICING_ENGINE.md §6 (Manual Pricing Mode).

Summary: estimator opens quote request, enters unit price per line item manually,
calculates freight manually, sends formal quote. No "Generate Pricing" button until
engine is activated.

---

*SPEC_PRICING_ADMIN.md | AFS | Reid Whitesides | June 2026*
*Engine deferred — see PRICING_ENGINE.md for activation checklist.*

---

## 1. PAGE SECTIONS

```
AdminShell
  PricingAdminDashboard

  Section 1: Today's Commodity Prices
  Section 2: Margin Risk Alerts
  Section 3: Pricing Rules Editor
  Section 4: Historical Price Chart
  Section 5: Quote Queue (direct access from pricing context)
```

---

## 2. SECTION 1 — COMMODITY PRICE DASHBOARD

```typescript
// Table: Material | Commodity | $/lb Today | 24hr Δ | 7d Δ | 30d Δ | Trend
// Fetched from commodity_prices table (latest per commodity)
// Δ calculated from prior records in same table

const TREND_DISPLAY = {
  up:    { icon: '↑', color: 'text-afs-crimson' },  // Price rising = cost risk
  down:  { icon: '↓', color: 'text-afs-success' },  // Price falling = margin buffer
  flat:  { icon: '→', color: 'text-afs-chrome-mid' },
};

// Last updated timestamp:
//   "Updated {relativeTime}" — e.g., "Updated 3 hours ago"
//   Stale warning if > 26 hours old (cron missed or failed)

// Action buttons:
//   [Refresh Now] → POST /api/cron/commodity-prices (with admin auth header)
//   [Enter Manually] → ManualPriceEntryModal
//     Per commodity: date + $/lb input + source note
//     Sets is_manual = true
```

---

## 3. SECTION 2 — MARGIN RISK ALERTS

```typescript
// Reads: pricing_trend_analysis where margin_risk_flag = true
// Displayed as alert cards, sorted by risk severity

interface MarginRiskCard {
  material:           string;
  riskNote:           string;
  commodity30dChange: number;
  projectedMarginImpact: number;
  recommendation:     string;  // From trend analysis
}

// Card styling:
//   margin_risk_note margin > 'watch': amber border, bg-afs-warning-ghost
//   margin_risk_note margin > 'flag':  crimson border, bg-afs-crimson-ghost

// [Dismiss] button: logs to admin_audit_log, hides for 24 hours
// [Review Quoted Prices] link → filters quote request queue for that material
```

---

## 4. SECTION 3 — PRICING RULES EDITOR

```typescript
// Table: all products with their pricing_rules
// BLOCKED: empty until checklist #22-23, #26, #37 received

// Columns:
// Product | Material | Fab Cost/LF | Overhead % | Margin % | Waste Factor | Rush % | Actions

// Inline editing: click cell to edit, Tab through row
// Calculated preview: "At these rates, cost = $X.XX/LF → price = $X.XX/LF"
// These are INTERNAL calculations only — never customer-visible

// [Save Row] on each row — PATCH /api/admin/pricing/rules/{productId}
// Bulk import: [Import from CSV] → accepts CSV with same column structure
// Audit: every change logged to admin_audit_log with before/after

// Volume tier editor (separate row expansion):
//   Tier 1: > {qty} LF → {discount}% discount
//   Tier 2: > {qty} LF → {discount}% discount
//   Tier 3: > {qty} LF → {discount}% discount
```

---

## 5. SECTION 4 — HISTORICAL PRICE CHART

```typescript
// Recharts LineChart
// X axis: dates (last 30 / 90 / 365 days — tab selector)
// Two Y axes:
//   Left:  commodity $/lb
//   Right: average quoted $/LF (from completed quotes)
// Lines: one per material being tracked
// Tooltip: hover shows exact values on date
// Purpose: visualizes margin compression or expansion over time
```

---

## 6. QUOTE QUEUE FROM PRICING CONTEXT

```typescript
// Prominent link: "Open Quote Requests Waiting for Pricing →"
// Routes to /admin/quote-requests filtered to status = 'submitted'
// Quick-price flow: open request → engine auto-populates → review → send
// See PRICING_ENGINE.md §6 for full estimator quote creation flow
```

---

*SPEC_PRICING_ADMIN.md | AFS | Reid Whitesides | June 2026*
