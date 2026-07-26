"use client";

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Radar, Telescope, X, type LucideIcon } from "lucide-react";

import {
  DONOR_DISCOVERY_NAV_ITEMS,
  navItemsForRole,
  PLATFORM_NAV_ITEMS,
  PROGRAMS_NAV_ITEMS,
  RESOURCES_NAV_ITEMS,
  SETTINGS_NAV_ITEM,
} from "@/components/layout/nav-items";
import { Logo } from "@/components/layout/Logo";
import { rememberedHref } from "@/lib/navigation/section-memory";
import type { Enums } from "@/types/database";

type NavCounts = {
  alerts: number;
  applications: number;
  documents: number;
  deadlines: number;
  strategicRecommendations: number;
  improvementsProposed: number;
  opportunities: number;
  pendingReview: number;
  donorIntent: number;
  communityNeed: number;
  autoapplyQueued: number;
};

const NAV_COUNTS_POLL_MS = 60_000;
const ICON_SIZE = 15;

type SidebarProps = {
  /** Whether the mobile drawer is open. Ignored at lg+ where the sidebar is static. */
  open: boolean;
  /** Close the mobile drawer (backdrop tap, link click, or close button). */
  onClose: () => void;
  /** Caller's role — gates role-restricted items and the platform section. */
  role: Enums<"user_role"> | undefined;
  /** Whether onboarding is complete. */
  onboardingCompleted: boolean;
  /** Organization name — shown at the bottom of the rail, under Settings. */
  orgName: string;
};

const SECTION_LABEL_STYLE: CSSProperties = {
  fontSize: "10px",
  fontWeight: 700,
  letterSpacing: "0.12em",
  color: "rgba(248,250,252,0.3)",
  textTransform: "uppercase",
  padding: "12px 12px 6px",
  margin: 0,
};

/** Nav item style per the dark premium reskin spec — inline hex only (BLUEPRINT §7.5). */
function navItemStyle(active: boolean, hovered: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "9px 12px",
    borderRadius: "8px",
    color: active ? "#00B4D8" : hovered ? "#67E8F9" : "rgba(248,250,252,0.7)",
    fontSize: "13px",
    fontWeight: active ? 600 : 500,
    textDecoration: "none",
    backgroundColor: active
      ? "rgba(0,180,216,0.12)"
      : hovered
        ? "rgba(103,232,249,0.08)"
        : "transparent",
    marginBottom: "1px",
    transition: "all 0.15s",
  };
}

/** Formats a raw count per the nav-badge display rule: 0 hides, 10+ shows "9+". */
function badgeLabel(count: number): string {
  return count >= 10 ? "9+" : String(count);
}

const BADGE_CIRCLE_STYLE: CSSProperties = {
  position: "absolute",
  top: -4,
  right: -6,
  width: 16,
  height: 16,
  borderRadius: "50%",
  backgroundColor: "#EF4444",
  color: "#FFFFFF",
  fontSize: "9px",
  fontWeight: 700,
  lineHeight: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

/** A 16px circle badge overlaid top-right of the icon it wraps. Hidden at 0. */
function IconWithBadge({ icon: Icon, count }: { icon: LucideIcon; count: number }) {
  return (
    <span style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
      <Icon style={{ width: ICON_SIZE, height: ICON_SIZE, flexShrink: 0 }} aria-hidden />
      {count > 0 && (
        <span
          style={BADGE_CIRCLE_STYLE}
          aria-label={`${count} ${count === 1 ? "item needs" : "items need"} attention`}
        >
          {badgeLabel(count)}
        </span>
      )}
    </span>
  );
}

type NavLinkProps = {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  badge?: number;
  id?: string;
  onClick?: () => void;
  iconColor?: (active: boolean) => string;
};

/** A single sidebar nav row — owns its own hover state (spec: onMouseEnter/onMouseLeave toggle). */
function NavLink({ href, label, icon, active, badge = 0, id, onClick, iconColor }: NavLinkProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <Link
      href={href}
      id={id}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      style={navItemStyle(active, hovered)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {iconColor ? (
        <Icon icon={icon} color={iconColor(active)} />
      ) : (
        <IconWithBadge icon={icon} count={badge} />
      )}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
    </Link>
  );
}

/** Bare icon with an explicit color override — used where a nav item's icon
 * carries its own semantic color instead of the shared badge treatment
 * (e.g. Programs section's green icon). */
function Icon({ icon: LucideComp, color }: { icon: LucideIcon; color: string }) {
  return <LucideComp style={{ width: ICON_SIZE, height: ICON_SIZE, flexShrink: 0, color }} aria-hidden />;
}

/** Inline circle badge for text-only sub-links that have no icon to overlay. */
function NavBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      style={{ ...BADGE_CIRCLE_STYLE, position: "static", marginLeft: "auto" }}
      aria-label={`${count} ${count === 1 ? "item needs" : "items need"} attention`}
    >
      {badgeLabel(count)}
    </span>
  );
}

