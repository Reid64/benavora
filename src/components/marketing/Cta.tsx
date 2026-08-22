import Link from "next/link";
import type { ReactNode } from "react";
import { mk, mkRadius } from "@/lib/marketing/theme";

type CtaProps = {
  href: string;
  children: ReactNode;
  onDark?: boolean;
};

export function CtaPrimary({ href, children }: CtaProps) {
  return (
    <Link
      href={href}
      style={{
        display: "inline-block",
        background: mk.terracotta,
        color: "#FFFFFF",
        borderRadius: mkRadius.cta,
        padding: "12px 20px",
        fontWeight: 600,
        fontSize: 15,
        textDecoration: "none",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLAnchorElement).style.background = mk.terracottaHover;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLAnchorElement).style.background = mk.terracotta;
      }}
    >
      {children}
    </Link>
  );
}

export function CtaGhost({ href, children, onDark = false }: CtaProps) {
  const borderColor = onDark ? mk.sage : mk.forest;
  const textColor = onDark ? mk.heroText : mk.forest;
  return (
    <Link
      href={href}
      style={{
        display: "inline-block",
        background: "transparent",
        border: `1px solid ${borderColor}`,
        color: textColor,
        borderRadius: mkRadius.cta,
        padding: "12px 20px",
        fontWeight: 600,
        fontSize: 15,
        textDecoration: "none",
      }}
    >
      {children}
    </Link>
  );
}
