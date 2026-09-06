import type { Metadata } from "next";

import { Badge as UIBadge } from "@/components/ui/Badge";
import { marketingMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = marketingMetadata(
  "/security",
  "Security",
  "How Benavora protects your grant data with AES-256 encryption, row-level security, TLS 1.3, and SOC 2-compliant infrastructure."
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

function Badge({ label }: { label: string }) {
  return (
    <UIBadge variant="warning" className="px-3 py-1">
      {label}
    </UIBadge>
  );
}

export default function SecurityPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
        Security
      </h1>
      <p className="mt-3 text-sm text-gray-500">Last updated: July 2026</p>

      <p className="mt-6 text-[15px] leading-relaxed text-gray-300">
        Benavora stores sensitive nonprofit data — grant applications, financial
        records, board information, and credentials. We treat security as a
        core product requirement, not an afterthought. Below is a plain-English
        explanation of the controls in place today and our roadmap.
      </p>

      {/* Trust badges */}
      <div className="mt-8 flex flex-wrap gap-3">
        <Badge label="AES-256-GCM Encryption" />
        <Badge label="TLS 1.3 in Transit" />
        <Badge label="Row-Level Security" />
        <Badge label="SOC 2 Type II Roadmap" />
        <Badge label="GDPR-Aligned" />
        <Badge label="Data Never Sold" />
      </div>

      <Section title="Encryption at Rest — AES-256-GCM">
        <p>
          All data stored in Benavora&rsquo;s database is encrypted at rest by
          the underlying cloud provider using AES-256 (industry-standard symmetric
          encryption). In addition to the infrastructure-level encryption, every
          sensitive credential stored by Benavora — Google OAuth tokens, portal
          automation credentials, funder log-in details, and user-supplied API
          keys — is individually encrypted by Benavora&rsquo;s application layer
          using <span className="text-gray-200">AES-256-GCM</span> before
          it is written to the database. This means that even a raw database
          read cannot expose these secrets without the corresponding
          application-layer key.
        </p>
        <p>
          Encryption keys are environment variables that are never committed to
          source code and are rotatable without re-deploying the application.
          There are no hardcoded fallback secrets.
        </p>
      </Section>

      <Section title="Encryption in Transit — TLS 1.3">
        <p>
          All connections between your browser and Benavora&rsquo;s servers, and
          between Benavora&rsquo;s servers and third-party APIs (Anthropic,
          Supabase, Stripe, Google, Resend), are encrypted with
          <span className="text-gray-200"> TLS 1.3</span> — the current
          best-practice version of Transport Layer Security. Older protocol
          versions (TLS 1.0 / 1.1) are not supported. Connections over plain HTTP
          are rejected or redirected to HTTPS.
        </p>
      </Section>

      <Section title="Tenant Isolation — Row-Level Security">
        <p>
          Benavora is a multi-tenant SaaS platform. Every table in our database
          has <span className="text-gray-200">row-level security (RLS)</span> policies
          enforced by PostgreSQL at the database layer. These policies ensure
          that an authenticated user can only query rows that belong to their
          own organization — no matter what the application layer requests.
          An organization&rsquo;s grants, applications, knowledge base entries,
          contacts, and credentials are invisible to all other tenants, even if
          a bug in the application code constructs a query without a filter.
        </p>
        <p>
          Service-role operations (cron jobs, admin functions) use a separate
          key that bypasses RLS only for the specific, scoped operations that
          require it, and never expose data across tenants.
        </p>
      </Section>

      <Section title="SOC 2-Compliant Infrastructure">
        <p>
          Benavora runs on infrastructure that has achieved or is on the path to
          SOC 2 certification:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <span className="text-gray-200">Supabase</span> — our database and
            authentication provider, which is SOC 2 Type II certified. All
            application data, authentication sessions, and file storage run on
            Supabase&rsquo;s US-region infrastructure.
          </li>
          <li>
            <span className="text-gray-200">Vercel</span> — our application
            hosting provider (SOC 2 Type II certified). Serverless functions,
            edge middleware, and static assets are served from Vercel&rsquo;s
            global network.
          </li>
          <li>
            <span className="text-gray-200">Stripe</span> — payment processing
            (PCI DSS Level 1 certified). Benavora never stores raw card numbers.
          </li>
          <li>
            <span className="text-gray-200">Anthropic</span> — AI processing.
            Anthropic maintains a SOC 2 Type II report and does not use API
            inputs to train its models by default.
          </li>
        </ul>
      </Section>

      <Section title="Authentication &amp; Access Control">
        <p>
          User authentication is handled by Supabase Auth, which issues
          short-lived JWT access tokens. Benavora enforces a four-tier role
          model — <span className="text-gray-200">owner / admin / writer / viewer</span> —
          and every API route validates the caller&rsquo;s role before processing
          the request. Roles are stored server-side and cannot be self-elevated
          by a client request.
        </p>
        <p>
          Webhook endpoints (Stripe, Resend) require HMAC signature verification.
          A request without a valid signature is rejected before any processing
          occurs. There is no fallback to &ldquo;accept unsigned&rdquo; mode.
        </p>
        <p>
          Admin-only platform endpoints check the caller&rsquo;s identity against a
          server-side allowlist of platform owner IDs. These endpoints are
          inaccessible to regular organization accounts.
        </p>
      </Section>

      <Section title="Data Handling — We Never Sell Your Data">
        <p>
          Benavora does not sell, rent, or barter your personal information or
          your organization&rsquo;s grant data to any third party for marketing,
          advertising, or data-broker purposes.
        </p>
        <p>
          Data you enter — organization profiles, narratives, budgets,
          applications — is used solely to operate the service. When AI
          features process your content through the Anthropic Claude API,
          Anthropic&rsquo;s commercial terms prohibit them from using that data
          to train their models.
        </p>
      </Section>

      <Section title="GDPR Alignment">
        <p>
          While Benavora is primarily used by US-based nonprofits, we have
          designed our data practices to align with GDPR principles:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <span className="text-gray-200">Data minimization</span> — we collect
            only what is necessary to operate the service.
          </li>
          <li>
            <span className="text-gray-200">Purpose limitation</span> — data is
            used only for the purpose for which it was collected.
          </li>
          <li>
            <span className="text-gray-200">Right to erasure</span> — you may
            request deletion of your account and associated data at any time
            by emailing{" "}
            <a
              href="mailto:support@benavora.com"
              className="text-accent hover:text-accent/80"
            >
              support@benavora.com
            </a>
            .
          </li>
          <li>
            <span className="text-gray-200">Data portability</span> — you can
            request an export of your organization&rsquo;s data in a structured
            format.
          </li>
        </ul>
        <p>
          Benavora stores all production data in the United States. If you
          require a Data Processing Agreement (DPA), contact us at the address
          below.
        </p>
      </Section>

      <Section title="SOC 2 Type II Roadmap">
        <p>
          Benavora is pursuing SOC 2 Type II certification for its own
          operations. Our roadmap includes:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Formal security policies and employee training program</li>
          <li>Automated vulnerability scanning and dependency auditing in CI/CD</li>
          <li>Quarterly access reviews and principle-of-least-privilege audit</li>
          <li>Incident response plan with defined SLAs</li>
          <li>Penetration testing engagement (annual)</li>
          <li>Third-party SOC 2 Type II audit (target: 2027)</li>
        </ul>
        <p>
          Customers requiring a current SOC 2 report can reference the reports
          of our sub-processors (Supabase, Vercel) while our own certification
          is in progress. Contact us if your compliance team needs supporting
          documentation.
        </p>
      </Section>

      <Section title="Responsible Disclosure">
        <p>
          If you discover a security vulnerability in Benavora, please report it
          responsibly by emailing{" "}
          <a
            href="mailto:security@benavora.com"
            className="text-accent hover:text-accent/80"
          >
            security@benavora.com
          </a>
          . We will acknowledge receipt within 72 hours and work with you on a
          coordinated disclosure. We ask that you not publicly disclose the
          issue until we have had a reasonable opportunity to address it.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Security questions or data requests?{" "}
          <a
            href="mailto:security@benavora.com"
            className="text-accent hover:text-accent/80"
          >
            security@benavora.com
          </a>
          . General support:{" "}
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
