import {
  Bell,
  Bot,
  Calendar,
  CheckCircle2,
  FileText,
  Key,
  Lightbulb,
  Search,
  Star,
  Target,
  TriangleAlert,
  Trophy,
  BarChart3,
  Zap,
  type LucideIcon,
} from "lucide-react";

import type { NotificationEventType } from "@/lib/services/notification-dispatcher";

// Shared icon/color treatment for automation_notifications rows, used by both
// NotificationBell (header dropdown) and the /notifications page so the two
// surfaces never drift out of sync. Hardcoded hex per BLUEPRINT §7.5 — no
// Tailwind color tokens.
export interface NotificationEventMeta {
  label: string;
  icon: LucideIcon;
  color: string;
  /** Failure/urgent events get a pulsing icon treatment. */
  critical?: boolean;
}

export const NOTIFICATION_EVENT_META: Record<NotificationEventType, NotificationEventMeta> = {
  automation_completed: { label: "Automation Completed", icon: CheckCircle2, color: "#0EA5E9" },
  automation_failed: { label: "Automation Failed", icon: TriangleAlert, color: "#EF4444", critical: true },
  automation_paused: { label: "Automation Paused", icon: Bot, color: "#F59E0B" },
  deadline_approaching: { label: "Deadline Approaching", icon: Calendar, color: "#EF4444", critical: true },
  agent_completed: { label: "Agent Completed", icon: CheckCircle2, color: "#0EA5E9" },
  agent_failed: { label: "Agent Failed", icon: TriangleAlert, color: "#EF4444", critical: true },
  key_expired: { label: "Integration Key Expired", icon: Key, color: "#EF4444", critical: true },
  target_paused: { label: "Scraping Target Paused", icon: Target, color: "#F59E0B" },
  daily_limit_reached: { label: "Daily Limit Reached", icon: Zap, color: "#F59E0B" },
  new_opportunity: { label: "New Opportunity", icon: Search, color: "#0096C7" },
  application_submitted: { label: "Application Submitted", icon: FileText, color: "#0F766E" },
  award_received: { label: "Award Received", icon: Trophy, color: "#10B981" },
  research_complete: { label: "Research Complete", icon: CheckCircle2, color: "#0EA5E9" },
  autoapply_complete: { label: "AutoApply Complete", icon: CheckCircle2, color: "#0EA5E9" },
  draft_ready: { label: "Draft Ready for Review", icon: FileText, color: "#8B5CF6" },
  donor_intent_signal: { label: "High Donor Intent Signal", icon: Zap, color: "#F59E0B" },
  strategic_recommendation: { label: "Strategic Recommendation", icon: Star, color: "#C9A84C" },
  community_need_signal: { label: "Community Need Signal", icon: BarChart3, color: "#F97316" },
  improvement_proposal: { label: "Agent Improvement Proposal", icon: Lightbulb, color: "#10B981" },
};

/** Event types treated as "urgent" priority by the notification bell's filter. */
export const URGENT_EVENT_TYPES: NotificationEventType[] = [
  "automation_failed",
  "agent_failed",
  "key_expired",
  "deadline_approaching",
];

/** Event types treated as "immediate" priority — needs attention but isn't a failure. */
export const IMMEDIATE_EVENT_TYPES: NotificationEventType[] = [
  "daily_limit_reached",
  "target_paused",
  "automation_paused",
  "donor_intent_signal",
  "strategic_recommendation",
  "improvement_proposal",
  "community_need_signal",
];

export type NotificationPriority = "urgent" | "immediate" | "normal";

export function notificationPriority(eventType: string): NotificationPriority {
  if (URGENT_EVENT_TYPES.includes(eventType as NotificationEventType)) return "urgent";
  if (IMMEDIATE_EVENT_TYPES.includes(eventType as NotificationEventType)) return "immediate";
  return "normal";
}

export function notificationEventMeta(eventType: string): NotificationEventMeta {
  return (
    NOTIFICATION_EVENT_META[eventType as NotificationEventType] ?? {
      label: eventType,
      icon: Bell,
      color: "#64748B",
    }
  );
}
