import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Self-hosted (public/fonts) so builds don't depend on reaching fonts.googleapis.com.
const inter = localFont({
  src: "../../public/fonts/inter-latin-wght-normal.woff2",
  variable: "--font-sans",
  display: "swap",
  weight: "100 900",
});

// Monospace for numbers, codes, and confidence scores (--font-mono).
const jetbrainsMono = localFont({
  src: "../../public/fonts/jetbrains-mono-latin-wght-normal.woff2",
  variable: "--font-mono",
  display: "swap",
  weight: "100 800",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://benavora.com"),
  title: {
    default: "Benavora — AI Grant Automation for Nonprofits",
    template: "%s | Benavora",
  },
  description:
    "Benavora automates grant discovery, application drafting, and donor outreach for nonprofits. 30 autonomous AI agents work 24/7 to maximize your funding.",
  keywords: [
    "nonprofit grant automation",
    "AI grant writing",
    "nonprofit fundraising software",
    "grant management software",
    "autonomous grant applications",
  ],
  openGraph: {
    type: "website",
    siteName: "Benavora",
    title: "Benavora — AI Grant Automation for Nonprofits",
    description:
      "AI-powered grant discovery, drafting, and AutoApply submission. 30 autonomous agents working 24/7 for your nonprofit.",
    url: "https://benavora.com",
  },
  twitter: {
    card: "summary_large_image",
    title: "Benavora — AI Grant Automation",
    description: "AI-powered grant automation for nonprofits.",
  },
  robots: { index: true, follow: true },
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-192.png", sizes: "512x512", type: "image/png" },
    ],
    apple: { url: "/icon-192.png", sizes: "180x180", type: "image/png" },
  },
};

export const viewport: Viewport = {
  themeColor: "#C49A4F",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}



