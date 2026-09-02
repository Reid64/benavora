# SPEC_DELIVERY_TRACKING_AND_EMPLOYEE_PWA.md
## AFS — Delivery Tracking, Employee PWA, and Command Center CRM Expansion
**Phase: Post-Launch Feature Block**
**Routes:** `/track/[orderId]`, `/admin/command-center` (expanded), `/admin/crm/**`, `/employee/**` (PWA)
**Auth:** Customer tracking = order token (no login required). Employee PWA = operator role. CRM = admin/operator role.

---

## 1. OVERVIEW

Four systems built as one FORGE run:

| System | Who Uses It | What It Does |
|---|---|---|
| Delivery Tracking Map | Customers | Real-time GPS map of their delivery driver |
| Employee PWA | Steve + Christian | Mark orders complete, trigger invoices, queue GBP photos |
| Command Center CRM | Steve + Trica + Christian | Customer accounts, order completion, invoice trigger |
| GBP Photo Queue | Steve + Christian | Queue photos for Google Business Profile upload |

---

## 2. DELIVERY TRACKING MAP

### Route
`/track/[orderId]` — public, no login required, accessed via unique token in SMS/email link

### What the customer sees
- Full-screen Google Map centered on Burnet, TX
- **Static red pulsating dot** at AFS shop: 209 Shurcast Drive, Burnet, TX 78611 (lat: 30.7584, lng: -98.2328)
  - Label: "AFS Architectural Flashing Supply"
  - Always visible regardless of delivery status
- **Live blue pulsating dot** — their delivery driver's real-time GPS position
  - Only visible when order status = `out_for_delivery`
  - Updates every 30 seconds from Supabase realtime
  - Label: "Your Delivery"
- **Destination marker** — customer's jobsite address (from order record)
- Order status bar at top: "Your order is on the way — estimated arrival soon"
- No other customers' drivers visible — scoped strictly to this order token

### GPS Data Flow
```
Employee PWA (background geolocation)
  → POST /api/driver/location every 30 seconds
  → Supabase driver_locations table
  → Supabase Realtime broadcast
  → Customer map updates live
```

### Database — driver_locations table
```sql
CREATE TABLE driver_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid REFERENCES profiles(id),
  order_id uuid REFERENCES orders(id),
  lat decimal(10, 7) NOT NULL,
  lng decimal(10, 7) NOT NULL,
  recorded_at timestamptz DEFAULT now()
);

-- RLS: only readable if order token matches
ALTER TABLE driver_locations ENABLE ROW LEVEL SECURITY;
```

### 10-Mile SMS Trigger
- Background job checks distance between driver_location and order jobsite_address every 60 seconds
- When distance ≤ 10 miles: fire Twilio SMS to customer
- Message: "Your AFS delivery is about 10 miles away. Track your driver: {trackingUrl}"
- Fire once per order — set delivery_notifications.ten_mile_sent = true after firing

### ENV VARS REQUIRED
```
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=   # Must be added — not currently in .env.local
GOOGLE_MAPS_API_KEY=               # Server-side
```

---

## 3. EMPLOYEE PWA

### What it is
A Progressive Web App — installable from Chrome on Android. No App Store. Separate from the customer-facing site. Distinct icon and branding.

**URL:** `/employee` — separate PWA manifest, separate icon

**Authorized users:** profiles with role = `operator` (Steve + Christian)
- Steve: 512-965-9609
- Christian: 512-588-4704

