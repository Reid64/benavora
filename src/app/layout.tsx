import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

// Monospace for numbers, codes, and confidence scores (--font-mono).
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Benavora - Fund More. Do More. Change More.",
  description: "Nonprofit funding automation - grant research, drafting, and tracking.",
  icons: {
    icon: [
      { url: "/benavora_favicon.png", sizes: "192x192", type: "image/png" },
      { url: "/benavora_favicon.png", sizes: "512x512", type: "image/png" },
    ],
    apple: { url: "/benavora_favicon.png", sizes: "180x180", type: "image/png" },
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a1a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}

