import type { ImageCredit } from "@/lib/marketing/image-credits";
import { mk } from "@/lib/marketing/theme";

// Visible attribution required by the photo's Creative Commons / public-domain
// license: title, creator, and license, each linked to a verifiable source.
export function PhotoCredit({ credit, onDark = false }: { credit: ImageCredit; onDark?: boolean }) {
  const color = onDark ? mk.heroMuted : mk.muted;
  const linkColor = onDark ? mk.heroText : mk.ink;
  return (
    <p style={{ fontSize: 12, lineHeight: 1.5, color, margin: "8px 0 0" }}>
      Photo:{" "}
      <a
        href={credit.sourceUrl}
        target="_blank"
        rel="noopener noreferrer nofollow"
        style={{ color: linkColor, textDecoration: "underline", textUnderlineOffset: 2 }}
      >
        {credit.title}
      </a>{" "}
      by{" "}
      <a
        href={credit.creatorUrl}
        target="_blank"
        rel="noopener noreferrer nofollow"
        style={{ color: linkColor, textDecoration: "underline", textUnderlineOffset: 2 }}
      >
        {credit.creator}
      </a>{" "}
      ({credit.provider}), licensed{" "}
      <a
        href={credit.licenseUrl}
        target="_blank"
        rel="noopener noreferrer nofollow"
        style={{ color: linkColor, textDecoration: "underline", textUnderlineOffset: 2 }}
      >
        {credit.licenseLabel}
      </a>
      .
    </p>
  );
}
