import type { Metadata } from "next";

import HowItWorksClient from "./HowItWorksClient";

export const metadata: Metadata = {
  title: "How Benavora Actually Works",
  description:
    "A stage-by-stage walkthrough of Benavora's real pipeline — discovery, scoring, drafting with human approval, learning, and outreach.",
};

export default function HowItWorksPage() {
  return <HowItWorksClient />;
}
