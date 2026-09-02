# SPEC_RESEND_INTEGRATION.md
## AFS — Resend Email Integration
**Phase 4**
**BLOCKED:** Sender email (#76), AFS contact info (#5)

---

## 1. CONFIGURATION

```typescript
// lib/resend/client.ts
import { Resend } from 'resend';
export const resend = new Resend(process.env.RESEND_API_KEY!);
export const FROM_EMAIL = process.env.RESEND_FROM_EMAIL!; // BLOCKED
export const FROM_NAME = 'AFS Architectural Flashing Supply';

// Domain verification required (DNS TXT + DKIM records)
// BLOCKED: domain unknown until checklist #50 received
```

---

## 2. SEND PATTERN

```typescript
// lib/resend/send.ts
export async function sendEmail(opts: {
  to:      string;
  subject: string;
  html:    string;
  replyTo?:string;
}): Promise<void> {
  try {
    await resend.emails.send({
      from:     `${FROM_NAME} <${FROM_EMAIL}>`,
      to:       opts.to,
      subject:  opts.subject,
      html:     opts.html,
      reply_to: opts.replyTo ?? FROM_EMAIL,
    });
  } catch (error) {
    // Log — NEVER throw — email failure must not block order flow
    console.error('[Resend Error]', error);
  }
}
```

---

## 3. BASE EMAIL TEMPLATE

```typescript
// lib/resend/templates/base.ts
export function baseEmailTemplate(content: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;background:#1A1A1E;font-family:Arial,Helvetica,sans-serif;">
  <!-- Dark header -->
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td style="background:#1A1A1E;padding:24px 0;text-align:center;">
      <span style="font-size:28px;font-weight:700;color:#D8E0EC;letter-spacing:4px;">AFS</span>
      <div style="font-size:10px;color:#6B7A94;letter-spacing:3px;margin-top:4px;">
        ARCHITECTURAL FLASHING SUPPLY
      </div>
    </td></tr>
    <!-- Crimson accent bar -->
    <tr><td style="background:#C0001A;height:3px;"></td></tr>
    <!-- White content area -->
    <tr><td style="background:#FFFFFF;padding:40px 32px;max-width:600px;">
      ${content}
    </td></tr>
    <!-- Footer -->
    <tr><td style="background:#1A1A1E;padding:24px;text-align:center;">
      <p style="color:#6B7A94;font-size:12px;margin:0;">
        AFS Architectural Flashing Supply<br>
        [ADDRESS BLOCKED — checklist #5]<br>
        <a href="{unsubscribeUrl}" style="color:#6B7A94;">Unsubscribe</a>
      </p>
    </td></tr>
  </table>
</body>
</html>`;
}
```

---

*SPEC_RESEND_INTEGRATION.md | AFS | Reid Whitesides | June 2026*
