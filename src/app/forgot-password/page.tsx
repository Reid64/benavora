import type { Metadata } from "next";

import ForgotPasswordPageClient from "./ForgotPasswordPageClient";

export const metadata: Metadata = {
  title: "Reset Your Password",
  description: "Request a password reset link for your Benavora account.",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordPageClient />;
}