### PWA Manifest
```json
{
  "name": "AFS Operations",
  "short_name": "AFS Ops",
  "start_url": "/employee",
  "display": "standalone",
  "background_color": "#1C1F26",
  "theme_color": "#C0001A",
  "icons": [
    { "src": "/employee-icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/employee-icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

Icon: AFS shield on black background — distinct from main site favicon.

### Employee PWA Screens

#### Screen 1 — Home (bottom nav)
Two tabs: **Orders** | **Photos**

#### Screen 2 — Orders Tab
- List of active orders with status IN (in_production, ready, packaged)
- Each order card: customer name, order number, profile summary, status badge
- Tap order → Order Detail screen

#### Screen 3 — Order Detail
- Order summary (customer, items, address)
- Status advancement buttons:
  - [Mark as Packaged] → sets status = `packaged`, timestamps packaged_at
  - [Dispatch for Delivery] → sets status = `out_for_delivery`, triggers:
    1. Customer SMS via Twilio: "Your AFS order {orderNumber} is on the way. Track your delivery: {trackingUrl}"
    2. Customer email via Resend: delivery notification with tracking link
    3. Final invoice email to customer (PDF generated from order data)
    4. Starts GPS background location reporting for this driver
  - [Mark Delivered] → sets status = `delivered`, stops GPS reporting

#### Screen 4 — Photos Tab
- [Take Photo] button → opens device camera
- Photo preview with caption field
- [Queue for Upload] → saves to gbp_photo_queue table with status = `pending_review`
- Queue list: photos pending review, approved, posted
- NO automatic posting — human review required before GBP upload

### Background GPS
- Starts when driver taps [Dispatch for Delivery]
- Uses browser Geolocation API with watchPosition()
- Posts to /api/driver/location every 30 seconds
- Stops when driver taps [Mark Delivered]
- Requires location permission grant on PWA install

---

## 4. COMMAND CENTER CRM EXPANSION

### New tabs inside /admin/command-center

Current tabs (existing): Queue | Approvals

New tabs to add:

#### Tab: Customers
- Searchable customer list: name, company, email, order count, total spend, last order date
- Click customer → Customer Detail drawer/panel
- Customer Detail shows:
  - Contact info
  - Order history (all orders, all statuses)
  - Quote requests
  - Outstanding invoices
  - Credit application status
  - Notes field (internal AFS notes, not visible to customer)

#### Tab: Orders (CRM view)
- All orders across all statuses
- Filter by: status, date range, customer, driver
- Order row: order number | customer | items summary | status | driver assigned | delivery date
- Click order → Order Detail panel
- Actions per order:
  - Assign driver (Steve or Christian)
  - Set delivery date
  - [Mark Packaged] — same as PWA action
  - [Dispatch] — same as PWA action, triggers same notifications
  - [View Tracking Map] — opens /track/[orderId] in new tab

#### Tab: Invoices
- All invoices: invoice number | order number | customer | amount | status | due date
- Status: draft | sent | paid | overdue
- [Send Invoice] → emails PDF to customer via Resend
- [Mark Paid] → updates invoice status
- Invoice PDF generated server-side from order line items

#### Tab: GBP Photo Queue
- Photos queued from employee PWA
- Each photo: thumbnail | caption | queued by | queued at | status
- Actions: [Approve] | [Reject] | [Post to Google Business]
- [Post to Google Business] → calls GBP API with OAuth
- Approved photos require manual click to post — no automation

---

## 5. GBP PHOTO UPLOAD

### Database
```sql
CREATE TABLE gbp_photo_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queued_by uuid REFERENCES profiles(id),
  storage_key text NOT NULL,
  caption text,
  status text DEFAULT 'pending_review', -- pending_review | approved | rejected | posted
  queued_at timestamptz DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES profiles(id),
  posted_at timestamptz
);
```

### GBP API
- OAuth 2.0 with Google — admin configures once via /admin/settings/integrations
- POST to Google My Business API v4.9: `accounts/{accountId}/locations/{locationId}/media`
- Human must click [Post to Google Business] in the CRM photo queue — never automatic

### ENV VARS REQUIRED
```
GOOGLE_BUSINESS_CLIENT_ID=
GOOGLE_BUSINESS_CLIENT_SECRET=
GOOGLE_BUSINESS_LOCATION_ID=
```

---

## 6. NEW DATABASE MIGRATIONS

### Migration 007 — Delivery Tracking + Employee PWA
```sql
-- Driver locations
CREATE TABLE driver_locations ( ... );

-- Delivery notifications log
CREATE TABLE delivery_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id),
  ten_mile_sent boolean DEFAULT false,
  ten_mile_sent_at timestamptz,
  dispatch_sms_sent boolean DEFAULT false,
  dispatch_email_sent boolean DEFAULT false,
  invoice_sent boolean DEFAULT false
);

-- GBP photo queue
CREATE TABLE gbp_photo_queue ( ... );

-- Add operator role to profiles role enum
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'operator';

-- Add packaged_at, dispatched_at, delivered_at to orders
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS packaged_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispatched_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_driver_id uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS tracking_token text UNIQUE DEFAULT gen_random_uuid()::text;
```

---

## 7. NEW API ROUTES

| Route | Method | Auth | Purpose |
|---|---|---|---|
| /api/driver/location | POST | operator | Receive GPS ping from PWA |
| /api/orders/[id]/dispatch | POST | operator | Trigger dispatch notifications + invoice |
| /api/orders/[id]/delivered | POST | operator | Mark delivered, stop GPS |
| /api/track/[token] | GET | public | Return order + driver location for tracking map |
| /api/gbp/queue | POST | operator | Queue photo for GBP upload |
| /api/gbp/post/[id] | POST | admin/operator | Post approved photo to GBP |
| /api/invoices/[id]/send | POST | admin/operator | Email invoice PDF to customer |

---

## 8. NAV ADDITIONS

### Customer-facing
- No new nav items — tracking is accessed via link in SMS/email only

### Admin sidebar (Command Center)
Add to Operations section:
- 🚚 Deliveries → /admin/command-center?tab=orders
- 📸 GBP Photos → /admin/command-center?tab=gbp

### Employee PWA
Standalone bottom nav — not shared with main site nav

---

## 9. REQUIRED ENV VARS SUMMARY

```env
# Google Maps (MISSING — must add before this feature works)
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=
GOOGLE_MAPS_API_KEY=

# Google Business Profile (new)
GOOGLE_BUSINESS_CLIENT_ID=
GOOGLE_BUSINESS_CLIENT_SECRET=
GOOGLE_BUSINESS_LOCATION_ID=

# Twilio (already stubbed — verify configured)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=

# AFS Shop coordinates (static — hardcode in config)
AFS_SHOP_LAT=30.7584
AFS_SHOP_LNG=-98.2328
```

---

## 10. OPERATOR ACCOUNTS TO CREATE POST-BUILD

After migration 007 is applied, set role = 'operator' for:
- Steve Harycki — 512-965-9609
- Christian — 512-588-4704

Run in Supabase SQL editor:
```sql
UPDATE profiles SET role = 'operator'
WHERE email IN ('steve@architecturalflashingsupply.com', 'christian@architecturalflashingsupply.com');
```

---

*SPEC_DELIVERY_TRACKING_AND_EMPLOYEE_PWA.md | AFS | Reid Whitesides | July 2026*
