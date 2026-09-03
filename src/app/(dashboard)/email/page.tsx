"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Mail,
  Link2,
  Search,
  Clock,
  Send,
  Loader2,
  ChevronRight,
  Sparkles,
  X,
  User,
  Building2,
} from "lucide-react";

import { Badge, Button, EmptyState, LoadingSpinner, Textarea } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { InstructionalWidget } from "@/components/InstructionalWidget";

// Outreach & Communication section treatment — PAGE_TREATMENT_PROTOCOL_V2.md.
// Frame: Rust. Secondary accent: Bronze.
const FRAME_RUST = "#B85C3C";
const ACCENT_BRONZE = "#A4712C";
const CARD_BG = "#F8F5EE";
const CARD_SHADOW = "0 4px 20px rgba(163,73,47,0.22)";

type ThreadLink = {
  thread_id: string;
  funder_id: string | null;
  contact_id: string | null;
  outreach_contact_id: string | null;
  match_type: string;
};

type EmailThread = {
  id: string;
  gmail_thread_id: string;
  subject: string | null;
  snippet: string | null;
  last_message_at: string | null;
  message_count: number | null;
  is_read: boolean | null;
  link: ThreadLink | null;
};

type EmailMessage = {
  id: string;
  from_email: string | null;
  from_name: string | null;
  to_emails: string[] | null;
  cc_emails: string[] | null;
  subject: string | null;
  body_text: string | null;
  sent_at: string | null;
};

type TabFilter = "all" | "linked" | "unlinked";
type MobileTab = "list" | "detail" | "context";

