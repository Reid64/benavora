"use client";

// Row #77 Multi-Channel Outreach. Lets a writer generate a real, personalized
// LinkedIn note / call talking points / mail letter for this contact via
// Claude, and logs a real task for a human to actually send/place/mail -
// no automated LinkedIn API calls, no automated dialing, no automated mail
// submission. Channel options sit alongside the contact's existing
// mailto:/tel: links (the "email" and "phone" channels that already work
// manually) in ContactDetail.tsx.

import { useCallback, useEffect, useState } from "react";
import { Download, FileText, Linkedin, Loader2, Phone } from "lucide-react";

import { Badge, Button, Card } from "@/components/ui";
import type { BadgeColor } from "@/components/ui";
import { formatDate, formatRelative } from "@/lib/utils/formatters";
import type { Tables } from "@/types/database";

type ContactTask = Tables<"contact_tasks">;
type TaskType = "linkedin_message" | "call" | "mail_letter";

const TASK_META: Record<TaskType, { label: string; icon: typeof Linkedin; badge: BadgeColor }> = {
  linkedin_message: { label: "LinkedIn", icon: Linkedin, badge: "indigo" },
  call: { label: "Call", icon: Phone, badge: "green" },
  mail_letter: { label: "Physical Mail", icon: FileText, badge: "yellow" },
};

const STATUS_BADGE: Record<string, BadgeColor> = {
  pending: "yellow",
  completed: "green",
  cancelled: "gray",
};

export function ContactOutreachPanel({ contactId }: { contactId: string }) {
  const [tasks, setTasks] = useState<ContactTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<TaskType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/contacts/${contactId}/tasks`);
      if (!res.ok) throw new Error("load failed");
      const data = (await res.json()) as { tasks: ContactTask[] };
      setTasks(data.tasks ?? []);
    } catch {
      setError("Could not load outreach tasks.");
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function generate(taskType: TaskType) {
    setError(null);
    setGenerating(taskType);
    const endpoint =
      taskType === "linkedin_message" ? "linkedin" : taskType === "call" ? "call" : "mail";
    try {
      const res = await fetch(`/api/contacts/${contactId}/outreach/${endpoint}`, { method: "POST" });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(payload.error ?? "Could not generate the draft.");
        return;
      }
      await load();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setGenerating(null);
    }
  }

  async function setStatus(taskId: string, status: "completed" | "cancelled" | "pending") {
    setBusyTaskId(taskId);
    try {
      const res = await fetch(`/api/contacts/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("update failed");
      await load();
    } catch {
      setError("Could not update the task.");
    } finally {
      setBusyTaskId(null);
    }
  }

  async function download(taskId: string) {
    try {
      const res = await fetch(`/api/contacts/tasks/${taskId}/download`);
      const payload = (await res.json().catch(() => ({}))) as { downloadUrl?: string; error?: string };
      if (!res.ok || !payload.downloadUrl) {
        setError(payload.error ?? "Could not generate a download link.");
        return;
      }
      window.open(payload.downloadUrl, "_blank", "noopener,noreferrer");
    } catch {
      setError("Could not reach the server.");
    }
  }

  return (
    <Card title="Outreach" className="lg:col-span-2">
      <p className="text-sm text-navy-500">
        Generate a personalized draft for LinkedIn, a call, or a mailed letter. Every draft becomes
        a task here for a human to send, place, or mail manually — nothing is sent automatically.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() => void generate("linkedin_message")}
          disabled={generating !== null}
        >
          {generating === "linkedin_message" ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Linkedin className="h-4 w-4" aria-hidden />
          )}
          Draft LinkedIn message
        </Button>
        <Button variant="secondary" onClick={() => void generate("call")} disabled={generating !== null}>
          {generating === "call" ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Phone className="h-4 w-4" aria-hidden />
          )}
          Prep call talking points
        </Button>
        <Button
          variant="secondary"
          onClick={() => void generate("mail_letter")}
          disabled={generating !== null}
        >
          {generating === "mail_letter" ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <FileText className="h-4 w-4" aria-hidden />
          )}
          Draft mail letter
        </Button>
      </div>

      {error && (
        <div role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-4 space-y-3">
        {loading && <p className="text-sm text-navy-400">Loading tasks...</p>}
        {!loading && tasks.length === 0 && (
          <p className="text-sm text-navy-400">No outreach tasks yet.</p>
        )}
        {tasks.map((task) => {
          const meta = TASK_META[task.task_type as TaskType] ?? TASK_META.call;
          const Icon = meta.icon;
          return (
            <div key={task.id} className="rounded-lg border border-navy-100 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge color={meta.badge} withDot>
                    <Icon className="h-3 w-3" aria-hidden />
                    <span className="ml-1">{meta.label}</span>
                  </Badge>
                  <Badge color={STATUS_BADGE[task.status] ?? "gray"}>{task.status}</Badge>
                  {task.due_at && (
                    <span className="text-xs text-navy-400">Due {formatDate(task.due_at)}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {task.task_type === "mail_letter" && task.asset_path && (
                    <Button variant="secondary" onClick={() => void download(task.id)}>
                      <Download className="h-3.5 w-3.5" aria-hidden />
                      PDF
                    </Button>
                  )}
                  {task.status === "pending" && (
                    <>
                      <Button
                        variant="secondary"
                        disabled={busyTaskId === task.id}
                        onClick={() => void setStatus(task.id, "completed")}
                      >
                        Mark sent
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={busyTaskId === task.id}
                        onClick={() => void setStatus(task.id, "cancelled")}
                      >
                        Cancel
                      </Button>
                    </>
                  )}
                </div>
              </div>
              {task.subject && <p className="mt-2 text-sm font-medium text-navy-800">{task.subject}</p>}
              <p className="mt-1 whitespace-pre-wrap text-sm text-navy-600">{task.content}</p>
              <p className="mt-2 text-xs text-navy-400">Drafted {formatRelative(task.created_at)}</p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
