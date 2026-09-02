# SPEC_DELIVERY_SCHEDULER.md
## AFS — Jobsite Delivery Scheduler
**Phase 4**
**Routes:** `/account/delivery`, embedded in order detail
**BLOCKED:** Delivery windows (#84), min advance notice (#85), carrier method (#80–82)

---

## 1. OVERVIEW

Contractors need material to arrive when crews are on site. The delivery scheduler
lets them book a specific delivery window tied to crew schedules. This eliminates
the most common delivery complaint in construction: material arriving when nobody
is on site.

---

## 2. TWO SCHEDULING CONTEXTS

**Context A: After order placed** — Customer books delivery from order detail page.
**Context B: Reschedule** — Customer changes existing delivery window.

---

## 3. COMPONENT

```typescript
interface DeliverySchedulerProps {
  orderId:         string;
  currentSchedule: DeliverySchedule | null;
  mode:            'schedule' | 'reschedule';
  onScheduled:     (schedule: DeliverySchedule) => void;
}

interface DeliverySchedule {
  orderId:              string;
  requestedDate:        string;        // ISO date
  requestedWindow:      DeliveryWindow;
  deliveryAddress:      DeliveryAddress;
  specialInstructions:  string | null;
  scheduledAt:          string;
}

type DeliveryWindow = 'morning' | 'afternoon' | 'all_day';
// BLOCKED: actual window definitions from checklist #84
// Placeholder: morning (8am-12pm) | afternoon (12pm-5pm) | all_day
```

---

## 4. UI

```
DeliverySchedulerPanel

  Current schedule (if reschedule mode):
    "Currently scheduled: [Date] [Window]"

  Calendar (month view — NOT a date picker input):
    Grayed out: past dates
    Grayed out: dates within minimum advance notice (BLOCKED #85, default 3 days)
    Grayed out: weekends (unless AFS confirms weekend delivery — checklist #6)
    Available: future eligible business days
    Selected: bg-afs-crimson text-white

  Window selector (after date selected):
    ○ Morning (8 AM – 12 PM)    [BLOCKED — actual times from checklist #84]
    ○ Afternoon (12 PM – 5 PM)
    ○ All Day (Flexible)

  Special instructions textarea:
    "Gate code, dock location, on-site contact, etc."
    Max 500 chars

  [Schedule Delivery] button (crimson)
    POST /api/delivery/schedule
    Loading: spinner + "Scheduling..."
    Success: confirmation toast + page update

  [Cancel] button (ghost)
```

---

## 5. API

### `POST /api/delivery/schedule`

```typescript
interface ScheduleRequest {
  orderId:             string;
  requestedDate:       string;
  requestedWindow:     DeliveryWindow;
  specialInstructions?:string;
}

// Validates: order belongs to user, date >= minimum advance notice
// Updates: orders.delivery_scheduled_at, orders.delivery_window
// Sends: customer confirmation email + SMS
// Notifies: AFS admin of scheduled delivery
// Inserts: order_status_history note "Delivery scheduled by customer"
```

### `POST /api/delivery/reschedule`

```typescript
// Same as schedule but for existing delivery
// Validates: not within 24hr of current scheduled time
// Admin notified of rescheduling
```

### `GET /api/delivery/availability`

```typescript
// Returns available dates for next 30 days
// Applies: minimum advance notice, business days only, AFS holidays
// BLOCKED: actual availability rules from AFS operations
// Current: all business days >= 3 days out marked available
```

---

## 6. FAILED DELIVERY POLICY (BLOCKED)

```
BLOCKED: checklist #87 (failed delivery policy)
Current: admin handles manually
Future: carrier webhook triggers automatic notification and re-delivery options
```

---

*SPEC_DELIVERY_SCHEDULER.md | AFS | Reid Whitesides | June 2026*