function formatTimeAgo(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function EmailPage() {
  const [threads, setThreads] = useState<EmailThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<TabFilter>("all");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [ccField, setCcField] = useState("");
  const [sending, setSending] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>("list");
  const [linkingId, setLinkingId] = useState<string | null>(null);

  const selectedThread = threads.find((t) => t.id === selectedThreadId) ?? null;

  const loadThreads = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ filter, search });
    try {
      const res = await fetch(`/api/email/threads?${params.toString()}`);
      if (!res.ok) throw new Error("load failed");
      const data = (await res.json()) as { threads: EmailThread[] };
      setThreads(data.threads ?? []);
    } catch {
      setThreads([]);
    } finally {
      setLoading(false);
    }
  }, [filter, search]);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  const loadMessages = useCallback(async (threadId: string) => {
    setMessagesLoading(true);
    setSummary(null);
    setShowSummary(false);
    const supabase = createClient();
    const { data } = await supabase
      .from("synced_email_messages")
      .select(
        "id, from_email, from_name, to_emails, cc_emails, subject, body_text, sent_at",
      )
      .eq("thread_id", threadId)
      .order("sent_at", { ascending: true });
    setMessages((data as EmailMessage[]) ?? []);
    setMessagesLoading(false);
  }, []);

  useEffect(() => {
    if (selectedThreadId) {
      void loadMessages(selectedThreadId);
    } else {
      setMessages([]);
    }
  }, [selectedThreadId, loadMessages]);

  async function handleSummarize() {
    if (!selectedThreadId || summaryLoading) return;
    setSummaryLoading(true);
    setShowSummary(true);
    try {
      const res = await fetch("/api/email/summarize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ thread_id: selectedThreadId }),
      });
      const data = (await res.json()) as { summary?: string };
      setSummary(data.summary ?? null);
    } catch {
      setSummary("Could not generate summary. Please try again.");
    } finally {
      setSummaryLoading(false);
    }
  }

  function selectThread(threadId: string) {
    setSelectedThreadId(threadId);
    setMobileTab("detail");
    setReplyText("");
    setCcField("");
  }

  async function handleSendReply() {
    if (!replyText.trim() || sending) return;
    setSending(true);
    try {
      await fetch("/api/email/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          thread_id: selectedThreadId,
          body: replyText.trim(),
          cc: ccField.trim() || undefined,
        }),
      });
      setReplyText("");
      setCcField("");
      if (selectedThreadId) void loadMessages(selectedThreadId);
    } catch {
      // silent — user can retry
    } finally {
      setSending(false);
    }
  }

  async function handleAutoLink(threadId: string) {
    setLinkingId(threadId);
    try {
      await fetch("/api/email/link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ thread_id: threadId, auto: true }),
      });
      await loadThreads();
    } finally {
      setLinkingId(null);
    }
  }

  const TABS: { label: string; value: TabFilter }[] = [
    { label: "All", value: "all" },
    { label: "Linked", value: "linked" },
    { label: "Unlinked", value: "unlinked" },
  ];

  return (
    <div className="flex h-full flex-col">
      <InstructionalWidget
        pageTitle="Engagement"
        steps={[
          { number: 1, title: "Read your inbox", description: "Emails linked to funders and contacts show here, with thread context." },
          { number: 2, title: "Search or filter threads", description: "Find a conversation by subject, sender, or linked funder." },
          { number: 3, title: "Reply with AI assist", description: "Draft a reply and let Assist suggest language before you send." },
          { number: 4, title: "Check relationship health", description: "Funder & Contact Monitoring flags relationships that need attention." },
        ]}
      />
      <div className="mb-4 flex items-center gap-3">
        <Mail className="h-6 w-6" style={{ color: FRAME_RUST }} aria-hidden />
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: FRAME_RUST }}>
            Email Hub
          </h1>
          <p className="text-sm text-navy-500">
            Manage email threads linked to funders and contacts.
          </p>
        </div>
      </div>

      {/* Mobile tab strip */}
      <div className="mb-4 flex gap-1 rounded-lg bg-navy-100 p-1 lg:hidden">
        {(["list", "detail", "context"] as MobileTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setMobileTab(tab)}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium capitalize transition ${
              mobileTab === tab
                ? "bg-surface text-navy-900 shadow-sm"
                : "text-navy-500 hover:text-navy-700"
            }`}
          >
            {tab === "detail" ? "Thread" : tab === "context" ? "Context" : "Inbox"}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        {/* Left column: Thread list */}
        <aside
          className={`flex w-full flex-col lg:w-72 lg:shrink-0 xl:w-80 ${
            mobileTab === "list" ? "flex" : "hidden lg:flex"
          }`}
        >
          <div className="mb-3 flex flex-col gap-2">
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-navy-400"
                aria-hidden
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search threads…"
                className="w-full rounded-lg border border-navy-200 bg-surface py-2 pl-9 pr-3 text-sm text-navy-900 placeholder:text-navy-400 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-400/20"
              />
            </div>
            <div className="flex gap-1">
              {TABS.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setFilter(tab.value)}
                  style={
                    filter === tab.value
                      ? { backgroundColor: "rgba(163,73,47,0.1)", color: FRAME_RUST, boxShadow: `inset 0 0 0 1px rgba(163,73,47,0.35)` }
                      : undefined
                  }
                  className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                    filter === tab.value ? "" : "text-navy-500 hover:text-navy-700"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ backgroundColor: FRAME_RUST, borderRadius: "14px", boxShadow: CARD_SHADOW, padding: "3px" }} className="flex-1 overflow-hidden flex flex-col">
          <div className="flex-1 overflow-y-auto rounded-[11px]" style={{ backgroundColor: CARD_BG }}>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <LoadingSpinner />
              </div>
            ) : threads.length === 0 ? (
              <EmptyState
                icon={Mail}
                title="No threads"
                description="No email threads match your current filters."
              />
            ) : (
              <ul role="list" className="divide-y divide-navy-100">
                {threads.map((thread) => (
                  <li key={thread.id}>
                    <button
                      type="button"
                      onClick={() => selectThread(thread.id)}
                      style={
                        selectedThreadId === thread.id
                          ? { backgroundColor: "rgba(163,73,47,0.08)", boxShadow: "inset 0 0 0 1px rgba(163,73,47,0.3)" }
                          : undefined
                      }
                      className="w-full px-4 py-3 text-left transition hover:bg-navy-50"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p
                            className={`truncate text-sm ${
                              thread.is_read === false
                                ? "font-semibold text-navy-900"
                                : "font-medium text-navy-700"
                            }`}
                          >
                            {thread.subject ?? "(no subject)"}
                          </p>
                          {thread.snippet && (
                            <p className="mt-0.5 truncate text-xs text-navy-400">
                              {thread.snippet}
                            </p>
                          )}
                          <div className="mt-1.5 flex items-center gap-2">
                            {thread.link ? (
                              <Badge color="teal">
                                <Link2 className="h-3 w-3" aria-hidden />
                                Linked
                              </Badge>
                            ) : (
                              <button
                                type="button"
                                disabled={linkingId === thread.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleAutoLink(thread.id);
                                }}
                                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-navy-400 ring-1 ring-navy-200 transition hover:text-navy-600 hover:ring-navy-300 disabled:opacity-50"
                              >
                                <Link2 className="h-3 w-3" aria-hidden />
                                {linkingId === thread.id ? "Linking…" : "Link"}
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <span className="flex items-center gap-1 text-xs text-navy-400">
                            <Clock className="h-3 w-3" aria-hidden />
                            {formatTimeAgo(thread.last_message_at)}
                          </span>
                          {(thread.message_count ?? 0) > 1 && (
                            <span className="text-xs text-navy-400">
                              {thread.message_count} msgs
                            </span>
                          )}
                          <ChevronRight className="h-3.5 w-3.5 text-navy-300" aria-hidden />
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          </div>
        </aside>

        {/* Center column: Thread detail */}
        <div
          className={`flex min-w-0 flex-1 flex-col ${
            mobileTab === "detail" ? "flex" : "hidden lg:flex"
          }`}
        >
          {!selectedThread ? (
            <div
              style={{ backgroundColor: FRAME_RUST, borderRadius: "14px", boxShadow: CARD_SHADOW, padding: "3px" }}
              className="flex flex-1"
            >
              <div className="flex flex-1 items-center justify-center rounded-[11px]" style={{ backgroundColor: CARD_BG }}>
                <EmptyState
                  icon={Mail}
                  title="Select a thread"
                  description="Choose a thread from the list to view its messages."
                />
              </div>
            </div>
          ) : (
            <div
              style={{ backgroundColor: FRAME_RUST, borderRadius: "14px", boxShadow: CARD_SHADOW, padding: "3px" }}
              className="flex flex-1 overflow-hidden"
            >
            <div className="flex flex-1 flex-col overflow-hidden rounded-[11px]" style={{ backgroundColor: CARD_BG }}>
              {/* Thread header */}
              <div className="border-b border-navy-100 px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-base font-semibold text-navy-900">
                      {selectedThread.subject ?? "(no subject)"}
                    </h2>
                    <p className="mt-0.5 text-xs text-navy-400">
                      {selectedThread.message_count ?? 0} message
                      {(selectedThread.message_count ?? 0) !== 1 ? "s" : ""}
                      {selectedThread.last_message_at
                        ? ` · last ${formatTimeAgo(selectedThread.last_message_at)}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      style={{
                        border: `1.5px solid ${ACCENT_BRONZE}`,
                        backgroundColor: "rgba(164,113,44,0.08)",
                        color: ACCENT_BRONZE,
                      }}
                      onClick={() => {
                        if (showSummary) {
                          setShowSummary(false);
                        } else {
                          void handleSummarize();
                        }
                      }}
                    >
                      {summaryLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        <Sparkles className="h-4 w-4" aria-hidden />
                      )}
                      {showSummary ? "Hide summary" : "AI summary"}
                    </Button>
                    <button
                      type="button"
                      onClick={() => setMobileTab("context")}
                      className="rounded-md p-1.5 text-navy-400 transition hover:bg-navy-50 hover:text-navy-700 lg:hidden"
                      aria-label="View context panel"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                {showSummary && (
                  <div className="mt-3 rounded-lg bg-teal-50 px-4 py-3 ring-1 ring-teal-200">
                    {summaryLoading ? (
                      <div className="flex items-center gap-2 text-sm text-teal-700">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        Generating summary…
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm text-teal-800">{summary ?? ""}</p>
                        <button
                          type="button"
                          onClick={() => setShowSummary(false)}
                          className="shrink-0 text-teal-500 hover:text-teal-700"
                          aria-label="Dismiss summary"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                {messagesLoading ? (
                  <div className="flex justify-center py-8">
                    <LoadingSpinner />
                  </div>
                ) : messages.length === 0 ? (
                  <p className="py-8 text-center text-sm text-navy-400">
                    No messages found in this thread.
                  </p>
                ) : (
                  messages.map((msg) => (
                    <div
                      key={msg.id}
                      className="rounded-lg border border-navy-100 bg-navy-50/50 px-4 py-3"
                    >
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-navy-800">
                            {msg.from_name ?? msg.from_email ?? "Unknown sender"}
                          </p>
                          {msg.from_name && msg.from_email && (
                            <p className="text-xs text-navy-400">{msg.from_email}</p>
                          )}
                          {msg.to_emails && msg.to_emails.length > 0 && (
                            <p className="text-xs text-navy-400">
                              To: {msg.to_emails.join(", ")}
                            </p>
                          )}
                          {msg.cc_emails && msg.cc_emails.length > 0 && (
                            <p className="text-xs text-navy-400">
                              CC: {msg.cc_emails.join(", ")}
                            </p>
                          )}
                        </div>
                        {msg.sent_at && (
                          <span className="shrink-0 text-xs text-navy-400">
                            {new Date(msg.sent_at).toLocaleString()}
                          </span>
                        )}
                      </div>
                      <div className="prose prose-sm max-w-none text-navy-700">
                        <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                          {msg.body_text ?? ""}
                        </pre>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Reply box */}
              <div className="border-t border-navy-100 px-5 py-4 space-y-2">
                <div>
                  <label htmlFor="reply-cc" className="text-xs font-medium text-navy-500">
                    CC
                  </label>
                  <input
                    id="reply-cc"
                    type="text"
                    value={ccField}
                    onChange={(e) => setCcField(e.target.value)}
                    placeholder="email@example.com"
                    className="mt-0.5 w-full rounded-md border border-navy-200 bg-surface px-3 py-1.5 text-sm text-navy-900 placeholder:text-navy-400 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-400/20"
                  />
                </div>
                <Textarea
                  label="Reply"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Write your reply…"
                  rows={4}
                />
                <div className="flex justify-end">
                  <Button
                    variant="ghost"
                    onClick={() => void handleSendReply()}
                    disabled={!replyText.trim() || sending}
                    isLoading={sending}
                    style={{ backgroundColor: FRAME_RUST, color: CARD_BG, border: "none" }}
                  >
                    <Send className="h-4 w-4" aria-hidden />
                    Send
                  </Button>
                </div>
              </div>
            </div>
            </div>
          )}
        </div>

        {/* Right column: Context panel */}
        <aside
          className={`w-full flex-col lg:w-64 lg:shrink-0 xl:w-72 ${
            mobileTab === "context" ? "flex" : "hidden lg:flex"
          }`}
        >
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
            {/* Mobile back button */}
            <button
              type="button"
              onClick={() => setMobileTab("detail")}
              className="flex items-center gap-1 text-sm text-navy-500 hover:text-navy-700 lg:hidden"
            >
              <ChevronRight className="h-4 w-4 rotate-180" aria-hidden />
              Back to thread
            </button>

            {selectedThread ? (
              <>
                {/* Linked entity */}
                <div style={{ backgroundColor: FRAME_RUST, borderRadius: "12px", padding: "3px" }}>
                <div className="rounded-[10px] p-4" style={{ backgroundColor: CARD_BG }}>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-navy-700">Linked Entity</h3>
                    <button
                      type="button"
                      className="text-xs text-teal-600 hover:text-teal-800"
                    >
                      Change
                    </button>
                  </div>
                  {selectedThread.link ? (
                    <div className="space-y-2">
                      {selectedThread.link.funder_id && (
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-navy-400" aria-hidden />
                          <span className="text-sm text-navy-700">Funder linked</span>
                        </div>
                      )}
                      {selectedThread.link.contact_id && (
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4 text-navy-400" aria-hidden />
                          <span className="text-sm text-navy-700">Contact linked</span>
                        </div>
                      )}
                      <Badge color="teal" withDot>
                        {selectedThread.link.match_type}
                      </Badge>
                    </div>
                  ) : (
                    <p className="text-sm text-navy-400">No entity linked to this thread.</p>
                  )}
                </div>
                </div>

                {/* Thread timeline */}
                <div style={{ backgroundColor: FRAME_RUST, borderRadius: "12px", padding: "3px" }}>
                <div className="rounded-[10px] p-4" style={{ backgroundColor: CARD_BG }}>
                  <h3 className="mb-3 text-sm font-semibold text-navy-700">Timeline</h3>
                  {messages.length === 0 ? (
                    <p className="text-xs text-navy-400">Select a thread to see its timeline.</p>
                  ) : (
                    <ol className="relative space-y-3 border-l border-navy-200 pl-4">
                      {messages.map((msg) => (
                        <li key={msg.id} className="relative">
                          <span className="absolute -left-[1.125rem] top-1 h-2.5 w-2.5 rounded-full border border-white bg-teal-400" />
                          <p className="text-xs font-medium text-navy-700">
                            {msg.from_name ?? msg.from_email ?? "Unknown"}
                          </p>
                          {msg.sent_at && (
                            <p className="text-xs text-navy-400">
                              {formatTimeAgo(msg.sent_at)}
                            </p>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
                </div>
              </>
            ) : (
              <div style={{ backgroundColor: FRAME_RUST, borderRadius: "12px", padding: "3px" }}>
              <div className="rounded-[10px] p-4" style={{ backgroundColor: CARD_BG }}>
                <p className="text-sm text-navy-400">
                  Select a thread to view linked entities and timeline.
                </p>
              </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
