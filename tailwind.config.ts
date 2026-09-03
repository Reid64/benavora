import type { Config } from "tailwindcss";

/**
 * Benavora brand theme — warm nonprofit palette (supersedes the prior
 * blue-logo system; see governance/DESIGN_SYSTEM.md).
 *
 * Canonical layered palette (agrees with the CSS custom properties in
 * src/app/globals.css — both files read from the same values, never restate
 * a literal hex twice):
 *  - background #F0EBE0 (warm ivory) / surface #F9F6EF / surface-raised #FCFAF5 / surface-sunken #EAE3D5
 *  - sidebar #2C4E3B (dark forest), sidebar-active rgba(196,154,79,0.18), sidebar-hover #3D6B50
 *  - primary/cta forest green #3D6B50, accent gold #C49A4F, secondary accent terracotta #B85C3C
 *  - text #2A2E28, heading forest green #3D6B50, text-muted #8B8370, border #C9BFA8
 *  - semantic pairs: success/warning/error/info, each a light bg tint + a
 *    700-level text of the same hue (see <Badge>)
 *
 * Legacy scales below (page/surface-elevated/navy/teal) are kept for
 * compatibility with existing class names — they alias the canonical tokens
 * above rather than restating values.
 *
 * red/yellow/amber/green/emerald/blue below override only the specific shades
 * (50/200(/300)/500-900, whichever a given family actually uses) that used to
 * be force-duplicated with !important in globals.css's compatibility layer —
 * see CSS_OVERRIDE_INVESTIGATION_2026-08-15.md. Collapsing them here means
 * Tailwind's own generated utility for e.g. `bg-red-50` now already produces
 * the brand value, so the old duplicate rule could be deleted instead of
 * fought with !important. Unlisted shades in each of these families remain
 * Tailwind's stock defaults (never referenced by the old compat layer, so
 * nothing depended on them being brand-specific).
 */
