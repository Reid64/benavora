import type { Metadata } from "next";

import LoginPageClient from "./LoginPageClient";

export const metadata: Metadata = {
  title: "Sign In",
  description: "Sign in to your Benavora nonprofit funding workspace.",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return <LoginPageClient />;
}
