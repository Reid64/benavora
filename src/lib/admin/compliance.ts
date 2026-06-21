import "server-only";

import { createHmac } from "crypto";

export type ComplianceResult = {
  compliant: boolean;
  violations: string[];
  modified_body?: string;
};

const HMAC_SECRET = process.env.UNSUBSCRIBE_HMAC_SECRET ?? "benavora-unsubscribe-secret";

const PHYSICAL_ADDRESS = "Benavora Inc., 123 Main Street, Suite 100, New York, NY 10001";

const ALLOWED_SENDING_DOMAINS = ["benavora.com", "benavora.io", "benavoura.com"];

export class EmailComplianceEngine {
  enforceCompliance(email: {
    from: string;
    to: string;
    subject: string;
    body_html: string;
  }): ComplianceResult {
    const violations: string[] = [];

    // 1. From address uses a real, registered sending domain
    const fromMatch = email.from.match(/@([\w.-]+)$/);
    const fromDomain = fromMatch?.[1]?.toLowerCase() ?? "";
    if (!fromDomain || !ALLOWED_SENDING_DOMAINS.includes(fromDomain)) {
      violations.push(`From domain "${fromDomain}" is not an approved sending domain`);
    }

    // 2. Subject line is not deceptive (no RE: or FW: on initial outreach)
    if (/^(re|fw|fwd)\s*:/i.test(email.subject.trim())) {
      violations.push(`Subject line starts with RE:/FW: which is deceptive for initial outreach`);
    }

    // 3. Body includes physical mailing address
    const hasAddress = email.body_html.includes(PHYSICAL_ADDRESS) ||
      /\d+\s+\w+.*(?:street|st|avenue|ave|road|rd|blvd|lane|ln|drive|dr)/i.test(email.body_html);
    if (!hasAddress) {
      violations.push("Body is missing required physical mailing address");
    }

    // 4. Body includes unsubscribe link
    const hasUnsubscribe = /benavora\.com\/unsubscribe/i.test(email.body_html);
    if (!hasUnsubscribe) {
      violations.push("Body is missing required unsubscribe link");
    }

    // 5. From name identifies the sender
    const fromNameMatch = email.from.match(/^"?([^"<]+)"?\s*</);
    const fromName = fromNameMatch?.[1]?.trim() ?? "";
    if (!fromName || fromName.length < 2) {
      violations.push("From address does not identify the sender by name");
    }

    const compliant = violations.length === 0;
    let modified_body: string | undefined;

    if (!compliant) {
      let body = email.body_html;

      // Auto-fix: add footer with address + unsubscribe if missing
      if (!hasAddress || !hasUnsubscribe) {
        const footer = this.getComplianceFooter(fromDomain, email.to);
        // Insert before </body> if present, otherwise append
        if (/<\/body>/i.test(body)) {
          body = body.replace(/<\/body>/i, `${footer}</body>`);
        } else {
          body = body + footer;
        }
        modified_body = body;
      }
    }

    return { compliant, violations, modified_body };
  }

  generateUnsubscribeToken(email: string): string {
    return createHmac("sha256", HMAC_SECRET).update(email.toLowerCase()).digest("hex");
  }

  verifyUnsubscribeToken(email: string, token: string): boolean {
    const expected = this.generateUnsubscribeToken(email);
    // Constant-time comparison to prevent timing attacks
    if (expected.length !== token.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
    }
    return diff === 0;
  }

  getComplianceFooter(fromDomain: string, recipientEmail?: string): string {
    const email = recipientEmail ?? "";
    const encodedEmail = encodeURIComponent(email);
    const token = email ? this.generateUnsubscribeToken(email) : "";
    const unsubscribeUrl = `https://benavora.com/unsubscribe?email=${encodedEmail}&token=${token}`;

    return `
<div style="margin-top:40px;padding-top:20px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;text-align:center;">
  <p>${PHYSICAL_ADDRESS}</p>
  <p>You are receiving this email because you were identified as a potential partner for Benavora's grant writing services.</p>
  <p><a href="${unsubscribeUrl}" style="color:#6b7280;">Unsubscribe</a> from future emails. Domain: ${fromDomain}</p>
</div>`;
  }
}
