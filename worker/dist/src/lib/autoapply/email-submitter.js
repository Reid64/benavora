"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitViaEmail = submitViaEmail;
const resend_1 = require("resend");
let _resend = null;
function getResend() {
    if (_resend === null) {
        const key = process.env.RESEND_API_KEY;
        if (!key)
            throw new Error("RESEND_API_KEY is not configured");
        _resend = new resend_1.Resend(key);
    }
    return _resend;
}
function buildSubject(organizationName, requestType) {
    if (requestType === "monetary") {
        return `Grant/Donation Request from ${organizationName}`;
    }
    return `Partnership Inquiry from ${organizationName}`;
}
function buildGreeting(contactName) {
    if (contactName)
        return `Dear ${contactName},`;
    return "Dear Grants Committee,";
}
function buildAmountLine(requestType, askAmount) {
    if (requestType !== "monetary" || askAmount == null)
        return "";
    const formatted = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(askAmount);
    return `<p>We are respectfully requesting support in the amount of <strong>${formatted}</strong>.</p>`;
}
function buildRequestTypeLabel(requestType) {
    const labels = {
        monetary: "financial support",
        land: "land donation",
        in_kind: "in-kind contribution",
        volunteer: "volunteer partnership",
        service: "pro bono services",
        partnership: "program partnership",
        sponsorship: "sponsorship",
        facility: "facility support",
    };
    return labels[requestType] ?? requestType.replace(/_/g, " ");
}
function buildHtmlBody(params) {
    const { funderName, contactName, organizationName, personalizedPitch, requestType, askAmount, contactEmail, contactPhone, } = params;
    const greeting = buildGreeting(contactName);
    const amountLine = buildAmountLine(requestType, askAmount);
    const requestLabel = buildRequestTypeLabel(requestType);
    const phoneBlock = contactPhone ? `<br>Phone: ${contactPhone}` : "";
    const pitchParagraphs = personalizedPitch
        .split("\n")
        .filter(Boolean)
        .map((line) => `  <p>${line}</p>`)
        .join("\n");
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Georgia, serif; color: #222; max-width: 680px; margin: 0 auto; padding: 32px 16px; line-height: 1.7;">

  <p>${greeting}</p>

  <p>Writing on behalf of <strong>${organizationName}</strong>, a 501(c)(3) nonprofit organization,
  to respectfully inquire about a ${requestLabel} from ${funderName}.</p>

${pitchParagraphs}

  ${amountLine}

  <p>We believe our work aligns with your mission and would welcome the opportunity to explore how
  we might partner together. Please find our contact information below, and do not hesitate to
  reach out with questions or to request additional documentation.</p>

  <p>
    <strong>${organizationName}</strong><br>
    501(c)(3) Tax-Exempt Organization<br>
    Email: <a href="mailto:${contactEmail}">${contactEmail}</a>${phoneBlock}
  </p>

  <p>Thank you sincerely for your time and for the generosity you extend to organizations like ours.
  We look forward to hearing from you.</p>

  <p>With gratitude,<br>
  <strong>${organizationName}</strong></p>

  <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;">
  <p style="font-size: 11px; color: #888;">
    ${organizationName} is a registered 501(c)(3) nonprofit organization. Donations may be
    tax-deductible to the extent permitted by law.
  </p>

</body>
</html>`;
}
async function submitViaEmail(params) {
    const resend = getResend();
    const subject = buildSubject(params.organizationName, params.requestType);
    const html = buildHtmlBody(params);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sendParams = {
        from: `${params.organizationName} via Benavora <notifications@benavora.com>`,
        to: params.funderEmail,
        reply_to: params.contactEmail,
        subject,
        html,
    };
    if (params.attachments && params.attachments.length > 0) {
        sendParams["attachments"] = params.attachments.map((a) => ({
            filename: a.filename,
            content: a.content,
        }));
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await resend.emails.send(sendParams);
    if (error !== null || data === null) {
        throw new Error(`Resend send failed: ${error?.message ?? "no response data"}`);
    }
    return {
        messageId: data.id,
        status: "sent",
    };
}
