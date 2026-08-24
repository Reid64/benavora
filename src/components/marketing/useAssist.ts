"use client";

import { useCallback, useState } from "react";

export interface AssistCitation {
  n: number;
  title: string;
  url: string;
  publisher: string;
}

export interface AssistMessage {
  role: "user" | "assistant";
  content: string;
  citations?: AssistCitation[];
}

export interface UseAssistResult {
  messages: AssistMessage[];
  send: (question: string) => Promise<void>;
  loading: boolean;
  error: string | null;
  offerDemo: boolean;
  /** Tool names the model called for this session's most recent answer (app surface only). */
  toolsUsed: string[];
}

export interface UseAssistOptions {
  /** Defaults to the public marketing surface. Pass "/api/assist" for the in-app surface. */
  endpoint?: string;
}

export function useAssist(options: UseAssistOptions = {}): UseAssistResult {
  const endpoint = options.endpoint ?? "/api/public/assist";
  const [sessionId] = useState(() => crypto.randomUUID());
  const [messages, setMessages] = useState<AssistMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offerDemo, setOfferDemo] = useState(false);
  const [toolsUsed, setToolsUsed] = useState<string[]>([]);

  const send = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || loading) return;

      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
      setError(null);
      setLoading(true);

      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: trimmed, history, sessionId }),
        });

        if (res.status === 429) {
          setError("You have reached today's limit. Try again tomorrow or book a demo.");
          return;
        }
        if (res.status === 401) {
          setError("Your session has expired. Please sign in again.");
          return;
        }
        if (!res.ok) {
          setError("Assist is unavailable right now.");
          return;
        }

        const data = (await res.json()) as {
          answer: string;
          citations: AssistCitation[];
          offerDemo?: boolean;
          toolsUsed?: string[];
        };
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.answer, citations: data.citations },
        ]);
        if (data.offerDemo) setOfferDemo(true);
        setToolsUsed(data.toolsUsed ?? []);
      } catch {
        setError("Assist is unavailable right now.");
      } finally {
        setLoading(false);
      }
    },
    [messages, loading, sessionId, endpoint],
  );

  return { messages, send, loading, error, offerDemo, toolsUsed };
}
