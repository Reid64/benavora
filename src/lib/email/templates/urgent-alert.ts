import { ctaButton, emailLayout, EMAIL_COLORS } from "./base-layout";

export interface UrgentAlertEmailParams {
  orgName: string;
  alertTitle: string;
  alertBody: string;
  actionUrl: string;
  actionLabel: string;
}

const URGENT_RED = "#DC2626";

export function urgentAlertEmail(
  params: UrgentAlertEmailParams,
): { subject: string; html: string } {
  const { orgName, alertTitle, alertBody, actionUrl, actionLabel } = params;

  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:14px;color:${EMAIL_COLORS.textSecondary}">Hi ${orgName},</p>
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:800;color:${URGENT_RED}">
      ${alertTitle}
    </h1>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${EMAIL_COLORS.textPrimary}">
      ${alertBody}
    </p>
    ${ctaButton(actionUrl, actionLabel, URGENT_RED)}
  `;

  return {
    subject: `⚠️ Action Required: ${alertTitle}`,
    html: emailLayout({ headerColor: URGENT_RED, headerLabel: "Action Required", bodyHtml }),
  };
}
