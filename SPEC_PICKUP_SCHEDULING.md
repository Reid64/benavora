# SPEC_PICKUP_SCHEDULING.md
## AFS — Pickup Scheduling
**Phase 4 — Embedded in Checkout (delivery method) and Order Detail**
**BLOCKED:** Pickup process, dock details (checklist #47)

---

## 1. OVERVIEW

Customers who pick up orders from the AFS facility need to schedule a window
so their order is staged and ready when they arrive. Eliminates customers
showing up to find their order not ready.

---

## 2. FLOW

```
In checkout: user selects "Pickup" as delivery method
  PickupScheduler appears:
    Date selector: business days within AFS hours (BLOCKED #6)
    Window: Morning | Afternoon (BLOCKED #47)
    Contact name + phone for pickup coordination
  [Schedule Pickup] → stored on order

In order detail (after ordering):
  PickupInfoSection:
    Scheduled date + window
    AFS address (BLOCKED #5)
    [Get Directions] → Google Maps
    Special staging instructions (BLOCKED #47)
```

---

## 3. COMPONENT

```typescript
interface PickupSchedulerProps {
  orderId:      string;
  onScheduled:  (pickup: PickupSchedule) => void;
}

interface PickupSchedule {
  orderId:      string;
  pickupDate:   string;
  pickupWindow: 'morning' | 'afternoon';
  contactName:  string;
  contactPhone: string;
}
```

---

## 4. API

```typescript
// POST /api/pickup/schedule
// Validates: order status is 'ready' OR sets pending-pickup flag on confirmed order
// Updates: orders.delivery_method = 'pickup', delivery_scheduled_at, delivery_window
// Notifies: AFS admin "Pickup scheduled — Order AFS-XXXX — [date] [window]"
// Sends: customer confirmation email with AFS address and instructions
```

---

*SPEC_PICKUP_SCHEDULING.md | AFS | Reid Whitesides | June 2026*
