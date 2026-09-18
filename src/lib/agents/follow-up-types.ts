// Client-safe surface of follow-up-generator.ts: the note-prefix constant
// and result types the "use client" follow-ups page needs to render stored
// sequences. follow-up-generator.ts itself imports callClaude (server-only,
// AR-9.2: now pulls in node's async_hooks via usage-context.ts) -- importing
// anything from that file, even just a const, drags its entire module graph
// into the client bundle. Kept in its own file so the client page never
// touches that graph.

export const FOLLOW_UP_NOTE_PREFIX = "FOLLOW_UP_SEQ:";

export type FollowUpStepType = "thank_you" | "check_in" | "status_request";

export interface FollowUpStep {
  stepNumber: number;
  type: FollowUpStepType;
  delayDays: number;
  subject: string;
  body: string;
  humanizationScore: number;
}

export interface FollowUpStoredPayload {
  generatedAt: string;
  opportunityName: string;
  funderName: string;
  steps: FollowUpStep[];
}
