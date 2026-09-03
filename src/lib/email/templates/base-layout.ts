// Shared HTML shell for transactional emails — dark navy header with the
// Benavora wordmark, white body, brand-blue CTA button. Colors per
// BLUEPRINT_v2.md §7.1 (locked palette). Not itself one of the four
// templates — a shared internal building block so draft-ready.ts,
// morning-digest.ts, urgent-alert.ts, and welcome.ts don't each re-implement
// the same boilerplate shell.

const NAVY = "#2C4E3B";
const OCEAN_BLUE = "#3D6B50";
const TEXT_PRIMARY = "#0F172A";
const TEXT_SECONDARY = "#64748B";
const BORDER = "#E2E8F0";

export function emailLayout(params: {
  headerColor?: string;
  headerLabel?: string;
  bodyHtml: string;
}): string {
  const { headerColor = NAVY, headerLabel, bodyHtml } = params;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:'Plus Jakarta Sans',Arial,sans-serif;color:${TEXT_PRIMARY}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:32px 0">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:12px;overflow:hidden;max-width:600px;width:100%">
          <tr>
            <td style="background:${headerColor};padding:24px 32px">
              <span style="font-size:20px;font-weight:800;color:#FFFFFF;letter-spacing:-0.02em">Benavora</span>
              ${headerLabel ? `<div style="font-size:12px;font-weight:700;color:#FFFFFF;opacity:0.8;text-transform:uppercase;letter-spacing:0.08em;margin-top:4px">${headerLabel}</div>` : ""}
            </td>
          </tr>
          <tr>
            <td style="padding:32px">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;border-top:1px solid ${BORDER}">
              <p style="margin:0;font-size:12px;color:${TEXT_SECONDARY}">
                Benavora — AI-powered nonprofit funding intelligence.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}

export function ctaButton(url: string, label: string, color: string = OCEAN_BLUE): string {
  return `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0">
  <tr>
    <td style="background:${color};border-radius:8px">
      <a href="${url}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:700;color:#FFFFFF;text-decoration:none">${label}</a>
    </td>
  </tr>
</table>`.trim();
}

export const EMAIL_COLORS = {
  navy: NAVY,
  oceanBlue: OCEAN_BLUE,
  textPrimary: TEXT_PRIMARY,
  textSecondary: TEXT_SECONDARY,
  border: BORDER,
};
