# SPEC_PRICING_ADMIN.md
## AFS — Pricing Administration
**Phase 6**
**Route:** `/admin/pricing`
**See:** PRICING_ENGINE.md for algorithm, calculation logic, and data model
**BLOCKED:** All pricing data (#22-23, #26, #37)

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
