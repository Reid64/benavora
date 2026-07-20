import type { Metadata } from "next";

import RegisterPageClient from "./RegisterPageClient";

export const metadata: Metadata = {
  title: "Create Your Account",
  description:
    "Set up your nonprofit's Benavora workspace and start discovering grant opportunities in minutes.",
  robots: { index: false, follow: false },
};

export default function RegisterPage() {
  return <RegisterPageClient />;
}