const config: Config = {
  darkMode: "class",
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",

        // ── Canonical layered palette ──────────────────────────────────────────
        // Sourced from the SAME CSS custom properties defined in globals.css —
        // the two files must agree, so nothing here restates a literal hex.
        "surface-raised": "var(--color-surface-raised)",
        "surface-sunken": "var(--color-surface-sunken)",
        sidebar: "var(--color-sidebar)",
        "sidebar-active": "var(--color-sidebar-active)",
        "sidebar-hover": "var(--color-sidebar-hover)",
        primary: {
          DEFAULT: "var(--color-primary)",
          hover: "var(--color-cta-hover)",
          foreground: "#ffffff",
        },
        text: "var(--color-text)",

        // ── shadcn/ui primitive keys (additive) ────────────────────────────────
        // Reuse the canonical tokens above rather than a second palette — these
        // are new keys only (card/popover/secondary/muted/destructive/input/ring),
        // or a `foreground` sub-key added beside an existing DEFAULT (primary,
        // accent) — nothing here changes what `bg-primary`/`bg-accent`/`border`
        // already resolve to. See CSS_OVERRIDE_INVESTIGATION_2026-08-15.md.
        card: {
          DEFAULT: "var(--color-surface)",
          foreground: "var(--color-text-primary)",
        },
        popover: {
          DEFAULT: "var(--color-surface-raised)",
          foreground: "var(--color-text-primary)",
        },
        secondary: {
          DEFAULT: "var(--color-surface-sunken)",
          foreground: "var(--color-text-primary)",
        },
        muted: {
          DEFAULT: "var(--color-surface-sunken)",
          foreground: "var(--color-text-muted)",
        },
        destructive: {
          DEFAULT: "var(--color-danger)",
          foreground: "#ffffff",
        },
        input: "var(--color-border)",
        ring: "var(--color-primary)",

        // ── Semantic status pairs — bg is the 100-level tint, text is the
        // 700-level, border is the 200-level, all of the same hue. Consumed
        // by <Badge>; do not use raw hue classes.
        "success-bg": "var(--color-success-bg)",
        "success-text": "var(--color-success-text)",
        "success-border": "var(--color-success-border)",
        "warning-bg": "var(--color-warning-bg)",
        "warning-text": "var(--color-warning-text)",
        "warning-border": "var(--color-warning-border)",
        "error-bg": "var(--color-error-bg)",
        "error-text": "var(--color-error-text)",
        "error-border": "var(--color-error-border)",
        "info-bg": "var(--color-info-bg)",
        "info-text": "var(--color-info-text)",
        "info-border": "var(--color-info-border)",

        // ── Semantic charcoal tokens ──────────────────────────────────────────
        // Used as: bg-page, bg-surface, bg-surface-elevated, border-border, etc.
        page: "var(--color-page)",
        surface: "var(--color-surface)",
        "surface-elevated": "var(--color-surface-elevated)",
        border: "var(--color-border)",
        "border-hover": "var(--color-border-hover)",
        "text-primary": "var(--color-text-primary)",
        "text-secondary": "var(--color-text-secondary)",
        "text-muted": "var(--color-text-muted)",

        // ── Action / state colors ─────────────────────────────────────────────
        accent: {
          DEFAULT: "var(--color-accent)",
          hover: "var(--color-secondary-hover)",
          blue: "#3b82f6",
          indigo: "#3D6B50",
          teal: "#C49A4F",
          purple: "#3D6B50",
          foreground: "#ffffff",
        },
        cta: {
          DEFAULT: "var(--color-cta)",
          hover: "var(--color-cta-hover)",
        },
        danger: {
          DEFAULT: "#ef4444",
          hover: "#dc2626",
        },
        warning: "#f59e0b",
        info: "#3b82f6",

        // ── Real brand palette (warm nonprofit pass, 2026-09-02) — supersedes
        // the 2026-08-15 blue-logo palette (deep/sky/violet/indigo/teal/
        // highlight were all blue-family hexes derived from the old logo).
        // The logo itself is being redesigned to match this palette; these
        // are now the single source of truth for section accents — see
        // governance/DESIGN_SYSTEM.md.
        brand: {
          deep: "#3D6B50", // forest green — primary brand color
          sky: "#5C8B6E", // lighter forest green tint
          DEFAULT: "#3D6B50",
          violet: "#B85C3C", // terracotta accent
          indigo: "#8B5E3C", // warm umber accent
          teal: "#7A8B5C", // sage/olive accent
          highlight: "#C49A4F", // gold — primary CTAs/buttons, sidebar/header active-nav accent
        },

        // ── Legacy navy scale (pages still reference these) ───────────────────
        // NOT part of the real brand (see `brand` above) — flagged for removal
        // 2026-08-15, but NOT deleted yet: still live in ~149 files / ~3,800
        // class usages app-wide (mostly body text/backgrounds on cards, tables,
        // and pages — not just nav), confirmed via a real repo-wide grep this
        // session. Deleting this block outright would silently unstyle all of
        // that content, reproducing the 2026-07-16 !important-layer-removal
        // regression (see CSS_OVERRIDE_INVESTIGATION_2026-08-15.md) at a wider
        // scale. Needs a scoped, file-by-file migration before removal, not a
        // one-shot delete — do not remove without that migration.
        navy: {
          50: "#f6f4ee",
          100: "#eae5d8",
          200: "#d3c9ae",
          300: "#b3a37e",
          400: "#8f8562",
          500: "#6d6a4c",
          600: "#54573f",
          700: "#3f4633",
          800: "#33392c",
          900: "#2c4e3b",
          950: "#1e3527",
        },

        // ── Legacy teal scale — now a gold ramp anchored on secondary #C49A4F ──
        // 50/200/300/500 match globals.css's former compat-layer values exactly
        // (see CSS_OVERRIDE_INVESTIGATION_2026-08-15.md); other shades recolored
        // to the same gold family for the 2026-09-02 warm-palette pass.
        teal: {
          50: "rgba(196, 154, 79, 0.08)",
          100: "#f5e9d3",
          200: "rgba(196, 154, 79, 0.3)",
          300: "rgba(196, 154, 79, 0.5)",
          400: "#d3ae6b",
          500: "#c49a4f",
          600: "#a67f3d",
          700: "#8a6830",
          800: "#6e5326",
          900: "#574020",
          950: "#3a2b16",
        },

        // ── Alert/status tint families — 50/200(/300)/500-900 subset matches the
        // former globals.css compat-layer values exactly (rgba tints + solid text
        // colors). Unlisted shades (100/300/400/950 etc.) remain Tailwind stock.
        red: {
          50: "rgba(220, 38, 38, 0.08)",
          200: "rgba(220, 38, 38, 0.25)",
          500: "#dc2626",
          600: "#dc2626",
          700: "#991b1b",
          800: "#991b1b",
          900: "#991b1b",
        },
        yellow: {
          50: "rgba(217, 119, 6, 0.08)",
          200: "rgba(217, 119, 6, 0.25)",
          300: "rgba(217, 119, 6, 0.25)",
          700: "#b45309",
          800: "#b45309",
          900: "#b45309",
        },
        amber: {
          50: "rgba(217, 119, 6, 0.08)",
          200: "rgba(217, 119, 6, 0.25)",
          700: "#b45309",
          800: "#b45309",
        },
        green: {
          50: "rgba(5, 150, 105, 0.08)",
          200: "rgba(5, 150, 105, 0.25)",
          700: "#047857",
          800: "#047857",
        },
        emerald: {
          50: "rgba(5, 150, 105, 0.08)",
          200: "rgba(5, 150, 105, 0.25)",
          700: "#047857",
        },
        blue: {
          50: "rgba(61, 107, 80, 0.08)",
          200: "rgba(61, 107, 80, 0.25)",
          700: "var(--color-primary)",
          800: "var(--color-primary)",
        },

        // ── Legacy ink scale ──────────────────────────────────────────────────
        ink: {
          base: "#0f1117",
          900: "#111318",
          800: "#161820",
          700: "#1a1d27",
          600: "#242835",
          500: "#2e3345",
        },
      },

      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },

      fontFamily: {
        sans: [
          "var(--font-sans)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "var(--font-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },

      backgroundImage: {
        "gradient-brand":
          "linear-gradient(135deg, #C49A4F 0%, #3D6B50 100%)",
        "gradient-accent": "linear-gradient(135deg, #C49A4F 0%, #3D6B50 100%)",
        "gradient-purple":
          "linear-gradient(135deg, #3D6B50 0%, #2C4E3B 100%)",
        "gradient-cta":
          "linear-gradient(135deg, #C49A4F 0%, #3D6B50 100%)",
        "glow-radial":
          "radial-gradient(60% 60% at 50% 0%, rgba(196,154,79,0.15) 0%, rgba(15,17,23,0) 70%)",
      },

      boxShadow: {
        card: "0 4px 20px -8px rgba(0,0,0,0.6), inset 0 1px 0 0 rgba(255,255,255,0.03)",
        "card-hover":
          "0 8px 30px -10px rgba(0,0,0,0.7), inset 0 1px 0 0 rgba(255,255,255,0.05)",
        glow: "0 0 0 1px rgba(61,107,80,0.3), 0 0 20px -4px rgba(61,107,80,0.35)",
        "glow-accent":
          "0 0 0 1px rgba(196,154,79,0.3), 0 0 20px -4px rgba(196,154,79,0.35)",
        "glow-blue":
          "0 0 0 1px rgba(196,154,79,0.3), 0 0 20px -4px rgba(196,154,79,0.35)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
