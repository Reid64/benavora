# SPEC_TWILIO_INTEGRATION.md
## AFS — Twilio SMS Integration
**Phase 4**
**BLOCKED:** AFS outbound SMS number (#75)

---

## 1. CONFIGURATION

```typescript
// lib/twilio/client.ts
import twilio from 'twilio';
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
);
export const FROM_NUMBER = process.env.TWILIO_FROM_NUMBER!; // BLOCKED
```

---

## 2. A10DLC REGISTRATION

```
REQUIRED before any business SMS can be sent in the US.
Registration at twilio.com/trust-hub.
Process: 2–6 weeks for carrier approval.
START THIS IMMEDIATELY — it is a hard timeline dependency.

Options:
  A10DLC long code: standard business number, recommended
  Toll-free: 0-800 style, requires separate registration
  Short code: most deliverable, most expensive
```

---

## 3. SMS SEND

```typescript
// lib/twilio/sms.ts
export async function sendSMS(to: string, body: string): Promise<void> {
  // Normalize to E.164 format
  if (!to.startsWith('+')) to = '+1' + to.replace(/\D/g, '');
  try {
    await client.messages.create({ from: FROM_NUMBER, to, body });
  } catch (error) {
    // Log — NEVER throw
    console.error('[Twilio Error]', error);
  }
}
```

---

## 4. OPT-OUT HANDLING

```typescript
// app/api/webhooks/twilio/route.ts
// Verifies Twilio signature header
// On STOP message received:
//   Update profiles.sms_opt_in = false for matching phone number
//   Log to notifications table
// On other inbound message:
//   Auto-reply: "For support, visit {url} or call {phone}"
```

---

*SPEC_TWILIO_INTEGRATION.md | AFS | Reid Whitesides | June 2026*
