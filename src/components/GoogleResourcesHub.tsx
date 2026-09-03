"use client";

import { useMemo, useState } from "react";
import type { ComponentType, SVGProps } from "react";
import {
  Building2,
  ExternalLink,
  HelpCircle,
  MapPin,
  Printer,
  TrendingUp,
} from "lucide-react";

import { SearchBar } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import knowledgeBase from "@/lib/google-nonprofit/research/knowledge-base.json";

const FOREST_GREEN = "#3D6B50";
const GOLD = "#C49A4F";

type KbSection = { name: string; content: string; steps: string[]; tips: string[] };

const KB_SECTIONS: KbSection[] = (
  knowledgeBase as { sections: KbSection[] }
).sections;

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

type TabId = "nonprofits-app" | "business-profile" | "optimization" | "faq";

type TabMeta = { id: TabId; label: string; kbName: string; icon: IconType };

const TABS: TabMeta[] = [
  { id: "nonprofits-app", label: "For Nonprofits App", kbName: "Google for Nonprofits Application", icon: Building2 },
  { id: "business-profile", label: "Business Profile Setup", kbName: "Business Profile Setup", icon: MapPin },
  { id: "optimization", label: "Optimization Tips", kbName: "Optimization Tips", icon: TrendingUp },
  { id: "faq", label: "FAQ", kbName: "FAQ", icon: HelpCircle },
];

function findSection(kbName: string): KbSection {
  return (
    KB_SECTIONS.find((s) => s.name === kbName) ?? {
      name: kbName,
      content: "",
      steps: [],
      tips: [],
    }
  );
}

function extractGoogleLinks(text: string): string[] {
  const regex = /\b(?:[a-zA-Z0-9-]+\.)*google\.com(?:\/[a-zA-Z0-9\-/]+)?/g;
  const matches = text.match(regex) ?? [];
  const cleaned = matches.map((m) => m.replace(/[.,)]+$/, ""));
  return Array.from(new Set(cleaned)).sort();
}

const OFFICIAL_LINKS = extractGoogleLinks(
  KB_SECTIONS.map((s) => `${s.content} ${s.steps.join(" ")} ${s.tips.join(" ")}`).join(" "),
).map((link) => ({ href: `https://${link}`, label: link }));

type FaqPair = { question: string; answer: string };

function parseFaqTip(tip: string): FaqPair | null {
  const match = /^Q:\s*(.+?)\s*A:\s*(.+)$/s.exec(tip);
  if (!match) return null;
  return { question: match[1] ?? "", answer: match[2] ?? "" };
}

function matchesSearch(text: string, term: string): boolean {
  return term === "" || text.toLowerCase().includes(term.toLowerCase());
}

