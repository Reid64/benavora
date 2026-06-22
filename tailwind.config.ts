import type { Config } from "tailwindcss";

/**
 * Benavora brand theme.
 *
 * Palette:
 *  - Semantic charcoal dark mode (page / surface / surface-elevated / border)
 *  - navy   — legacy color scale kept for compatibility with existing pages
 *  - teal   — legacy accent scale
 *  - plum   — legacy purple scale
 *  - accent purple (#7c3aed) — primary UI accent
 *  - cta (#10b981) — emerald green for primary action buttons
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
          DEFAULT: "#7c3aed",
          hover: "#6d28d9",
          blue: "#3b82f6",
          indigo: "#6366f1",
          teal: "#2dd4bf",
          purple: "#a855f7",
        },
        cta: {
          DEFAULT: "#10b981",
          hover: "#059669",
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

        // ── Legacy teal scale ─────────────────────────────────────────────────
        teal: {
          50: "#eff9f7",
          100: "#d4f0ea",
          200: "#a9e1d7",
          300: "#74cabd",
          400: "#43b1a3",
          500: "#2a9d8f",
          600: "#23897c",
          700: "#1e6e64",
          800: "#1b5851",
          900: "#194944",
          950: "#0a2b28",
        },

        // ── Legacy plum scale ─────────────────────────────────────────────────
        plum: {
          50: "#faf3fb",
          100: "#f2e2f5",
          200: "#e6c6ec",
          300: "#d29edd",
          400: "#b566c8",
          500: "#993fae",
          600: "#7b2d8e",
          700: "#652576",
          800: "#531f61",
          900: "#451b51",
          950: "#2c0936",
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
          "linear-gradient(135deg, #6366f1 0%, #3b82f6 45%, #2dd4bf 100%)",
        "gradient-accent": "linear-gradient(135deg, #3b82f6 0%, #2dd4bf 100%)",
        "gradient-purple":
          "linear-gradient(135deg, #a855f7 0%, #6366f1 100%)",
        "gradient-cta":
          "linear-gradient(135deg, #10b981 0%, #059669 100%)",
        "glow-radial":
          "radial-gradient(60% 60% at 50% 0%, rgba(124,58,237,0.15) 0%, rgba(15,17,23,0) 70%)",
      },

      boxShadow: {
        card: "0 4px 20px -8px rgba(0,0,0,0.6), inset 0 1px 0 0 rgba(255,255,255,0.03)",
        "card-hover":
          "0 8px 30px -10px rgba(0,0,0,0.7), inset 0 1px 0 0 rgba(255,255,255,0.05)",
        glow: "0 0 0 1px rgba(16,185,129,0.3), 0 0 20px -4px rgba(16,185,129,0.35)",
        "glow-accent":
          "0 0 0 1px rgba(124,58,237,0.3), 0 0 20px -4px rgba(124,58,237,0.35)",
        "glow-blue":
          "0 0 0 1px rgba(59,130,246,0.3), 0 0 20px -4px rgba(59,130,246,0.35)",
      },
    },
  },
  plugins: [],
};

export default config;
