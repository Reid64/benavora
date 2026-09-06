"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Section, Display1, Display2 } from "@/components/marketing/Section";
import { CtaPrimary, CtaGhost } from "@/components/marketing/Cta";
import { AssistInline } from "@/components/marketing/AssistInline";
import { mk, mkRadius } from "@/lib/marketing/theme";
import type { MarketingPage, DemoKind } from "@/lib/marketing/content";

const DEMO_LABEL: Record<DemoKind, string> = {
  replay: "AutoApply Replay",
  theater: "Draft Generator Theater",
  analysis: "Opportunity Analysis",
  pipeline: "Pipeline Walk-through",
  assist: "Benavora Assist",
  none: "",
};

export function DemoSlot({ kind }: { kind?: DemoKind }) {
  if (!kind || kind === "none") return null;
  return (
    <div
      style={{
        background: mk.surface,
        border: `1px solid ${mk.line}`,
        borderRadius: mkRadius.shot,
        padding: 32,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: mk.muted, letterSpacing: 0.4 }}>
        INTERACTIVE
      </div>
      <div style={{ fontFamily: "var(--mk-display)", fontSize: 22, color: mk.forest, marginTop: 8 }}>
        {DEMO_LABEL[kind]}
      </div>
      <div style={{ fontSize: 14, color: mk.muted, marginTop: 8 }}>
        Runs on a recorded fixture. No live account data, no submissions.
      </div>
    </div>
  );
}

function Eyebrow({ tone, children }: { tone: "forest" | "paper"; children: ReactNode }) {
  const color = tone === "forest" ? mk.heroMuted : mk.terracotta;
  return (
    <div style={{ fontSize: 13, fontWeight: 600, color, letterSpacing: 0.6, marginBottom: 12 }}>
      {children}
    </div>
  );
}

function ProseBody({ children }: { children: ReactNode }) {
  return (
    <div style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7, maxWidth: 760 }}>{children}</div>
  );
}

function CtaBand({ title }: { title: string }) {
  return (
    <Section tone="forest">
      <div style={{ textAlign: "center" }}>
        <Display2 tone="forest">{title}</Display2>
        <div
          style={{
            display: "flex",
            gap: 16,
            justifyContent: "center",
            marginTop: 28,
            flexWrap: "wrap",
          }}
        >
          <CtaPrimary href="/demo">Book a demo</CtaPrimary>
          <CtaGhost href="/pricing" onDark>
            See pricing
          </CtaGhost>
        </div>
      </div>
    </Section>
  );
}

