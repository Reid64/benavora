import type { Config } from "tailwindcss";

/**
 * Benavora brand theme.
 *
 * Canonical layered palette (agrees with the CSS custom properties in
 * src/app/globals.css — both files read from the same values, never restate
 * a literal hex twice):
 *  - background #E2E8F0 / surface #FFFFFF / surface-raised #F8FAFC / surface-sunken #F1F5F9
 *  - sidebar #0B1220, sidebar-active rgba(0,180,216,0.12)
 *  - primary #0077B6 (cta), accent #00B4D8
 *  - text #0F172A, text-muted #475569, border #E2E8F0
 *  - semantic pairs: success/warning/error/info, each a light bg tint + a
 *    700-level text of the same hue (see <Badge>)
 *
 * Legacy scales below (page/surface-elevated/navy/teal/plum) are kept for
 * compatibility with existing class names — they alias the canonical tokens
 * above rather than restating values.
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
        primary: {
          DEFAULT: "var(--color-primary)",
          hover: "var(--color-cta-hover)",
        },
        text: "var(--color-text)",

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

        // ── Legacy navy scale (pages still reference these) ───────────────────
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
        teal: {
          50: "#eafbfe",
          100: "#d0f4fb",
          200: "#a3e9f7",
          300: "#6ddaef",
          400: "#33c2e0",
          500: "#00b4d8",
          600: "#0093ac",
          700: "#00748a",
          800: "#045a6d",
          900: "#0a4a59",
          950: "#042e38",
        },

        // ── Legacy plum scale — now a navy-blue ramp anchored on primary #0077B6 ──
        plum: {
          50: "#eaf4fb",
          100: "#cfe6f5",
          200: "#9fcceb",
          300: "#63ade0",
          400: "#3690d1",
          500: "#1f7bbd",
          600: "#0077b6",
          700: "#005f92",
          800: "#004a72",
          900: "#073456",
          950: "#04202f",
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
  plugins: [],
};

export default config;
