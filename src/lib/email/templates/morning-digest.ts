import { ctaButton, emailLayout, EMAIL_COLORS } from "./base-layout";

export interface DigestItem {
  title: string;
  detail: string;
  link?: string;
}

export interface MorningDigestEmailParams {
  orgName: string;
  items: DigestItem[];
  date: string;
  appUrl?: string;
}

const TOP_ITEMS_SHOWN = 5;

export function morningDigestEmail(
  params: MorningDigestEmailParams,
): { subject: string; html: string } {
  const { orgName, items, date, appUrl = "https://benavora.com" } = params;

  const topItems = items.slice(0, TOP_ITEMS_SHOWN);

  const itemsHtml =
    topItems.length > 0
      ? topItems
          .map(
            (item, i) => `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid ${EMAIL_COLORS.border}">
          <span style="display:inline-block;width:24px;height:24px;border-radius:6px;background:${EMAIL_COLORS.oceanBlue};color:#FFFFFF;font-size:12px;font-weight:700;text-align:center;line-height:24px;margin-right:12px">${i + 1}</span>
          <strong style="font-size:14px;color:${EMAIL_COLORS.textPrimary}">${item.title}</strong>
          <div style="margin:4px 0 0 36px;font-size:13px;color:${EMAIL_COLORS.textSecondary}">${item.detail}</div>
        </td>
      </tr>`,
          )
          .join("")
      : `<tr><td style="padding:12px 0;font-size:14px;color:${EMAIL_COLORS.textSecondary}">Nothing urgent overnight — your pipeline is quiet.</td></tr>`;

  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:14px;color:${EMAIL_COLORS.textSecondary}">Hi ${orgName},</p>
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:${EMAIL_COLORS.textPrimary}">
      Your Morning Digest
    </h1>
    <p style="margin:0 0 24px;font-size:13px;color:${EMAIL_COLORS.textSecondary}">${date}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px">
      ${itemsHtml}
    </table>
    ${ctaButton(`${appUrl}/dashboard`, "View Full Dashboard")}
  `;

  return {
    subject: `Your Benavora Morning Digest — ${date}`,
    html: emailLayout({ headerLabel: "Morning Digest", bodyHtml }),
  };
}