export function PlatformTemplate({
  page,
  children,
  related = [],
}: {
  page: MarketingPage;
  children: ReactNode;
  related?: { href: string; title: string }[];
}) {
  const { meta } = page;
  return (
    <>
      <Section tone="forest">
        <Eyebrow tone="forest">{meta.eyebrow ?? "Platform"}</Eyebrow>
        <Display1 tone="forest">{meta.title}</Display1>
        {meta.hero ? (
          <p style={{ color: mk.heroMuted, fontSize: 18, marginTop: 16, maxWidth: 640 }}>
            {meta.hero}
          </p>
        ) : null}
        <div style={{ display: "flex", gap: 16, marginTop: 28, flexWrap: "wrap" }}>
          <CtaPrimary href="/demo">Book demo</CtaPrimary>
          <CtaGhost href="#demo" onDark>
            See it run
          </CtaGhost>
        </div>
      </Section>

      {meta.demo && meta.demo !== "none" ? (
        <Section tone="tint" id="demo">
          <DemoSlot kind={meta.demo} />
        </Section>
      ) : null}

      {meta.problems?.length ? (
        <Section tone="paper">
          <Display2>Problem solved</Display2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 20,
              marginTop: 28,
            }}
          >
            {meta.problems.map((p, i) => (
              <div
                key={i}
                style={{
                  background: mk.surface,
                  border: `1px solid ${mk.line}`,
                  borderRadius: mkRadius.card,
                  padding: 20,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: mk.muted }}>THE MANUAL WAY</div>
                <div style={{ fontSize: 15, color: mk.ink, marginTop: 6 }}>{p.problem}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: mk.terracotta, marginTop: 14 }}>
                  WITH BENAVORA
                </div>
                <div style={{ fontSize: 15, color: mk.ink, marginTop: 6 }}>{p.solution}</div>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {meta.capabilities?.length ? (
        <Section tone="tint">
          <Display2>Key capabilities</Display2>
          <div style={{ display: "grid", gap: 16, marginTop: 24 }}>
            {meta.capabilities.map((c, i) => (
              <div key={i} style={{ borderBottom: `1px solid ${mk.line}`, paddingBottom: 16 }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: mk.forest }}>{c.title}</div>
                <div style={{ fontSize: 15, color: mk.ink, marginTop: 4 }}>{c.body}</div>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {meta.steps?.length ? (
        <Section tone="paper">
          <Display2>How the AI works</Display2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 20,
              marginTop: 28,
            }}
          >
            {meta.steps.map((s, i) => (
              <div key={i}>
                <div style={{ fontSize: 13, fontWeight: 600, color: mk.terracotta }}>
                  STEP {i + 1}
                </div>
                <div style={{ fontSize: 16, fontWeight: 600, color: mk.forest, marginTop: 6 }}>
                  {s.title}
                </div>
                <div style={{ fontSize: 15, color: mk.ink, marginTop: 6 }}>{s.body}</div>
                <div style={{ fontSize: 13, color: mk.muted, marginTop: 10 }}>
                  Agent: {s.agent}
                </div>
                <div style={{ fontSize: 13, color: mk.muted, marginTop: 2 }}>
                  Human control: {s.humanGate}
                </div>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      <Section tone="surface">
        <Display2>Sample output</Display2>
        <div style={{ marginTop: 24 }}>
          <ProseBody>{children}</ProseBody>
        </div>
      </Section>

      {related.length ? (
        <Section tone="tint">
          <Display2>Related capabilities</Display2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 16,
              marginTop: 24,
            }}
          >
            {related.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: "block",
                  background: mk.surface,
                  border: `1px solid ${mk.line}`,
                  borderRadius: mkRadius.card,
                  padding: 18,
                  color: mk.forest,
                  fontWeight: 600,
                  fontSize: 15,
                  textDecoration: "none",
                }}
              >
                {item.title}
              </Link>
            ))}
          </div>
        </Section>
      ) : null}

      {meta.faq?.length ? (
        <Section tone="paper">
          <Display2>FAQ</Display2>
          <div style={{ marginTop: 24, display: "grid", gap: 18 }}>
            {meta.faq.map((f, i) => (
              <div key={i}>
                <div style={{ fontSize: 16, fontWeight: 600, color: mk.forest }}>{f.question}</div>
                <div style={{ fontSize: 15, color: mk.ink, marginTop: 6 }}>{f.answer}</div>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      <CtaBand title="See it work on your NOFOs" />
    </>
  );
}

export function SolutionTemplate({ page, children }: { page: MarketingPage; children: ReactNode }) {
  const { meta } = page;
  return (
    <>
      <Section tone="forest">
        <Eyebrow tone="forest">{meta.eyebrow ?? "Solutions for"}</Eyebrow>
        <Display1 tone="forest">{meta.title}</Display1>
        {meta.hero ? (
          <p style={{ color: mk.heroMuted, fontSize: 18, marginTop: 16, maxWidth: 640 }}>
            {meta.hero}
          </p>
        ) : null}
        <div style={{ marginTop: 28 }}>
          <CtaPrimary href="/demo">Book demo</CtaPrimary>
        </div>
      </Section>

      {meta.problems?.length ? (
        <Section tone="tint">
          <Display2>The funding problems this org type has</Display2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 20,
              marginTop: 28,
            }}
          >
            {meta.problems.map((p, i) => (
              <div
                key={i}
                style={{
                  background: mk.surface,
                  border: `1px solid ${mk.line}`,
                  borderRadius: mkRadius.card,
                  padding: 20,
                }}
              >
                <div style={{ fontSize: 15, fontWeight: 600, color: mk.forest }}>{p.problem}</div>
                <div style={{ fontSize: 15, color: mk.ink, marginTop: 8 }}>{p.solution}</div>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {meta.capabilities?.length ? (
        <Section tone="paper">
          <Display2>Which platform capabilities answer this</Display2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 16,
              marginTop: 24,
            }}
          >
            {meta.capabilities.map((c, i) =>
              c.href ? (
                <Link
                  key={i}
                  href={c.href}
                  style={{
                    display: "block",
                    background: mk.surface,
                    border: `1px solid ${mk.line}`,
                    borderRadius: mkRadius.card,
                    padding: 18,
                    textDecoration: "none",
                  }}
                >
                  <div style={{ fontSize: 15, fontWeight: 600, color: mk.forest }}>{c.title}</div>
                  <div style={{ fontSize: 14, color: mk.ink, marginTop: 6 }}>{c.body}</div>
                </Link>
              ) : (
                <div
                  key={i}
                  style={{
                    background: mk.surface,
                    border: `1px solid ${mk.line}`,
                    borderRadius: mkRadius.card,
                    padding: 18,
                  }}
                >
                  <div style={{ fontSize: 15, fontWeight: 600, color: mk.forest }}>{c.title}</div>
                  <div style={{ fontSize: 14, color: mk.ink, marginTop: 6 }}>{c.body}</div>
                </div>
              )
            )}
          </div>
        </Section>
      ) : null}

      <Section tone="surface">
        <ProseBody>{children}</ProseBody>
      </Section>

      {meta.faq?.length ? (
        <Section tone="paper">
          <Display2>FAQ</Display2>
          <div style={{ marginTop: 24, display: "grid", gap: 18 }}>
            {meta.faq.map((f, i) => (
              <div key={i}>
                <div style={{ fontSize: 16, fontWeight: 600, color: mk.forest }}>{f.question}</div>
                <div style={{ fontSize: 15, color: mk.ink, marginTop: 6 }}>{f.answer}</div>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      <CtaBand title="Built for how your organization is actually funded" />
    </>
  );
}

export function SingleTemplate({ page, children }: { page: MarketingPage; children: ReactNode }) {
  const { meta } = page;
  const isDemo = meta.slug === "demo";
  return (
    <>
      {meta.hero ? (
        <Section tone="forest">
          {meta.eyebrow ? <Eyebrow tone="forest">{meta.eyebrow}</Eyebrow> : null}
          <Display1 tone="forest">{meta.title}</Display1>
          <p style={{ color: mk.heroMuted, fontSize: 18, marginTop: 16, maxWidth: 640 }}>
            {meta.hero}
          </p>
        </Section>
      ) : null}

      <Section tone="paper">
        <ProseBody>{children}</ProseBody>
      </Section>

      {meta.demo === "assist" ? (
        <Section tone="tint" id="ask">
          <Display2>Ask Benavora Assist</Display2>
          <div style={{ marginTop: 24 }}>
            <AssistInline />
          </div>
        </Section>
      ) : null}

      {isDemo ? null : <CtaBand title="See what your organization qualifies for" />}
    </>
  );
}
