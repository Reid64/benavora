import {
  AlertCircle,
  BarChart2,
  Bot,
  Brain,
  CheckCircle2,
  ClipboardList,
  FileText,
  Mail,
  RefreshCw,
  Search,
  Send,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import { cn } from "@/lib/utils/cn";

export type RecentActivityItem = {
  id: string;
  agentType: string;
  status: string | null;
  outputSummary: string | null;
  createdAt: string;
};

const AGENT_ICON: Record<string, LucideIcon> = {
  corporate_research: Search,
  foundation_research: Search,
  government_research: Search,
  local_sponsorship: Search,
  grants_gov_research: Search,
  sam_gov_research: Search,
  propublica_mining: Search,
  state_portal: Search,
  custom_api_research: Search,
  custom_scrape_research: Search,
  narrative_drafting: FileText,
  budget_builder: FileText,
  follow_up_generator: FileText,
  application_cloning: FileText,
  browser_automation: Send,
  form_analyzer: ClipboardList,
  form_filler: Send,
  eligibility_scoring: CheckCircle2,
  compliance_check: CheckCircle2,
  compliance_calendar: CheckCircle2,
  consensus_validation: CheckCircle2,
  review: CheckCircle2,
  recursive_learning: RefreshCw,
  financial_reconciliation: BarChart2,
  success_probability: BarChart2,
  cold_outreach: Mail,
  email_campaign: Mail,
  email_matching: Mail,
  email_parser: Mail,
  notification_dispatcher: Mail,
  funder_intel: Brain,
  funder_relationship: Users,
  competitor_intelligence: Brain,
  competitor_intel: Brain,
  semantic_matching: Brain,
  deadline_prediction: Brain,
  giving_history_extractor: Search,
  giving_history: Search,
};

const AGENT_LABEL: Record<string, string> = {
  corporate_research: "Corporate research",
  foundation_research: "Foundation research",
  government_research: "Government grant search",
  local_sponsorship: "Local sponsorship research",
  grants_gov_research: "Grants.gov search",
  sam_gov_research: "SAM.gov search",
  propublica_mining: "ProPublica 990 mining",
  state_portal: "State portal scrape",
  custom_api_research: "Custom API research",
  custom_scrape_research: "Web scraping",
  narrative_drafting: "Draft generated",
  budget_builder: "Budget built",
  follow_up_generator: "Follow-up generated",
  application_cloning: "Application cloned",
  browser_automation: "Form automation",
  form_analyzer: "Form analyzed",
  form_filler: "Form filled",
  eligibility_scoring: "Eligibility scored",
  compliance_check: "Compliance check",
  compliance_calendar: "Compliance calendar",
  consensus_validation: "Consensus validation",
  review: "Application reviewed",
  recursive_learning: "Learning pass",
  financial_reconciliation: "Financial reconciliation",
  success_probability: "Success probability scored",
  cold_outreach: "Outreach drafted",
  email_campaign: "Email campaign",
  email_matching: "Email matched",
  email_parser: "Email parsed",
  notification_dispatcher: "Notification sent",
  funder_intel: "Funder intelligence updated",
  funder_relationship: "Relationship scored",
  competitor_intelligence: "Competitor analysis",
  competitor_intel: "Competitor analysis",
  semantic_matching: "Funder match",
  deadline_prediction: "Deadline predicted",
  giving_history_extractor: "Giving history extracted",
  giving_history: "Giving history extracted",
  grant_summary: "Grant summarized",
  fit_analysis: "Fit analysis",
  deadline_extraction: "Deadlines extracted",
  csv_import: "CSV import",
  automation_worker: "Automation task",
};

function humanize(type: string): string {
  return type
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function RecentActivityFeed({ items }: { items: RecentActivityItem[] }) {
  if (items.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-navy-400">
        No agent activity yet. Run a research task to get started.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-navy-50">
      {items.map((item) => {
        const Icon = AGENT_ICON[item.agentType] ?? Bot;
        const label = AGENT_LABEL[item.agentType] ?? humanize(item.agentType);
        const failed = item.status === "failed";

        return (
          <li key={item.id} className="flex items-start gap-3 py-2.5">
            <span
              className={cn(
                "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                failed ? "bg-red-50 text-red-500" : "bg-navy-50 text-navy-500",
              )}
            >
              {failed ? (
                <AlertCircle className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Icon className="h-3.5 w-3.5" aria-hidden />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                <span className="font-medium text-navy-800">{label}</span>
                {item.outputSummary ? (
                  <span className="ml-1 text-navy-400">
                    &mdash; {item.outputSummary}
                  </span>
                ) : failed ? (
                  <span className="ml-1 text-red-400">Failed</span>
                ) : null}
              </p>
            </div>
            <span className="shrink-0 text-xs text-navy-400">
              {formatDistanceToNow(new Date(item.createdAt), {
                addSuffix: true,
              })}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
