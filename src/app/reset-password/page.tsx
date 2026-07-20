import type { Metadata } from "next";

import ResetPasswordPageClient from "./ResetPasswordPageClient";

export const metadata: Metadata = {
  title: "Set a New Password",
  description: "Choose a new password for your Benavora account.",
  robots: { index: false, follow: false },
};

export default function ResetPasswordPage() {
  return <ResetPasswordPageClient />;
}
