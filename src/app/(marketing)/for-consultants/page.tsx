"use client";

import { useState } from "react";

// Pricing model for grant-writing agencies / consultants.
const MONTHLY_BASE = 2999;
const MONTHLY_PER_CLIENT = 299;
const SETUP_BASE = 4999;
const SETUP_PER_CLIENT = 499;
const MIN_CLIENTS = 2;
const MAX_CLIENTS = 20;

const FEATURES: { title: string; body: string }[] = [
  {
    title: "Multi-client dashboard",
    body: "Run every client's pipeline from one workspace — opportunities, deadlines, drafts, and submissions side by side.",
  },
  {
    title: "Per-client KB isolation",
    body: "Each client gets its own row-level-secured Knowledge Base. Mission, budgets, and narratives never bleed across accounts.",
  },
  {
    title: "White-label drafts",
    body: "Generate applications in each client's voice and brand. Deliver finished narratives with no Benavora branding.",
  },
  {
    title: "AutoApply at scale",
    body: "Queue automated form completion and submission across your entire book of business, with full audit trails per client.",
  },
];

function fmt(n: number): string {
  return "$" + n.toLocaleString("en-US");
}

export default function ForConsultantsPage() {
  const [clients, setClients] = useState(5);

  const monthly = MONTHLY_BASE + MONTHLY_PER_CLIENT * clients;
  const setup = SETUP_BASE + SETUP_PER_CLIENT * clients;

  return (
    <div className="px-6">
      {/* Hero */}
      <section className="mx-auto max-w-4xl pb-12 pt-20 text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-orange-400">
          For Grant-Writing Agencies &amp; Consultants
        </p>
        <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight text-white sm:text-5xl">
          Scale Your{" "}
          <span className="bg-gradient-to-r from-orange-400 via-amber-300 to-orange-500 bg-clip-text text-transparent">
            Grant Writing Practice
          </span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-gray-300">
          Benavora gives consultants the leverage to serve more nonprofits
          without adding headcount — research, drafting, and submission
          automated across every client you manage.
        </p>
        <div className="mt-8 flex justify-center">
          <a
            href="mailto:sales@benavora.com?subject=Benavora%20Agency%20Demo"
            className="rounded-lg bg-orange-500 px-7 py-3 text-sm font-semibold text-white shadow-lg shadow-orange-900/30 transition hover:bg-orange-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a1a]"
          >
            Schedule a Demo
          </a>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-5xl py-12">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-6"
            >
              <h3 className="text-lg font-semibold text-white">{f.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-gray-400">
                {f.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing + calculator */}
      <section className="mx-auto max-w-3xl py-12">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white">
            Agency{" "}
            <span className="bg-gradient-to-r from-orange-400 to-orange-600 bg-clip-text text-transparent">
              Pricing
            </span>
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-gray-400">
            {fmt(MONTHLY_BASE)}/mo base + {fmt(MONTHLY_PER_CLIENT)}/client/mo.
            One-time setup of {fmt(SETUP_BASE)} + {fmt(SETUP_PER_CLIENT)}/client.
          </p>
        </div>

        <div className="mt-10 rounded-2xl border border-white/10 bg-white/[0.03] p-8">
          <div className="flex items-baseline justify-between">
            <label htmlFor="clients" className="text-sm font-medium text-gray-300">
              Number of clients
            </label>
            <span className="font-mono text-2xl font-bold text-orange-400">
              {clients}
            </span>
          </div>

          <input
            id="clients"
            type="range"
            min={MIN_CLIENTS}
            max={MAX_CLIENTS}
            step={1}
            value={clients}
            onChange={(e) => setClients(Number(e.target.value))}
            className="mt-4 w-full accent-orange-500"
            aria-label="Number of clients"
          />
          <div className="mt-1 flex justify-between text-xs text-gray-500">
            <span>{MIN_CLIENTS}</span>
            <span>{MAX_CLIENTS}</span>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-[#0a0a1a] p-5 text-center">
              <p className="text-xs uppercase tracking-wide text-gray-500">
                Monthly
              </p>
              <p className="mt-1 font-mono text-3xl font-bold text-white">
                {fmt(monthly)}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {fmt(MONTHLY_BASE)} base + {clients} &times;{" "}
                {fmt(MONTHLY_PER_CLIENT)}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#0a0a1a] p-5 text-center">
              <p className="text-xs uppercase tracking-wide text-gray-500">
                One-time setup
              </p>
              <p className="mt-1 font-mono text-3xl font-bold text-white">
                {fmt(setup)}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {fmt(SETUP_BASE)} base + {clients} &times;{" "}
                {fmt(SETUP_PER_CLIENT)}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-8 flex justify-center">
          <a
            href="mailto:sales@benavora.com?subject=Benavora%20Agency%20Demo"
            className="rounded-lg bg-orange-500 px-7 py-3 text-sm font-semibold text-white shadow-lg shadow-orange-900/30 transition hover:bg-orange-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a1a]"
          >
            Schedule a Demo
          </a>
        </div>
      </section>

      {/* Compliance note */}
      <section className="mx-auto max-w-3xl pb-20">
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 text-sm leading-relaxed text-gray-500">
          <span className="font-medium text-gray-400">
            A note on compliance:
          </span>{" "}
          Benavora is licensed on a flat subscription basis. Charging grant
          applicants a fee contingent on receiving an award is prohibited for
          federal awards under{" "}
          <span className="text-gray-400">2 CFR 200.458</span> (pre-award costs)
          and related cost principles. Agencies using Benavora are responsible
          for structuring their own client engagements to comply with
          contingency-fee restrictions and applicable funder rules.
        </div>
      </section>
    </div>
  );
}
