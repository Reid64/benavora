# SPEC_NOTIFICATIONS.md
## AFS — Notification System
**Phase 4**
**BLOCKED:** Stage names (#39), SMS number (#75), email sender (#76)

---

## 1. NOTIFICATION TRIGGERS

| Trigger | Email | SMS | Recipient |
|---|---|---|---|
| Quote request submitted | Always | If opted in | Customer |
| Quote request reviewing | No | No | — |
| Formal quote sent to customer | Always | Always if opted in | Customer |
| Order submitted (payment confirmed) | Always | If opted in | Customer + Admin |
| Order in production queue | Always | No | Customer |
| Fabrication started | Always | If opted in | Customer |
| Order ready | Always | If opted in | Customer |
| Order shipped | Always | If opted in | Customer |
| Delivery scheduled | Always | If opted in | Customer |
| Order delivered | Always | No | Customer |
| Pre-ship photo uploaded | Always | No | Customer |
| New credit application | Always | No | Admin |
| New architect registration | Always | No | Admin |

---

## 2. EMAIL TEMPLATES (14)

```typescript
type EmailTemplateId =
  | 'quote-request-submitted'
  | 'formal-quote-ready'
  | 'order-confirmation'
  | 'order-in-queue'
  | 'fabrication-started'
  | 'order-ready'
  | 'order-shipped'
  | 'delivery-scheduled'
  | 'order-delivered'
  | 'pre-ship-photo'
  | 'admin-new-order'
  | 'admin-new-credit-application'
  | 'account-confirmation'
  | 'magic-link'
  | 'password-reset'
  | 'team-invitation';
```

AFS email design:
- Dark header (#1A1A1E) with AFS logo in bg-dim container
- Crimson accent bar below header
- White content area (email client compatibility)
- Arial/Helvetica body (web fonts not reliable in email)
- Max-width: 600px centered
- [View in Account] CTA button: crimson background, white text

---

## 3. SMS TEMPLATES

```typescript
// Under 160 characters each:
const SMS_TEMPLATES = {
  'formal-quote-ready':    'AFS: Your quote for {summary} is ready. Review: {url}',
  'order-confirmation':    'AFS Order {orderNumber} confirmed. Track: {url}',
  'fabrication-started':   'AFS: Fabrication started on Order {orderNumber}. Track: {url}',
  'order-ready':           'AFS Order {orderNumber} is ready. Track: {url}',
  'order-shipped':         'AFS Order {orderNumber} shipped via {carrier}: {trackingNumber}',
  'delivery-scheduled':    'AFS delivery scheduled {date} {window}. Order {orderNumber}.',
};
```

---

## 4. NOTIFICATION SERVICE

```typescript
// lib/notifications/send.ts

export async function sendOrderNotification(
  orderId:        string,
  templateId:     EmailTemplateId,
  additionalData?:Record<string, string>
): Promise<void> {
  try {
    // 1. Fetch order + user + preferences from Supabase
    // 2. Check email/SMS opt-in preferences per template
    // 3. Build template variables
    // 4. Send email via Resend if opted in or transactional
    // 5. Send SMS via Twilio if sms_opt_in AND phone set
    // 6. Insert notifications record (success or failure)
  } catch (error) {
    // Log but NEVER throw
    // Notification failure must never block order flow
    console.error('[Notification Error]', error);
  }
}
```

---

## 5. NOTIFICATION PREFERENCES UI

```
/account/settings → Notification Preferences section

Email preferences:
  ☑ Quote updates (when your quote request is reviewed + quote sent)
  ☑ Order updates (fabrication stages, shipping)
  ☑ Delivery alerts
  ☐ Marketing (default off)

SMS preferences (only if phone number set):
  ☐ Order updates by text
  ☐ Delivery alerts by text
  "Reply STOP to opt out at any time"
  
Opt-in consent timestamped in profiles record for TCPA compliance
```

---

*SPEC_NOTIFICATIONS.md | AFS | Reid Whitesides | June 2026*
