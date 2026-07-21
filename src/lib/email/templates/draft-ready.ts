import { ctaButton, emailLayout, EMAIL_COLORS } from "./base-layout";

export interface DraftReadyEmailParams {
  orgName: string;
  draftTitle: string;
  opportunityName: string;
  funderName: string;
  confidenceScore: number;
  reviewUrl: string;
}

function confidenceColor(score: number): string {
  if (score >= 80) return "#10B981";
  if (score >= 60) return "#F59E0B";
  return "#EF4444";
}

export function draftReadyEmail(
  params: DraftReadyEmailParams,
): { subject: string; html: string } {
  const { orgName, draftTitle, opportunityName, funderName, confidenceScore, reviewUrl } = params;

  const badgeColor = confidenceColor(confidenceScore);

  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:14px;color:${EMAIL_COLORS.textSecondary}">Hi ${orgName},</p>
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:800;color:${EMAIL_COLORS.textPrimary}">
      Your AI draft is ready for review
    </h1>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${EMAIL_COLORS.textPrimary}">
      Benavora generated a new grant application draft — <strong>${draftTitle}</strong> — for
      <strong>${opportunityName}</strong> from <strong>${funderName}</strong>. It's waiting in your
      pipeline for human review before anything is submitted.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
      <tr>
        <td style="font-size:13px;color:${EMAIL_COLORS.textSecondary};padding-right:12px">AI Confidence Score</td>
        <td>
          <span style="display:inline-block;padding:4px 12px;border-radius:999px;background:${badgeColor};color:#FFFFFF;font-size:13px;font-weight:700">
            ${confidenceScore}%
          </span>
        </td>
      </tr>
    </table>
    ${ctaButton(reviewUrl, "Review Draft")}
    <p style="margin:0;font-size:13px;color:${EMAIL_COLORS.textSecondary}">
      This draft was generated autonomously and will not be submitted without your approval.
    </p>
  `;

  return {
    subject: `AI Draft Ready for Review: ${opportunityName}`,
    html: emailLayout({ headerLabel: "Draft Ready", bodyHtml }),
  };
}
