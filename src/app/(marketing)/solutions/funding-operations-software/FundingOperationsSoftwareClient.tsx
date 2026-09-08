"use client";

import Image from "next/image";
import { Section, Display1, Display2 } from "@/components/marketing/Section";
import { CtaPrimary, CtaGhost } from "@/components/marketing/Cta";
import { mk, mkElevation, mkRadius } from "@/lib/marketing/theme";

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 600, color: mk.heroMuted, letterSpacing: 0.6, marginBottom: 12 }}>
      {children}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: mk.surface, border: `1px solid ${mk.line}`, borderRadius: mkRadius.card, boxShadow: mkElevation[1], padding: 20 }}>
      {children}
    </div>
  );
}

const ROLES: { label: string; body: string }[] = [
  { label: "Owner", body: "Full access, including billing and the ability to turn on any autonomy toggle." },
  { label: "Admin", body: "Can manage autonomy settings, pause automated submission, and manage the team, without billing access." },
  { label: "Writer", body: "Can research, draft, and approve or submit applications, but cannot change autonomy settings or pause switches." },
  { label: "Viewer", body: "Read-only across the pipeline, reporting, and audit trail — cannot trigger, approve, or configure anything." },
];

const CONTROLS: { label: string; body: string }[] = [
  { label: "Four-level pause switches", body: "Halt automated submission platform-wide, for one domain, for one funder, or for one organization, independently of the other three." },
  { label: "Per-attempt submission record", body: "Every AutoApply attempt logs its channel, status, timing, and confirmation data — a real row, not a summary count." },
  { label: "Decision audit trail", body: "Every autonomous decision logs the agent, its reasoning, its confidence score, the action taken, and whether it's flagged for human review, with the reviewer's identity and verdict once resolved." },
  { label: "Cross-client dedup, hashed", body: "A 7-day check blocks two organizations from hitting the same funder domain in quick succession, comparing organization identity only as a SHA-256 hash, never a raw ID." },
];

const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: "Is this a different product from the grant discovery and drafting tools, or the same platform?",
    answer:
      "The same platform. This page is written for whoever in your organization owns the operational side of grantseeking — the person who needs to know who has access to what, what gets logged, and how to stop something quickly — rather than the person doing the research and writing.",
  },
  {
    question: "What can a Viewer account actually do?",
    answer:
      "Look at the pipeline, reporting, and the decision audit trail, and nothing else. A Viewer can't trigger research, approve a draft, submit an application, or touch an autonomy setting. It's meant for board members or funders who want visibility without operational access.",
  },
  {
    question: "Who has the ability to shut off automated submission if something looks wrong?",
    answer:
      "Owner and Admin roles can flip any of four independent pause switches — platform-wide, one domain, one funder, or one organization — and each is checked before an item runs. A Writer can approve or submit an individual item but cannot pause the system.",
  },
  {
    question: "Can we see who approved a specific application, and when?",
    answer:
      "Yes. Approving a draft records the approval timestamp on the item, and where an autonomous agent was involved in producing it, the decision audit trail separately records the agent's action, its confidence, and, if flagged, the human reviewer and their verdict.",
  },
  {
    question: "Does one organization's data ever mix with another's on a shared platform?",
    answer:
      "Your pipeline, applications, drafts, contacts, and outreach sequences are isolated to your organization. A small number of reference datasets, like the corporate-giving prospect directory, are shared research infrastructure everyone reads from, and are called out specifically where that's the case rather than left ambiguous.",
  },
];

