import type { Config } from "tailwindcss";

/**
 * Benavora brand theme.
 *
 * Canonical layered palette (agrees with the CSS custom properties in
 * src/app/globals.css — both files read from the same values, never restate
 * a literal hex twice):
 *  - background #EEF2F7 / surface #FFFFFF / surface-raised #F8FAFC / surface-sunken #F1F5F9
 *  - sidebar #1A2B3C, sidebar-active rgba(0,180,216,0.12), sidebar-hover #243B55
 *  - primary #0077B6 (cta), accent #00B4D8
 *  - text #0F172A, text-muted #475569, border #E2E8F0
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
          indigo: "#0077B6",
          teal: "#00B4D8",
          purple: "#0077B6",
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

        // ── Real brand palette (2026-08-15) — sourced from the actual uploaded
        // logo, not the old navy/teal/plum values below (those were derived
        // from unused, dead-code color definitions and do not belong to this
        // brand — see governance/DESIGN_SYSTEM.md). Logo elements: a blue-
        // gradient "b" mark (deep → sky), a violet paper-airplane/heart
        // accent, and bright teal-cyan leaf petals.
        brand: {
          deep: "#1D4ED8", // "b" mark gradient — top
          sky: "#0284C7", // "b" mark gradient — bottom
          DEFAULT: "#1D4ED8",
          violet: "#7C3AED", // paper-airplane / heart accent
          indigo: "#4C51C6", // blue-violet blend
          teal: "#0E7490", // teal-blue blend
          highlight: "#22D3EE", // fixed bright teal (leaf petals) — primary CTAs/buttons
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
          50: "#f4f6fa",
          100: "#e6ebf3",
          200: "#c5d0e2",
          300: "#9aabca",
          400: "#6a81ab",
          500: "#47608c",
          600: "#344b73",
          700: "#28395a",
          800: "#202f4a",
          900: "#1a2744",
          950: "#111a30",
        },

        // ── Legacy teal scale — now a cyan ramp anchored on secondary #00B4D8 ──
        // 50/200/300/600/700 match globals.css's former compat-layer values exactly
        // (see CSS_OVERRIDE_INVESTIGATION_2026-08-15.md); other shades unchanged.
        teal: {
          50: "rgba(0, 180, 216, 0.08)",
          100: "#d0f4fb",
          200: "rgba(0, 180, 216, 0.3)",
          300: "rgba(0, 180, 216, 0.5)",
          400: "#33c2e0",
          500: "#00b4d8",
          600: "#0089a8",
          700: "#006e87",
          800: "#045a6d",
          900: "#0a4a59",
          950: "#042e38",
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
          50: "rgba(0, 119, 182, 0.08)",
          200: "rgba(0, 119, 182, 0.25)",
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
          "linear-gradient(135deg, #00B4D8 0%, #0077B6 100%)",
        "gradient-accent": "linear-gradient(135deg, #00B4D8 0%, #0077B6 100%)",
        "gradient-purple":
          "linear-gradient(135deg, #0077B6 0%, #005F92 100%)",
        "gradient-cta":
          "linear-gradient(135deg, #00B4D8 0%, #0077B6 100%)",
        "glow-radial":
          "radial-gradient(60% 60% at 50% 0%, rgba(0,180,216,0.15) 0%, rgba(15,17,23,0) 70%)",
      },

      boxShadow: {
        card: "0 4px 20px -8px rgba(0,0,0,0.6), inset 0 1px 0 0 rgba(255,255,255,0.03)",
        "card-hover":
          "0 8px 30px -10px rgba(0,0,0,0.7), inset 0 1px 0 0 rgba(255,255,255,0.05)",
        glow: "0 0 0 1px rgba(0,119,182,0.3), 0 0 20px -4px rgba(0,119,182,0.35)",
        "glow-accent":
          "0 0 0 1px rgba(0,180,216,0.3), 0 0 20px -4px rgba(0,180,216,0.35)",
        "glow-blue":
          "0 0 0 1px rgba(0,180,216,0.3), 0 0 20px -4px rgba(0,180,216,0.35)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
