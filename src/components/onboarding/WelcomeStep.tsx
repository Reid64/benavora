"use client";

import { FileText, Search, Sparkles, Target, Users } from "lucide-react";

/**
 * Step 1 - branded welcome screen. Purely informational; sets expectations for
 * the four setup steps that follow. Matches the login brand panel styling
 * (navy field, teal/plum glow, gradient "B" mark, tagline).
 */
export function WelcomeStep({ orgName }: { orgName: string }) {
  const highlights = [
    {
      icon: Target,
      title: "Tell us about your organization",
      body: "Your name, EIN, and mission feed every AI-drafted proposal.",
    },
    {
      icon: FileText,
      title: "Stage your key documents",
      body: "Your 501(c)(3) letter and W-9, ready to attach in one click.",
    },
    {
      icon: Users,
      title: "Track your first funder",
      body: "Start the CRM with a foundation or grantmaker you care about.",
    },
    {
      icon: Search,
      title: "Set your grant radar",
      body: "Keywords tell the research agents what funding to surface.",
    },
  ];

  return (
    <div className="space-y-8">
      <div className="relative overflow-hidden rounded-2xl bg-navy-900 px-8 py-10 text-white">
        <div
          className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-teal-500/30 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-24 -left-12 h-72 w-72 rounded-full bg-primary/25 blur-3xl"
          aria-hidden
        />
        <div className="relative z-10">
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-teal-400 to-teal-600 font-bold shadow-lg shadow-teal-900/40">
              B
            </span>
            <span className="text-lg font-semibold tracking-tight">Benavora</span>
          </div>
          <h2 className="mt-6 flex items-center gap-2 text-3xl font-bold leading-tight tracking-tight">
            <Sparkles className="h-7 w-7 text-teal-400" aria-hidden />
            Welcome{orgName ? `, ${orgName}` : ""}
          </h2>
          <p className="mt-3 max-w-xl text-navy-200">
            Let&rsquo;s get your workspace ready. In a few short steps we&rsquo;ll
            set up the essentials so the AI can start finding and drafting grants
            on day one.
          </p>
          <p className="mt-5 text-sm font-medium tracking-tight text-teal-300">
            Fund More. <span className="text-accent">Do More.</span> Change More.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {highlights.map(({ icon: Icon, title, body }) => (
          <div
            key={title}
            className="flex gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
              <Icon className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="font-medium text-navy-900">{title}</p>
              <p className="mt-0.5 text-sm text-navy-500">{body}</p>
            </div>
          </div>
        ))}
      </div>

      <p className="text-sm text-navy-500">
        This takes about 5 minutes. You can skip any step and finish later -
        we&rsquo;ll save your progress as you go.
      </p>
    </div>
  );
}