export default function FundingOperationsSoftwareClient() {
  return (
    <>
      <Section tone="forest">
        <Eyebrow>Solutions / Funding Operations Software</Eyebrow>
        <Display1 tone="forest">Grantseeking has an operations problem, too, not just a discovery problem.</Display1>
        <p style={{ color: mk.heroMuted, fontSize: 18, marginTop: 16, maxWidth: 700, lineHeight: 1.6 }}>
          Finding grants and writing narratives gets most of the attention. Someone still has to answer who
          can approve a submission, what happens when a funder's portal misbehaves, and whether there&rsquo;s
          an actual record of who signed off on what. This is the operational layer underneath the pipeline:
          role-based access, a real audit trail, and admin-level controls to stop automated work fast.
        </p>
        <div style={{ display: "flex", gap: 16, marginTop: 28, flexWrap: "wrap" }}>
          <CtaPrimary href="/demo">See the admin controls</CtaPrimary>
          <CtaGhost href="#roles" onDark>
            See the role model
          </CtaGhost>
        </div>
      </Section>

      <Section tone="tint">
        <Display2>The actual audit trail behind every approval</Display2>
        <p style={{ color: mk.ink, fontSize: 15, marginTop: 12, maxWidth: 680 }}>
          Not a mockup — the live Audit Log, captured from a running instance of the application.
        </p>
        <div
          style={{
            marginTop: 24,
            borderRadius: mkRadius.shot,
            overflow: "hidden",
            border: `1px solid ${mk.line}`,
            boxShadow: "0 12px 32px rgba(31,58,46,0.14)",
          }}
        >
          <Image
            src="/marketing/platform-audit-log-live.png"
            alt="The live Audit Log, showing a complete, timestamped record of who did what, down to the login session level"
            width={1440}
            height={900}
            priority
            style={{ width: "100%", height: "auto", display: "block" }}
          />
        </div>
      </Section>

      <Section tone="paper" id="roles">
        <Display2>Four roles, a real hierarchy</Display2>
        <p style={{ color: mk.ink, fontSize: 15, marginTop: 12, maxWidth: 680 }}>
          Owner, Admin, Writer, and Viewer are ranked, not flat — access to anything a lower role can do is
          included automatically.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20, marginTop: 24 }}>
          {ROLES.map((r) => (
            <Card key={r.label}>
              <div style={{ fontSize: 15, fontWeight: 700, color: mk.forest }}>{r.label}</div>
              <div style={{ fontSize: 14, color: mk.ink, marginTop: 8, lineHeight: 1.6 }}>{r.body}</div>
            </Card>
          ))}
        </div>
      </Section>

      <Section tone="surface">
        <Display2>What operations actually gets to see and control</Display2>
        <div style={{ display: "grid", gap: 16, marginTop: 24, maxWidth: 780 }}>
          {CONTROLS.map((c) => (
            <Card key={c.label}>
              <div style={{ fontSize: 15, fontWeight: 700, color: mk.forest }}>{c.label}</div>
              <div style={{ fontSize: 14, color: mk.ink, marginTop: 8, lineHeight: 1.7 }}>{c.body}</div>
            </Card>
          ))}
        </div>
      </Section>

      <Section tone="tint">
        <Display2>Stated limitations</Display2>
        <div style={{ display: "grid", gap: 16, marginTop: 24, maxWidth: 760 }}>
          <Card>
            <p style={{ color: mk.ink, fontSize: 15, lineHeight: 1.7, margin: 0 }}>
              There is no dedicated compliance-export or SOC-report download built for this yet — the audit
              trail exists and is queryable, but a packaged export for an outside auditor is on our roadmap,
              not shipped today.
            </p>
          </Card>
          <Card>
            <p style={{ color: mk.ink, fontSize: 15, lineHeight: 1.7, margin: 0 }}>
              Roles are per-organization, not per-application. A Writer with access to your organization has
              access to every application in it; there&rsquo;s no narrower, application-scoped permission
              today.
            </p>
          </Card>
        </div>
      </Section>

      <Section tone="paper">
        <Display2>FAQ</Display2>
        <div style={{ marginTop: 24, display: "grid", gap: 18, maxWidth: 760 }}>
          {FAQ_ITEMS.map((f) => (
            <div key={f.question}>
              <div style={{ fontSize: 16, fontWeight: 600, color: mk.forest }}>{f.question}</div>
              <div style={{ fontSize: 15, color: mk.ink, marginTop: 6, lineHeight: 1.6 }}>{f.answer}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section tone="tint">
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 20,
            background: mk.surface,
            border: `1px solid ${mk.line}`,
            borderRadius: mkRadius.shot,
            boxShadow: mkElevation[2],
            padding: 32,
          }}
        >
          <div style={{ maxWidth: 520 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: mk.terracotta, letterSpacing: 0.4 }}>
              FREE, NO ACCOUNT REQUIRED
            </div>
            <div style={{ fontFamily: "var(--mk-display)", fontSize: 24, color: mk.forest, marginTop: 8 }}>
              Evaluating this for your organization's own controls?
            </div>
            <p style={{ fontSize: 15, color: mk.ink, marginTop: 8 }}>
              Run the free Funding Potential Scan first, a short, no-signup check of the kind of funding your
              organization is likely to qualify for.
            </p>
          </div>
          <CtaPrimary href="/scan">Try the free Funding Potential Scan</CtaPrimary>
        </div>
      </Section>

      <Section tone="forest">
        <div style={{ textAlign: "center" }}>
          <Display2 tone="forest">Ask your operations questions on a real walkthrough</Display2>
          <p style={{ color: mk.heroMuted, fontSize: 17, marginTop: 16, maxWidth: 560, marginLeft: "auto", marginRight: "auto" }}>
            Bring your role, access, and audit questions to a full platform walkthrough with someone who can
            show you the actual controls.
          </p>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 28, flexWrap: "wrap" }}>
            <CtaPrimary href="/demo">See the admin controls</CtaPrimary>
            <CtaGhost href="/trust" onDark>
              Read Trust and Governance
            </CtaGhost>
          </div>
        </div>
      </Section>
    </>
  );
}
