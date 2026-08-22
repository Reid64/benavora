"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/layout/Logo";
import { mk, mkRadius } from "@/lib/marketing/theme";
import { PLATFORM, SOLUTIONS, RESOURCES, TOP_LINKS, type NavGroup } from "@/lib/marketing/nav";

const MEGA_GROUPS: NavGroup[] = [PLATFORM, SOLUTIONS, RESOURCES];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

function MegaMenu({ group, open }: { group: NavGroup; open: boolean }) {
  if (!open) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        right: 0,
        background: mk.surface,
        border: `1px solid ${mk.line}`,
        borderTop: "none",
        boxShadow: "0 12px 24px rgba(0,0,0,0.08)",
        zIndex: 50,
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "24px 24px",
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 20,
        }}
      >
        {group.items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            style={{ display: "block", padding: "10px 12px", textDecoration: "none" }}
          >
            <div style={{ color: mk.forest, fontWeight: 600, fontSize: 14 }}>{item.label}</div>
            {item.blurb ? (
              <div style={{ color: mk.muted, fontSize: 13, marginTop: 4 }}>{item.blurb}</div>
            ) : null}
          </Link>
        ))}
      </div>
    </div>
  );
}

function HamburgerIcon({ open }: { open: boolean }) {
  const bar: React.CSSProperties = {
    display: "block",
    width: 22,
    height: 2,
    background: mk.forest,
    borderRadius: 1,
    transition: "transform 0.15s ease, opacity 0.15s ease",
  };
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 5, width: 22 }}>
      <span
        style={{
          ...bar,
          transform: open ? "translateY(7px) rotate(45deg)" : "none",
        }}
      />
      <span style={{ ...bar, opacity: open ? 0 : 1 }} />
      <span
        style={{
          ...bar,
          transform: open ? "translateY(-7px) rotate(-45deg)" : "none",
        }}
      />
    </span>
  );
}

export function MarketingNav() {
  const pathname = usePathname();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileGroup, setMobileGroup] = useState<string | null>(null);

  const toggleGroup = (label: string) => {
    setOpenGroup((prev) => (prev === label ? null : label));
  };

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 100,
        background: mk.paper,
        borderBottom: `1px solid ${mk.line}`,
        height: 64,
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          height: 64,
          padding: "0 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "relative",
        }}
      >
        <Link href="/" aria-label="Benavora home" style={{ display: "flex", alignItems: "center" }}>
          <Logo size={36} showWordmark />
        </Link>

        <nav
          className="mk-desktop-nav"
          style={{ display: "flex", alignItems: "center", gap: 28, height: 64 }}
        >
          {MEGA_GROUPS.map((group) => {
            const active = isActive(pathname, group.href);
            const open = openGroup === group.label;
            return (
              <div
                key={group.label}
                style={{ position: "relative", height: 64, display: "flex", alignItems: "center" }}
                onMouseEnter={() => setOpenGroup(group.label)}
                onMouseLeave={() => setOpenGroup((prev) => (prev === group.label ? null : prev))}
              >
                <button
                  type="button"
                  onClick={() => toggleGroup(group.label)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontSize: 14,
                    color: mk.ink,
                    padding: "4px 0",
                    borderBottom: active ? `2px solid ${mk.terracotta}` : "2px solid transparent",
                  }}
                >
                  {group.label}
                </button>
                <MegaMenu group={group} open={open} />
              </div>
            );
          })}

          {TOP_LINKS.map((link) => {
            const active = isActive(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                style={{
                  fontSize: 14,
                  color: mk.ink,
                  textDecoration: "none",
                  padding: "4px 0",
                  borderBottom: active ? `2px solid ${mk.terracotta}` : "2px solid transparent",
                }}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="mk-desktop-actions" style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Link href="/login" style={{ fontSize: 14, color: mk.forest, textDecoration: "none" }}>
            Sign in
          </Link>
          <Link
            href="/demo"
            style={{
              background: mk.terracotta,
              color: "#FFFFFF",
              borderRadius: mkRadius.cta,
              padding: "8px 14px",
              fontWeight: 600,
              fontSize: 14,
              textDecoration: "none",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.background = mk.terracottaHover;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.background = mk.terracotta;
            }}
          >
            Book demo
          </Link>
        </div>

        <button
          type="button"
          aria-label="Toggle menu"
          className="mk-mobile-toggle"
          onClick={() => setMobileOpen((prev) => !prev)}
          style={{
            display: "none",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 8,
          }}
        >
          <HamburgerIcon open={mobileOpen} />
        </button>
      </div>

      {mobileOpen ? (
        <div
          className="mk-mobile-panel"
          style={{
            background: mk.surface,
            borderTop: `1px solid ${mk.line}`,
            padding: 16,
          }}
        >
          {MEGA_GROUPS.map((group) => (
            <div key={group.label} style={{ marginBottom: 12 }}>
              <button
                type="button"
                onClick={() =>
                  setMobileGroup((prev) => (prev === group.label ? null : group.label))
                }
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  width: "100%",
                  textAlign: "left",
                  fontSize: 15,
                  fontWeight: 600,
                  color: mk.forest,
                  padding: "8px 0",
                }}
              >
                {group.label}
              </button>
              {mobileGroup === group.label ? (
                <div style={{ paddingLeft: 12 }}>
                  {group.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      style={{
                        display: "block",
                        padding: "8px 0",
                        fontSize: 14,
                        color: mk.ink,
                        textDecoration: "none",
                      }}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
          {TOP_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              style={{
                display: "block",
                padding: "10px 0",
                fontSize: 15,
                fontWeight: 600,
                color: mk.forest,
                textDecoration: "none",
              }}
            >
              {link.label}
            </Link>
          ))}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
            <Link
              href="/login"
              onClick={() => setMobileOpen(false)}
              style={{ fontSize: 14, color: mk.forest, textDecoration: "none" }}
            >
              Sign in
            </Link>
            <Link
              href="/demo"
              onClick={() => setMobileOpen(false)}
              style={{
                background: mk.terracotta,
                color: "#FFFFFF",
                borderRadius: mkRadius.cta,
                padding: "10px 14px",
                fontWeight: 600,
                fontSize: 14,
                textDecoration: "none",
                textAlign: "center",
              }}
            >
              Book demo
            </Link>
          </div>
        </div>
      ) : null}

      <style jsx>{`
        @media (max-width: 900px) {
          .mk-desktop-nav {
            display: none !important;
          }
          .mk-desktop-actions {
            display: none !important;
          }
          .mk-mobile-toggle {
            display: flex !important;
          }
        }
      `}</style>
    </header>
  );
}

export default MarketingNav;
