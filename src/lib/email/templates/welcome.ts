import { ctaButton, emailLayout, EMAIL_COLORS } from "./base-layout";

export interface WelcomeEmailParams {
  orgName: string;
  adminName: string;
  appUrl?: string;
}

export function welcomeEmail(
  params: WelcomeEmailParams,
): { subject: string; html: string } {
  const { orgName, adminName, appUrl = "https://benavora.com" } = params;

  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:14px;color:${EMAIL_COLORS.textSecondary}">Hi ${adminName},</p>
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:800;color:${EMAIL_COLORS.textPrimary}">
      Welcome to Benavora
    </h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${EMAIL_COLORS.textPrimary}">
      ${orgName} is now live on Benavora. Your AI grant team is already at work — discovering
      opportunities, scoring probability of award, and drafting narratives while you sleep.
    </p>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${EMAIL_COLORS.textPrimary}">
      Every draft and every autonomous action stays in review until you approve it — nothing is
      ever submitted on your behalf without a human sign-off.
    </p>
    ${ctaButton(`${appUrl}/dashboard`, "Go to Your Dashboard")}
  `;

  return {
    subject: "Welcome to Benavora — Your AI grant team is ready",
    html: emailLayout({ headerLabel: "Welcome", bodyHtml }),
  };
}
