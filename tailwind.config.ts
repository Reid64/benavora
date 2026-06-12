import type { Config } from "tailwindcss";

/**
 * Benavora brand theme.
 *
 * Palette:
 *  - navy   — primary dark surfaces (sidebar, header). Brand base #1a2744.
 *  - teal   — primary action / accent and active states. Brand base #2a9d8f.
 *  - plum   — purple highlight for success indicators & "proven" narratives. #7b2d8e.
 *
 * Tagline: "Fund More. Do More. Change More."
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

        // Primary dark navy — sidebar, header, dark sections.
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
          900: "#1a2744", // brand dark navy
          950: "#111a30",
        },

        // Accent teal/emerald — primary buttons, active states, links.
        teal: {
          50: "#eff9f7",
          100: "#d4f0ea",
          200: "#a9e1d7",
          300: "#74cabd",
          400: "#43b1a3",
          500: "#2a9d8f", // brand teal
          600: "#23897c",
          700: "#1e6e64",
          800: "#1b5851",
          900: "#194944",
          950: "#0a2b28",
        },

        // Accent purple — highlights, success indicators, proven badges.
        plum: {
          50: "#faf3fb",
          100: "#f2e2f5",
          200: "#e6c6ec",
          300: "#d29edd",
          400: "#b566c8",
          500: "#993fae",
          600: "#7b2d8e", // brand purple
          700: "#652576",
          800: "#531f61",
          900: "#451b51",
          950: "#2c0936",
        },

        // App canvas + elevated surfaces for the premium dark theme.
        surface: "#0a0a1a",
        ink: {
          base: "#0a0a1a", // deepest app background
          900: "#0c0c20",
          800: "#101028", // raised panel
          700: "#14143a", // card surface
          600: "#1a1a44", // hover / elevated card
          500: "#222252",
        },
        // Logo-matched accent stops (blue → teal) and purple highlight.
        accent: {
          blue: "#3b82f6",
          indigo: "#6366f1",
          teal: "#2dd4bf",
          purple: "#a855f7",
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
        // Brand gradient: indigo → blue → teal (matches the logo sweep).
        "gradient-brand":
          "linear-gradient(135deg, #6366f1 0%, #3b82f6 45%, #2dd4bf 100%)",
        "gradient-accent": "linear-gradient(135deg, #3b82f6 0%, #2dd4bf 100%)",
        "gradient-purple":
          "linear-gradient(135deg, #a855f7 0%, #6366f1 100%)",
        // Subtle radial glow used behind hero/brand panels.
        "glow-radial":
          "radial-gradient(60% 60% at 50% 0%, rgba(59,130,246,0.18) 0%, rgba(10,10,26,0) 70%)",
      },
      boxShadow: {
        // Dark-theme elevation: soft drop + faint inner top highlight.
        card: "0 8px 30px -12px rgba(0,0,0,0.8), inset 0 1px 0 0 rgba(255,255,255,0.04)",
        "card-hover":
          "0 16px 50px -16px rgba(0,0,0,0.9), inset 0 1px 0 0 rgba(255,255,255,0.06)",
        // Colored glows for accents and focus.
        glow: "0 0 0 1px rgba(45,212,191,0.35), 0 0 28px -6px rgba(45,212,191,0.45)",
        "glow-blue":
          "0 0 0 1px rgba(59,130,246,0.35), 0 0 28px -6px rgba(59,130,246,0.45)",
        "glow-purple":
          "0 0 0 1px rgba(168,85,247,0.35), 0 0 28px -6px rgba(168,85,247,0.45)",
      },
    },
  },
  plugins: [],
};

export default config;
