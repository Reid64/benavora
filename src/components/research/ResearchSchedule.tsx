"use client";

import { CalendarClock, Power } from "lucide-react";

import { Badge, Button, Card } from "@/components/ui";
import type { AgentType } from "@/types/agents";
import { formatRelative } from "@/lib/utils/formatters";

/** Next-run projection for one research family, computed by the page. */
export type FamilySchedule = {
  agentType: AgentType;
  label: string;
  cadence: string;
  /** Active profiles in scope for this family. */
  profileCount: number;
  /** Projected next automated run, or null when no profiles are in scope. */
  nextRunAt: string | null;
  /** True when at least one in-scope profile is already due. */
  due: boolean;
};

export type ResearchScheduleProps = {
  schedules: FamilySchedule[];
  /** Whether the scheduled sweep is enabled (feature.research_agents). */
  cronEnabled: boolean;
  /** Whether the current role may toggle the sweep (owner/admin). */
  canToggle: boolean;
  /** Toggle write in flight. */
  saving: boolean;
  /** Error from the most recent toggle, if any. */
  toggleError: string | null;
  onToggle: (next: boolean) => void;
};

/**
 * Research schedule + automation control (BLUEPRINT §3.1, AGENTS.md Agents
 * 12-15). Shows when each agent family will next run under the daily cron sweep
 * (06:00 UTC) and lets an owner/admin enable or disable the sweep, which writes
 * platform_config feature.research_agents. Presentational - the page owns the
 * data and the write.
 */
export function ResearchSchedule({
  schedules,
  cronEnabled,
  canToggle,
  saving,
  toggleError,
  onToggle,
}: ResearchScheduleProps) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-navy-900">Schedule</h2>
        <div className="flex items-center gap-3">
          <Badge color={cronEnabled ? "green" : "gray"} withDot>
            {cronEnabled ? "Automation on" : "Automation off"}
          </Badge>
          {canToggle && (
            <Button
              variant={cronEnabled ? "secondary" : "primary"}
              size="sm"
              isLoading={saving}
              onClick={() => onToggle(!cronEnabled)}
            >
              <Power className="h-4 w-4" aria-hidden />
              {cronEnabled ? "Disable" : "Enable"}
            </Button>
          )}
        </div>
      </div>

      {toggleError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {toggleError}
        </div>
      )}

      <Card>
        <p className="flex items-center gap-2 text-sm text-navy-500">
          <CalendarClock className="h-4 w-4 text-navy-400" aria-hidden />
          The scheduled sweep runs daily at 06:00 UTC. Each family runs on its own
          cadence; runs only happen while automation is on.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {schedules.map((s) => (
            <div
              key={s.agentType}
              className="rounded-lg border border-navy-100 px-4 py-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-navy-800">{s.label}</span>
                <Badge color="blue">{s.cadence}</Badge>
              </div>
              <p className="mt-1 text-xs text-navy-400">
                {s.profileCount === 0
                  ? "No active profiles in scope"
                  : `${s.profileCount} active profile${s.profileCount === 1 ? "" : "s"}`}
              </p>
              <p className="mt-1 text-sm text-navy-600">
                {s.profileCount === 0
                  ? "-"
                  : !cronEnabled
                    ? "Paused (automation off)"
                    : s.due
                      ? "Due on next sweep"
                      : `Next run ${formatRelative(s.nextRunAt)}`}
              </p>
            </div>
          ))}
        </div>
      </Card>

      {!canToggle && (
        <p className="text-xs text-navy-400">
          Only an owner or admin can enable or disable scheduled research.
        </p>
      )}
    </section>
  );
}
