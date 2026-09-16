// Phase 5.3: /api/cron/pil-research is the real trigger PIL_WIRING_AUDIT.md
// (2026-09-15) found missing -- orchestrateResearchRun()/
// pollAndOrchestratePendingRuns() had zero callers anywhere in src/ or
// worker/. Same auth-check pattern as cron-route-auth.test.ts: the real,
// unmodified GET/POST handlers, only pollAndOrchestratePendingRuns mocked.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/pil/research-orchestrator", () => ({
  pollAndOrchestratePendingRuns: vi.fn(),
}));

import { GET, POST } from "@/app/api/cron/pil-research/route";
import { pollAndOrchestratePendingRuns } from "@/lib/pil/research-orchestrator";

const pollMock = vi.mocked(pollAndOrchestratePendingRuns);

function makeRequest(headers?: Record<string, string>) {
  return new Request("https://www.benavora.com/api/cron/pil-research", { headers });
}

describe("cron route CRON_SECRET auth (/api/cron/pil-research)", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "test-cron-secret-value");
    pollMock.mockReset();
    pollMock.mockResolvedValue([
      { runId: "run-1", status: "completed" },
      { runId: "run-2", status: "running" },
    ]);
  });

  it("returns 401 JSON, not a redirect, when no secret is supplied", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(res.headers.get("location")).toBeNull();
    const body = await res.json();
    expect(body.code).toBe("unauthorized");
    expect(pollMock).not.toHaveBeenCalled();
  });

  it("returns 401 JSON when the wrong secret is supplied", async () => {
    const res = await GET(makeRequest({ authorization: "Bearer wrong-secret" }));
    expect(res.status).toBe(401);
  });

  it("polls and summarizes by status when the correct secret is supplied", async () => {
    const res = await POST(makeRequest({ authorization: "Bearer test-cron-secret-value" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.polled).toBe(2);
    expect(body.by_status).toEqual({ completed: 1, running: 1 });
    expect(body.run_ids).toEqual(["run-1", "run-2"]);
    expect(pollMock).toHaveBeenCalledWith({ limit: 5 });
  });
});
