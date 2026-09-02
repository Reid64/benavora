# SPEC_PRODUCTION_TIMELINE.md
## AFS — Production Status Timeline
**Phase 4 — Component used in order detail, admin portal, public tracker**
**BLOCKED: Stage names must be confirmed with AFS shop manager (checklist #39)**

---

## 1. OVERVIEW

The production timeline shows where a custom order sits in the fabrication process.
For contractors who plan crew schedules around material delivery, knowing that
fabrication has actually started (versus just being "in queue") is critical.

This component is shared across three surfaces:
- Customer order detail page (read-only, customer variant)
- Admin order detail (editable — admin advances stages)
- Public order tracker (read-only, minimal variant)

---

## 2. STAGE DEFINITIONS

These labels are PLACEHOLDERS. Final labels must match exact shop language
from AFS shop manager (checklist #39). Wrong labels = shop staff won't use
the system to update statuses.

```typescript
// Placeholder stage labels — will be updated when checklist #39 received
const ORDER_STAGES = [
  {
    key:         'submitted',
    label:       'Order Received',
    description: 'Your order is confirmed and in our system.',
    adminLabel:  'Submitted',
  },
  {
    key:         'received',
    label:       'Acknowledged',
    description: 'Our team has reviewed your order details.',
    adminLabel:  'Acknowledged',
  },
  {
    key:         'in_queue',
    label:       'In Production Queue',
    description: 'Scheduled for fabrication.',
    adminLabel:  'In Queue',
  },
  {
    key:         'cutting',
    label:       'Cutting',
    description: 'Your material is being cut to specification.',
    adminLabel:  'Cutting',
  },
  {
    key:         'bending',
    label:       'Forming',
    description: 'Profiles are being bent and formed.',
    adminLabel:  'Bending/Forming',
  },
  {
    key:         'qc',
    label:       'Quality Check',
    description: 'Final inspection before packaging.',
    adminLabel:  'QC',
  },
  {
    key:         'ready',
    label:       'Ready',
    description: 'Your order is packaged and ready.',
    adminLabel:  'Ready to Ship',
  },
  {
    key:         'shipped',
    label:       'Shipped',
    description: 'On its way to you.',
    adminLabel:  'Shipped',
  },
  {
    key:         'delivered',
    label:       'Delivered',
    description: 'Order complete.',
    adminLabel:  'Delivered',
  },
] as const;

type OrderStatus = typeof ORDER_STAGES[number]['key'];
```

---

## 3. COMPONENT SPEC

```typescript
interface ProductionTimelineProps {
  currentStatus:    OrderStatus;
  statusHistory:    StatusHistoryItem[];
  estimatedShipDate:string | null;
  trackingNumber:   string | null;
  carrier:          string | null;
  shopPhotoUrl:     string | null;
  variant:          'customer' | 'admin' | 'public';
}

interface StatusHistoryItem {
  status:    OrderStatus;
  changedAt: string;
  note:      string | null;
}
```

---

## 4. VISUAL DESIGN

```
Vertical timeline (primary — mobile native, desktop also vertical)

  ● ORDER RECEIVED          Jan 15, 2026 9:02 AM
  │ "Your order is confirmed and in our system."
  │
  ● ACKNOWLEDGED            Jan 15, 2026 10:47 AM
  │
  ● IN PRODUCTION QUEUE     Jan 16, 2026 8:00 AM
  │ "Scheduled for fabrication — estimated start: Jan 17"
  │
  ◉ CUTTING                 Jan 17, 2026 7:15 AM  ← ACTIVE (pulsing)
  │ "Your material is being cut to specification."
  │ Started 2 hours ago
  │
  ○ FORMING                 ← PENDING (empty dot, dashed connector)
  │
  ○ QUALITY CHECK
  │
  ○ READY
  │
  [PRE-SHIP PHOTO SLOT] — shown when shopPhotoUrl set
  │
  ○ SHIPPED
  │
  ○ DELIVERED

Visual:
  Completed: filled crimson dot + solid crimson connector line
  Active:    filled crimson dot + pulse animation (ring expanding)
  Pending:   empty dot (border: afs-chrome-dim) + dashed connector
  Cancelled: red X icon + stage label struck through

Timestamps: font-data text-xs text-afs-chrome-base
Labels: font-heading text-base text-afs-chrome-high (completed/active)
        font-heading text-base text-afs-chrome-dim (pending)
Descriptions: font-body text-sm text-afs-chrome-mid
```

---

## 5. PRE-SHIP PHOTO DISPLAY

```typescript
// When admin uploads pre-ship photo (orders.shop_photo_url set):
// Photo appears between qc and ready stages
// Caption: "Your completed order — ready to ship"
// Click → opens in DocumentPreviewModal (full size)

// If multiple pre-ship photos (order_attachments table):
//   Small grid of thumbnails
//   Each clickable for full view
```

---

## 6. TRACKING INTEGRATION

```typescript
// When order.status === 'shipped' AND tracking_number set:
// Carrier tracking link displayed:
//   "Tracking: {trackingNumber}" → external carrier URL
//   Carrier icon if recognized (UPS, FedEx, etc.)
// Estimated delivery from carrier (if available via EasyPost webhook)
```

---

## 7. NOTIFICATION TRIGGERS

Each stage transition automatically triggers customer notification.
See SPEC_NOTIFICATIONS.md for complete trigger list.

```typescript
const NOTIFICATION_STAGES: OrderStatus[] = [
  'submitted',
  'in_queue',
  'cutting',
  'ready',
  'shipped',
  'delivered',
];
// 'received', 'bending', 'qc' do not trigger customer notifications
// Only most impactful transitions notify customer
```

---

## 8. ADMIN STATUS ADVANCEMENT

```typescript
// In /admin/orders/{id}:
// StatusAdvancer component (prominent, top-right of admin order detail)

// Method A: Quick advance (most common)
//   "→ Advance to: [Next Stage Label]" button
//   Click → instant update
//   No confirmation needed for forward movement
//   Triggers notification + audit log automatically

// Method B: Status dropdown (corrections, skipping stages)
//   Select any status
//   Optional note field
//   Confirmation required for backward movement:
//     "Moving order backward is unusual. Add a note to explain."
//   Submit → updates orders.status + inserts order_status_history

// After any status change:
//   Customer notification fires (if stage in NOTIFICATION_STAGES)
//   order_status_history record inserted
//   admin_audit_log record inserted
//   Realtime update fires → customer sees status change live
```

---

*SPEC_PRODUCTION_TIMELINE.md | AFS | Reid Whitesides | June 2026*
