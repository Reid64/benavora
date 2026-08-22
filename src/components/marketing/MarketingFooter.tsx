import Link from "next/link";
import { Logo } from "@/components/layout/Logo";
import { mk } from "@/lib/marketing/theme";
import { FOOTER_COLUMNS } from "@/lib/marketing/nav";

export function MarketingFooter() {
  const year = new Date().getFullYear();

  return (
    <footer style={{ background: mk.forest, color: mk.heroText }}>
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "56px 24px 32px",
          display: "grid",
          gridTemplateColumns: "1.2fr repeat(3, 1fr)",
          gap: 32,
        }}
      >
        <div>
          <Logo size={36} showWordmark />
          <p style={{ color: mk.heroMuted, fontSize: 13, marginTop: 12, maxWidth: 240 }}>
            AI grant automation for nonprofits.
          </p>
        </div>

        {FOOTER_COLUMNS.map((column) => (
          <div key={column.heading}>
            <div style={{ color: mk.heroText, fontWeight: 600, fontSize: 13, marginBottom: 12 }}>
              {column.heading}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {column.links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  style={{ color: mk.heroMuted, fontSize: 13, textDecoration: "none" }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLAnchorElement).style.color = mk.heroText;
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLAnchorElement).style.color = mk.heroMuted;
                  }}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          borderTop: `1px solid rgba(247,245,239,0.15)`,
          padding: "16px 24px",
          maxWidth: 1200,
          margin: "0 auto",
        }}
      >
        <p style={{ color: mk.heroMuted, fontSize: 12 }}>
          Copyright {year} Benavora. All rights reserved.
        </p>
      </div>
    </footer>
  );
}

export default MarketingFooter;
