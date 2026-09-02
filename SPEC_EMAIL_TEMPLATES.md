# SPEC_EMAIL_TEMPLATES.md
## AFS — Email Template Library
**Phase 4 — All 14 templates**

---

## TEMPLATE INVENTORY

| ID | Subject | Trigger |
|---|---|---|
| quote-request-submitted | Your AFS Quote Request — #{number} | Customer submits request |
| formal-quote-ready | Your AFS Quote is Ready — #{number} | Estimator sends formal quote |
| order-confirmation | Order Confirmed — AFS #{number} | Payment succeeds |
| order-in-queue | Your Order is Scheduled | Status → in_queue |
| fabrication-started | We're Building Your Order — AFS #{number} | Status → cutting |
| order-ready | Your Order is Ready — AFS #{number} | Status → ready |
| order-shipped | Your Order Has Shipped — AFS #{number} | Status → shipped |
| delivery-scheduled | Delivery Scheduled — AFS #{number} | Delivery booked |
| order-delivered | Order Delivered — AFS #{number} | Status → delivered |
| pre-ship-photo | Your Order Photos — AFS #{number} | Admin uploads photo |
| admin-new-order | 🔴 New Order — AFS #{number} | Any new order |
| account-confirmation | Confirm Your AFS Account | Registration |
| password-reset | Reset Your AFS Password | Password reset |
| team-invitation | You've Been Invited to Join {company} | Team invite |

---

## KEY TEMPLATE CONTENT

### quote-request-submitted
```
"We received your quote request, {firstName}."
Request number: {requestNumber}
Summary of profiles requested (first 3 items)
"AFS will review your specifications and send a formal quote to your account."
[View Your Request] → /account/quotes
```

### formal-quote-ready
```
"Your formal quote is ready, {firstName}."
Quote number, valid until date
Total: {total} (AFS-set price — first time customer sees price)
[Review and Approve Quote] → /account/quotes/{id} (primary CTA)
"Quote expires in X days."
```

### order-shipped
```
"Your order is on its way."
Carrier: {carrier}
Tracking: {trackingNumber} (linked to carrier)
Estimated delivery: {date}
[Track Shipment] → carrier URL
```

### admin-new-order
```
Subject: "🔴 New Order — AFS {orderNumber}"
Customer: name, company, email
Profile summary: first 3 items
Total: {total}
Is Rush: Yes/No (red if rush)
[Open in Admin] → /admin/orders/{id}
```

---

*SPEC_EMAIL_TEMPLATES.md | AFS | Reid Whitesides | June 2026*