/** An indented child (sub-nav) row — same owns-its-own-hover-state pattern as NavLink. */
function ChildNavLink({
  href,
  label,
  active,
  badge = 0,
  onClick,
}: {
  href: string;
  label: string;
  active: boolean;
  badge?: number;
  onClick?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        borderRadius: "6px",
        padding: "6px 12px",
        fontSize: "12px",
        fontWeight: 500,
        textDecoration: "none",
        color: active ? "#00B4D8" : hovered ? "#67E8F9" : "rgba(248,250,252,0.7)",
        backgroundColor: active
          ? "rgba(0,180,216,0.12)"
          : hovered
            ? "rgba(103,232,249,0.08)"
            : "transparent",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {active && (
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: "4px",
            height: "4px",
            borderRadius: "50%",
            backgroundColor: "#00B4D8",
            marginRight: "8px",
            flexShrink: 0,
          }}
        />
      )}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <NavBadge count={badge} />
    </Link>
  );
}

/**
 * Dashboard sidebar navigation — dark premium brand rail.
 * - Static rail on lg+ screens.
 * - Slide-in drawer with backdrop on mobile, controlled by `open`.
 * - The nav item whose route matches the current path is highlighted in cyan.
 */
export function Sidebar({ open, onClose, role, onboardingCompleted, orgName }: SidebarProps) {
  const pathname = usePathname();
  const navItems = navItemsForRole(role, { onboardingCompleted });
  const isPlatformAdmin = role === "owner" || role === "admin";
  const [closeHovered, setCloseHovered] = useState(false);

  // Lightweight badge counts from a single API call.
  const [navCounts, setNavCounts] = useState<NavCounts>({
    alerts: 0,
    applications: 0,
    documents: 0,
    deadlines: 0,
    strategicRecommendations: 0,
    improvementsProposed: 0,
    opportunities: 0,
    pendingReview: 0,
    donorIntent: 0,
    communityNeed: 0,
    autoapplyQueued: 0,
  });

  const fetchCounts = useCallback(async () => {
    try {
      const res = await fetch("/api/nav-counts", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as NavCounts;
        setNavCounts(data);
      }
    } catch {
      // Non-fatal — badges simply stay at zero.
    }
  }, []);

  useEffect(() => {
    void fetchCounts();
    const interval = setInterval(() => void fetchCounts(), NAV_COUNTS_POLL_MS);
    return () => clearInterval(interval);
  }, [fetchCounts]);

  // Re-fetch on navigation so badges update after the user acts on items.
  useEffect(() => {
    void fetchCounts();
  }, [pathname, fetchCounts]);

  // Resolve each item's href to the section's remembered location (restoring
  // saved filters/search/sort/view). Computed after mount — sessionStorage is
  // unavailable during SSR, so the first render uses the plain hrefs to keep
  // server and client markup identical (no hydration mismatch).
  const [hrefs, setHrefs] = useState<Record<string, string>>({});
  useEffect(() => {
    const resolved: Record<string, string> = {};
    for (const item of navItemsForRole(role, { onboardingCompleted })) {
      resolved[item.href] = rememberedHref(item.href);
    }
    resolved[SETTINGS_NAV_ITEM.href] = rememberedHref(SETTINGS_NAV_ITEM.href);
    setHrefs(resolved);
  }, [pathname, role, onboardingCompleted]);

  const badgeByHref: Record<string, number> = {
    "/alerts": navCounts.alerts,
    // Applications badge is AI drafts awaiting human review (pending_review),
    // not the older stage-based count — see nav-counts route.
    "/applications": navCounts.pendingReview,
    "/documents": navCounts.documents,
    "/deadlines": navCounts.deadlines,
    // Same corporate_intent_signals count already computed for
    // /intelligence/donor-intent's badge — reused here for the
    // donor-discovery drilldown's Intent Signals link.
    "/donor-discovery/intent-signals": navCounts.donorIntent,
  };

  // Donor Discovery's drilldown links each get their own icon, matched by
  // href since NavChild (unlike NavItem) carries no icon field of its own.
  const donorDiscoveryIconByHref: Record<string, LucideIcon> = {
    "/donor-discovery/prospects": Telescope,
    "/donor-discovery/intent-signals": Radar,
  };

  // Child (sub-nav) badges — separate map since NavChild has no badge field
  // of its own.
  const childBadgeByHref: Record<string, number> = {
    "/intelligence/strategic-advisor": navCounts.strategicRecommendations,
    "/intelligence/donor-intent": navCounts.donorIntent,
    "/intelligence/community-need": navCounts.communityNeed,
  };

  // Platform admin section badges — separate map, same reasoning as above.
  const platformBadgeByHref: Record<string, number> = {
    "/admin/improvements": navCounts.improvementsProposed,
  };

  function isActive(href: string): boolean {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          style={{ backgroundColor: "rgba(15,23,42,0.6)", backdropFilter: "blur(4px)" }}
          aria-hidden
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 transition-transform duration-300 ease-in-out lg:static lg:z-auto lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{
          width: "240px",
          minHeight: "100vh",
          backgroundColor: "#162032",
          display: "flex",
          flexDirection: "column",
          borderRight: "1px solid rgba(255,255,255,0.06)",
          flexShrink: 0,
        }}
        aria-label="Primary navigation"
      >
        {/* Logo area */}
        <div
          style={{
            padding: "20px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "10px",
          }}
        >
          <Link href="/dashboard" aria-label="Benavora - go to dashboard">
            {/* Desktop: full wordmark + tagline */}
            <div className="hidden lg:flex" style={{ flexDirection: "column" }}>
              <Logo />
              <span style={{ fontSize: "11px", color: "rgba(248,250,252,0.4)", marginTop: "2px" }}>
                Fund More. Do More. Change More.
              </span>
            </div>
            {/* Mobile drawer: icon only, no tagline */}
            <Logo size={32} showWordmark={false} className="lg:hidden" />
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="lg:hidden"
            style={{
              border: "none",
              borderRadius: "6px",
              padding: "6px",
              cursor: "pointer",
              color: closeHovered ? "#F8FAFC" : "rgba(248,250,252,0.6)",
              backgroundColor: closeHovered ? "rgba(255,255,255,0.06)" : "transparent",
              transition: "all 0.15s",
            }}
            onMouseEnter={() => setCloseHovered(true)}
            onMouseLeave={() => setCloseHovered(false)}
            aria-label="Close navigation"
          >
            <X style={{ width: 18, height: 18 }} aria-hidden />
          </button>
        </div>

        {/* Main nav links */}
        <nav style={{ flex: "1", padding: "12px 8px", overflowY: "auto" }} aria-label="Main navigation">
          {pathname.startsWith("/donor-discovery") && (
            <div style={{ marginBottom: "8px" }}>
              <p style={SECTION_LABEL_STYLE}>Donor Discovery</p>
              {DONOR_DISCOVERY_NAV_ITEMS.map((item) => {
                const active = isActive(item.href);
                const badge = badgeByHref[item.href] ?? 0;
                const ItemIcon = donorDiscoveryIconByHref[item.href] ?? Telescope;
                return (
                  <NavLink
                    key={item.href}
                    href={item.href}
                    label={item.label}
                    icon={ItemIcon}
                    active={active}
                    badge={badge}
                    onClick={onClose}
                  />
                );
              })}
            </div>
          )}
          <div>
            {navItems.map(({ label, href, icon: ItemIcon, children }) => {
              const active = isActive(href);
              const badge = badgeByHref[href] ?? 0;
              return (
                <div key={href}>
                  <NavLink
                    href={hrefs[href] ?? href}
                    label={label}
                    icon={ItemIcon}
                    active={active}
                    badge={badge}
                    id={href === "/intelligence-library" ? "tour-nav-intelligence-library" : undefined}
                    onClick={onClose}
                  />
                  {active && children && children.length > 0 && (
                    <div style={{ marginLeft: "23px", marginTop: "2px" }}>
                      {children.map((child) => {
                        const childActive = pathname === child.href;
                        const childBadge = childBadgeByHref[child.href] ?? 0;
                        return (
                          <ChildNavLink
                            key={child.href}
                            href={child.href}
                            label={child.label}
                            active={childActive}
                            badge={childBadge}
                            onClick={onClose}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Programs section — org-facing feature programs (e.g. SchoolFunder) */}
          <div style={{ marginTop: "8px" }}>
            <p style={SECTION_LABEL_STYLE}>Programs</p>
            <div>
              {PROGRAMS_NAV_ITEMS.map(({ label, href, icon: ItemIcon }) => {
                const active = isActive(href);
                return (
                  <NavLink
                    key={href}
                    href={href}
                    label={label}
                    icon={ItemIcon}
                    active={active}
                    onClick={onClose}
                    iconColor={(isActiveNow) => (isActiveNow ? "#FFFFFF" : "#10B981")}
                  />
                );
              })}
            </div>
          </div>

          {/* Resources section — shared public reference directories */}
          <div style={{ marginTop: "8px" }}>
            <p style={SECTION_LABEL_STYLE}>Resources</p>
            <div>
              {RESOURCES_NAV_ITEMS.map(({ label, href, icon: ItemIcon }) => {
                const active = isActive(href);
                return (
                  <NavLink key={href} href={href} label={label} icon={ItemIcon} active={active} onClick={onClose} />
                );
              })}
            </div>
          </div>

          {/* Platform admin section */}
          {isPlatformAdmin && (
            <div style={{ marginTop: "8px" }}>
              <p style={SECTION_LABEL_STYLE}>Platform</p>
              <div>
                {PLATFORM_NAV_ITEMS.map(({ label, href, icon: ItemIcon }) => {
                  const active = isActive(href);
                  const badge = platformBadgeByHref[href] ?? 0;
                  return (
                    <NavLink
                      key={href}
                      href={href}
                      label={label}
                      icon={ItemIcon}
                      active={active}
                      badge={badge}
                      onClick={onClose}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </nav>

        {/* Settings + org identity — bottom, separated */}
        <div style={{ padding: "16px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <NavLink
            href={hrefs[SETTINGS_NAV_ITEM.href] ?? SETTINGS_NAV_ITEM.href}
            label={SETTINGS_NAV_ITEM.label}
            icon={SETTINGS_NAV_ITEM.icon}
            active={isActive(SETTINGS_NAV_ITEM.href)}
            id="tour-nav-settings"
            onClick={onClose}
          />
          <p style={{ margin: 0, marginTop: "10px", fontSize: "12px", fontWeight: 600, color: "rgba(248,250,252,0.8)" }}>
            {orgName}
          </p>
          <p style={{ margin: 0, marginTop: "2px", fontSize: "11px", color: "rgba(248,250,252,0.4)" }}>
            Nonprofit funding automation
          </p>
        </div>
      </aside>
    </>
  );
}
