import { getPilClient } from "@/lib/pil/db";
import type {
  MonitoringEvent,
  MonitoringSubscription,
  MonitoringSubscriptionStatus,
  MonitoringTriggerType,
} from "@/lib/pil/types";

// Monitoring Trigger Lifecycle (PROSPECT_INTELLIGENCE_ARCHITECTURE.md
// Section 1.6):
//   Subscription: active <-> paused
//   Event: new -> reviewed -> { actioned | dismissed }; new -> actioned

export interface CreateSubscriptionParams {
  orgId: string;
  prospectId: string;
  triggerTypes: MonitoringTriggerType[];
}

export async function createSubscription(
  params: CreateSubscriptionParams,
): Promise<MonitoringSubscription> {
  const { data, error } = await getPilClient()
    .from("pil_monitoring_subscriptions")
    .insert({
      organization_id: params.orgId,
      prospect_id: params.prospectId,
      trigger_types: params.triggerTypes,
      status: "active" as MonitoringSubscriptionStatus,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as MonitoringSubscription;
}

// Entry point a scheduler/agent calls before running trigger detection for a
// subscription. Detection itself (crawling sources for the subscribed
// trigger_types) is a separate agent concern (BEN-QLF-05/BEN-STR-04, per
// Section 1.6) -- this only validates the subscription is live so callers
// don't run detection work against a paused or missing subscription.
export async function checkSubscription(subscriptionId: string): Promise<void> {
  const { data, error } = await getPilClient()
    .from("pil_monitoring_subscriptions")
    .select("*")
    .eq("id", subscriptionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error(`Monitoring subscription ${subscriptionId} not found`);
  }
  const subscription = data as MonitoringSubscription;
  if (subscription.status !== "active") {
    return;
  }
}

export async function recordEvent(
  event: Omit<MonitoringEvent, "id" | "detected_at">,
): Promise<MonitoringEvent> {
  const { data, error } = await getPilClient()
    .from("pil_monitoring_events")
    .insert({ ...event, status: event.status ?? "new" })
    .select("*")
    .single();
  if (error) throw error;
  return data as MonitoringEvent;
}

export async function getEvents(orgId: string, prospectId?: string): Promise<MonitoringEvent[]> {
  let query = getPilClient().from("pil_monitoring_events").select("*").eq("organization_id", orgId);
  if (prospectId) {
    query = query.eq("prospect_id", prospectId);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as MonitoringEvent[];
}
