import type { Metadata } from "next";
import { marketingMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = marketingMetadata(
  "/privacy",
  "Privacy Policy",
  "How Benavora collects, processes, stores, and protects your data."
);

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold text-white">{title}</h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-gray-300">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
        Privacy Policy
      </h1>
      <p className="mt-3 text-sm text-gray-500">Last updated: June 2026</p>

      <p className="mt-6 text-[15px] leading-relaxed text-gray-300">
        Benavora (&ldquo;Benavora,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or
        &ldquo;our&rdquo;) provides nonprofit funding-automation software. This
        Privacy Policy explains what information we collect, how we use and
        share it, and the choices you have. By using Benavora you agree to the
        practices described here.
      </p>

      <Section title="1. Information We Collect">
        <p>We collect information you provide and information generated as you use the service:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <span className="text-gray-200">Account &amp; organization data</span> &mdash;
            name, email, password, organization name, EIN, mailing address, and
            role.
          </li>
          <li>
            <span className="text-gray-200">Knowledge Base content</span> &mdash;
            mission statements, program descriptions, budgets, narratives, and
            documents you upload to generate applications.
          </li>
          <li>
            <span className="text-gray-200">Usage &amp; device data</span> &mdash;
            log data, IP address, browser type, pages viewed, and feature usage.
          </li>
          <li>
            <span className="text-gray-200">Payment data</span> &mdash; billing
            details processed by our payment provider (see Third-Party
            Services). We do not store full card numbers.
          </li>
        </ul>
      </Section>

      <Section title="2. AI Processing (Claude API)">
        <p>
          Benavora uses Anthropic&rsquo;s Claude API to power grant research,
          eligibility scoring, narrative drafting, and form analysis. When you
          generate or analyze content, the relevant text from your Knowledge
          Base and the target opportunity is sent to Anthropic for processing
          and returned to you.
        </p>
        <p>
          We instruct the model to use only the organizational data you provide
          and to flag gaps rather than fabricate facts. AI output is a draft and
          is not a substitute for professional review. Your inputs are
          transmitted over encrypted connections and handled under
          Anthropic&rsquo;s commercial terms.
        </p>
      </Section>

      <Section title="3. Data Storage (Supabase)">
        <p>
          Your data is stored in databases and object storage hosted on
          Supabase (built on PostgreSQL) in the United States. Access is scoped
          per organization using row-level security so that one organization
          cannot read another&rsquo;s records. Data is encrypted in transit and
          at rest.
        </p>
      </Section>

      <Section title="4. Cookies">
        <p>
          We use strictly necessary cookies to keep you signed in and to secure
          your session, and limited analytics cookies to understand product
          usage. You can control cookies through your browser settings;
          disabling necessary cookies may prevent you from logging in.
        </p>
      </Section>

      <Section title="5. Third-Party Services">
        <p>We rely on the following sub-processors and services:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <span className="text-gray-200">Anthropic (Claude API)</span> &mdash;
            AI text generation and analysis.
          </li>
          <li>
            <span className="text-gray-200">Supabase</span> &mdash; database,
            authentication, and file storage.
          </li>
          <li>
            <span className="text-gray-200">Stripe</span> &mdash; subscription
            billing and payment processing. Stripe handles your card data under
            its own privacy policy.
          </li>
          <li>
            <span className="text-gray-200">Playwright (AutoApply)</span> &mdash;
            an automated browser used, with your authorization, to read funder
            portals and submit applications on your behalf.
          </li>
        </ul>
        <p>
          These providers process data only as needed to deliver their service.
          We do not sell your personal information.
        </p>
      </Section>

      <Section title="6. Data Retention &amp; Deletion">
        <p>
          We retain your data for as long as your account is active and as
          needed to provide the service, comply with legal obligations, resolve
          disputes, and enforce our agreements. You may request export or
          deletion of your data at any time by emailing{" "}
          <a
            href="mailto:support@benavora.com"
            className="text-accent hover:text-accent/80"
          >
            support@benavora.com
          </a>
          . We will delete or de-identify your data within a reasonable period
          after account closure, except where retention is required by law.
        </p>
      </Section>

      <Section title="7. Your Rights (CCPA &amp; GDPR)">
        <p>
          Depending on where you live, you may have the right to access,
          correct, delete, or port your personal information, to opt out of
          certain processing, and to be free from discrimination for exercising
          these rights.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <span className="text-gray-200">California (CCPA/CPRA)</span> &mdash;
            you may request the categories and specific pieces of personal
            information we have collected and request deletion. We do not sell
            personal information.
          </li>
          <li>
            <span className="text-gray-200">EEA/UK (GDPR)</span> &mdash; you may
            exercise access, rectification, erasure, restriction, portability,
            and objection rights. Our legal bases are contract performance,
            legitimate interests, and consent where applicable.
          </li>
        </ul>
        <p>
          To exercise any right, contact support@benavora.com. We will verify
          your request and respond within the timeframe required by law.
        </p>
      </Section>

      <Section title="8. Children Under 13">
        <p>
          Benavora is a business tool not directed to children. We do not
          knowingly collect personal information from anyone under 13. If you
          believe a child has provided us personal information, contact us and
          we will delete it.
        </p>
      </Section>

      <Section title="9. Changes to This Policy">
        <p>
          We may update this Privacy Policy from time to time. Material changes
          will be posted on this page with a revised &ldquo;Last updated&rdquo;
          date. Continued use of Benavora after changes take effect constitutes
          acceptance.
        </p>
      </Section>

      <Section title="10. Contact Us">
        <p>
          Questions about this policy or your data? Email{" "}
          <a
            href="mailto:support@benavora.com"
            className="text-accent hover:text-accent/80"
          >
            support@benavora.com
          </a>
          .
        </p>
      </Section>
    </div>
  );
}
