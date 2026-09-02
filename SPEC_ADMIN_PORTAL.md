# SPEC_ADMIN_PORTAL.md
## AFS — Admin Portal
**Phase 6**
**Routes:** `/admin`, all `/admin/**`
**Auth:** admin role only — enforced in middleware.ts AND in every API route**

---

## 1. WHAT THE ADMIN PORTAL IS

The admin portal is the operational backbone of AFS. Every customer-facing
feature has a corresponding admin counterpart. The portal is used by:
- AFS estimators (quote requests → formal quote creation)
- Shop managers (production queue, status advancement)
- AFS owner/management (pricing, customer management, business visibility)

It is a serious operational tool — not a dashboard for looking at charts.
The primary job is moving quote requests through to formal quotes and orders
through to delivery, as fast and accurately as possible.

---

## 2. ADMIN SHELL (`AdminShell.tsx`)

```
Fixed sidebar (240px):
  Background: bg-afs-bg-raised border-r border-[var(--afs-border)]
  AFS logo at top (in bg-afs-bg-dim container)
  
  Nav sections:
  ── Operations ──────────────────────────
    📋 Quote Requests    /admin/quote-requests
    📦 Production Queue  /admin/orders
    📅 Consultations     /admin/consultations
  
  ── Business ────────────────────────────
    👥 Customers         /admin/customers
    💳 Credit Apps       /admin/credit-applications
    📊 Pricing           /admin/pricing
  
  ── Content ─────────────────────────────
    📐 CAD Library       /admin/cad-library
    📄 Resource Center   /admin/resources
  
  ── Settings ────────────────────────────
    ⚙️  Settings          /admin/settings

  Active nav item:
    border-l-2 border-afs-crimson bg-afs-bg-surface text-afs-chrome-high

  Bottom: signed-in admin name + [Sign Out]

Main content area (flex-1):
  max-w-none (full width — admin does not use PageShell)
  px-8 py-8
```

---

## 3. ADMIN DASHBOARD (`/admin`)

```
AdminDashboard

KPI Row (4 cards at top):
  Card 1: "Today's New Orders"    orders created today
  Card 2: "In Production"         status IN (cutting, bending, qc)
  Card 3: "Ready to Ship"         status = 'ready'
  Card 4: "Pending Quote Requests" status = 'submitted'
  Rush count on each card: red "X rush" badge

  KPI card styling:
    bg-afs-bg-raised border border-[var(--afs-border)]
    Value: font-display text-5xl text-afs-chrome-high
    Label: font-label text-sm text-afs-chrome-base uppercase tracking-wide

AlertsRow:
  Margin risk alerts from pricing_trend_analysis (if any)
  Overdue invoices count (if net-terms orders past due)
  Pending credit applications (if any)
  Displayed as dismissible amber banner cards

QuoteRequestQueue (most recent 5):
  Compact rows: request number | customer | profile summary | submitted time | Rush badge
  [View All Quote Requests] link

RecentOrderActivity (last 10 status changes):
  Order number | status transition | time ago
  Admin who changed status (if applicable)
```

---

## 4. MIDDLEWARE ENFORCEMENT

```typescript
// middleware.ts — already specified in ARCHITECTURE.md
// Admin route check:
// 1. supabase.auth.getUser() — verifies session
// 2. profiles.role read — verifies admin
// Redirect to /account if auth but not admin
// Redirect to /login if not auth

// ALSO checked in every /api/admin/** route handler:
// Double enforcement — middleware can fail; API handler is authoritative
async function requireAdmin(supabase: SupabaseClient): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single();
  if (profile?.role !== 'admin') throw new Error('Forbidden');
}
```

---

## 5. AUDIT LOGGING

Every consequential admin action is logged to `admin_audit_log`.

```typescript
// lib/admin/audit.ts
export async function logAdminAction(opts: {
  adminId:       string;
  action:        string;          // 'advance_order_status' | 'update_pricing_rule' | etc.
  resourceType:  string;          // 'order' | 'quote' | 'customer' | 'pricing_rule'
  resourceId:    string;
  beforeValue?:  Record<string, unknown>;
  afterValue?:   Record<string, unknown>;
  ipAddress?:    string;
}): Promise<void> {
  await supabaseAdmin.from('admin_audit_log').insert(opts);
}

// Called after:
//   Status advancement on any order
//   Pricing rule changes
//   Customer role / tier / terms changes
//   Credit application approval / denial
//   Any content upload (CAD, resources)
//   Any deletion
```

---

## 6. ADMIN SETTINGS (`/admin/settings`)

```
SystemSettings
  Integration Status:
    Supabase: connected ✓
    Stripe: [Test key | Live key indicator]
    Resend: [Connected | Domain verified badge]
    Twilio: [Connected | A10DLC status]
    TaxJar: [Connected | Nexus states count] (BLOCKED #31)
    Metals API: [Connected | Last successful fetch]
    Google Maps: [API key status]
    QuickBooks: [Not connected] [Connect QBO] → OAuth flow (Phase 8)

  Cron Job Status:
    commodity-prices: last run, next run, last result
    pricing-trends: last run, next run, last result
    [Trigger Now] button (each cron) — for manual refresh

  Application:
    Maintenance mode toggle (routes all traffic to maintenance page)
    Privacy policy URL (BLOCKED #65)
    Terms URL (BLOCKED #64)
```

---

## 7. PLAYWRIGHT TESTS

```typescript
test('non-admin cannot access /admin', async ({ page }) => {
  // Auth as contractor, navigate to /admin
  await page.goto('/admin');
  await expect(page).toHaveURL('/account');
});

test('admin dashboard renders KPI cards', async ({ page }) => {
  // Auth as admin
  await page.goto('/admin');
  await expect(page.locator('[data-testid="kpi-today-orders"]')).toBeVisible();
  await expect(page.locator('[data-testid="kpi-in-production"]')).toBeVisible();
});

test('admin sidebar nav links are correct', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.locator('a[href="/admin/quote-requests"]')).toBeVisible();
  await expect(page.locator('a[href="/admin/orders"]')).toBeVisible();
  await expect(page.locator('a[href="/admin/pricing"]')).toBeVisible();
});
```

---

*SPEC_ADMIN_PORTAL.md | AFS | Reid Whitesides | June 2026*