function OfficialLinks() {
  if (OFFICIAL_LINKS.length === 0) return null;
  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-surface p-4 print:border-slate-300">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 print:text-black">
        Official Google resources
      </p>
      <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-1.5">
        {OFFICIAL_LINKS.map((link) => (
          <li key={link.href}>
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium hover:underline print:text-black"
              style={{ color: FOREST_GREEN }}
            >
              {link.label}
              <ExternalLink className="h-3 w-3 print:hidden" aria-hidden />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TabPanel({
  tab,
  index,
  isActive,
  searchTerm,
}: {
  tab: TabMeta;
  index: number;
  isActive: boolean;
  searchTerm: string;
}) {
  const section = useMemo(() => findSection(tab.kbName), [tab.kbName]);

  const filteredSteps = useMemo(
    () => section.steps.filter((step) => matchesSearch(step, searchTerm)),
    [section.steps, searchTerm],
  );

  const faqPairs = useMemo(
    () =>
      tab.id === "faq"
        ? section.tips.map(parseFaqTip).filter((p): p is FaqPair => p !== null)
        : [],
    [tab.id, section.tips],
  );

  const filteredTips = useMemo(
    () => (tab.id === "faq" ? [] : section.tips.filter((tip) => matchesSearch(tip, searchTerm))),
    [tab.id, section.tips, searchTerm],
  );

  const filteredFaqPairs = useMemo(
    () =>
      faqPairs.filter(
        (pair) => matchesSearch(pair.question, searchTerm) || matchesSearch(pair.answer, searchTerm),
      ),
    [faqPairs, searchTerm],
  );

  const hasResults =
    searchTerm === "" ||
    filteredSteps.length > 0 ||
    filteredTips.length > 0 ||
    filteredFaqPairs.length > 0;

  return (
    <div
      className={cn(
        isActive ? "block" : "hidden",
        "print:block",
        index > 0 && "print:break-before-page",
      )}
    >
      <div className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm print:border-none print:p-0 print:shadow-none sm:p-8">
        <h2 className="text-lg font-bold tracking-tight text-slate-900 print:text-black">
          {section.name}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 print:text-black">
          {section.content}
        </p>

        {!hasResults && (
          <p className="mt-6 text-sm italic text-slate-400">
            No matching content for &quot;{searchTerm}&quot;.
          </p>
        )}

        {filteredSteps.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold" style={{ color: FOREST_GREEN }}>
              Steps
            </h3>
            <ol className="mt-2 space-y-2">
              {filteredSteps.map((step, i) => (
                <li
                  key={step}
                  className="flex gap-3 text-sm leading-relaxed text-slate-700 print:text-black"
                >
                  <span
                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white print:border print:border-black print:bg-white print:text-black"
                    style={{ backgroundColor: FOREST_GREEN }}
                  >
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        )}

        {filteredTips.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold" style={{ color: GOLD }}>
              Tips
            </h3>
            <ul className="mt-2 space-y-2">
              {filteredTips.map((tip) => (
                <li
                  key={tip}
                  className="flex gap-2 text-sm leading-relaxed text-slate-700 print:text-black"
                >
                  <span
                    className="mt-1.5 h-1 w-1 shrink-0 rounded-full print:hidden"
                    style={{ backgroundColor: GOLD }}
                  />
                  {tip}
                </li>
              ))}
            </ul>
          </div>
        )}

        {filteredFaqPairs.length > 0 && (
          <dl className="mt-6 space-y-4">
            {filteredFaqPairs.map((pair) => (
              <div key={pair.question} className="border-b border-slate-100 pb-4 last:border-none">
                <dt className="text-sm font-semibold text-slate-900 print:text-black">
                  {pair.question}
                </dt>
                <dd className="mt-1 text-sm leading-relaxed text-slate-600 print:text-black">
                  {pair.answer}
                </dd>
              </div>
            ))}
          </dl>
        )}

        <OfficialLinks />
      </div>
    </div>
  );
}

export type GoogleResourcesHubProps = {
  /** Which tab is shown initially. Defaults to the "For Nonprofits App" tab. */
  defaultTab?: TabId;
};

export default function GoogleResourcesHub({
  defaultTab = "nonprofits-app",
}: GoogleResourcesHubProps) {
  const [activeTab, setActiveTab] = useState<TabId>(defaultTab);
  const [searchTerm, setSearchTerm] = useState("");

  const activeMeta = TABS.find((t) => t.id === activeTab) ?? TABS[0]!;

  return (
    <div className="mx-auto w-full max-w-5xl print:max-w-none">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Google Resources Hub</h1>
          <p className="mt-1 text-sm text-slate-500">
            Everything your organization needs to apply for Google for Nonprofits and set up a
            Google Business Profile.
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-surface px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
        >
          <Printer className="h-4 w-4" aria-hidden />
          Print
        </button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2 print:hidden">
        {TABS.map((tab) => {
          const TabIcon = tab.icon;
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors"
              style={
                isActive
                  ? { backgroundColor: FOREST_GREEN, borderColor: FOREST_GREEN, color: "white" }
                  : { backgroundColor: "white", borderColor: "#E2E8F0", color: "#475569" }
              }
            >
              <TabIcon className="h-4 w-4" aria-hidden />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="mb-6 print:hidden">
        <SearchBar
          key={activeTab}
          onSearch={setSearchTerm}
          placeholder={`Search ${activeMeta.label.toLowerCase()}...`}
          aria-label={`Search ${activeMeta.label}`}
        />
      </div>

      {TABS.map((tab, index) => (
        <TabPanel
          key={tab.id}
          tab={tab}
          index={index}
          isActive={tab.id === activeTab}
          searchTerm={tab.id === activeTab ? searchTerm : ""}
        />
      ))}
    </div>
  );
}
