// ============================================================================
// PT-10-002 scenario 1 support process -- a small, dependency-free HTTP
// forwarding proxy that sits between an isolated Next.js dev server and the
// real local Supabase stack (.pt05-local-stack, REST_URL/AUTH already
// running on 127.0.0.1:56321) and can be told, live, to simulate three
// network conditions on "the DB path" without ever restarting the Next
// server or the Supabase stack itself:
//
//   normal -- transparent forward (request+response streamed byte-for-byte,
//             headers preserved) to the real upstream. This is the control
//             condition confirming the harness itself isn't the reason a
//             page fails.
//   down   -- the incoming socket is destroyed immediately, before any
//             response is written and before any upstream connection is
//             even attempted. This reproduces what a real Supabase outage
//             looks like from the app's perspective at the TCP layer
//             (connection reset), not a slow 5xx -- there is no HTTP
//             response at all, matching a DNS failure / connection refused
//             / firewall drop.
//   slow   -- the request IS forwarded to the real upstream, but the proxy
//             deliberately waits `slowMs` before writing anything back,
//             simulating a Supabase instance that's alive but pathologically
//             slow (e.g. under load, or a network partition adding huge
//             latency) rather than fully down.
//
// Mode is read fresh from a small JSON file on EVERY request (no caching),
// so the orchestrator can flip fault behavior mid-run for an already-running
// Next dev server that has this proxy's URL baked into its
// NEXT_PUBLIC_SUPABASE_URL env var at boot (Next.js reads that value from
// process.env at server-request time for its own createClient() calls, but
// the actual TCP destination only needs to be fixed once at server boot --
// the proxy itself is what changes behavior, not the app).
//
// A GET to /__pt10_proxy_health always short-circuits to a plain 200,
// regardless of mode, so the orchestrator can confirm the proxy process
// itself is alive before trusting any "down"/"slow" result as meaningful.
//
// Started as a detached-from-stdin child process by
// pt10-002-outage-simulation.mjs; never touches production (only ever
// forwards to a 127.0.0.1 upstream, hard-checked below).
// ASCII only. Node 20 compatible, no external dependencies.
// ============================================================================

import http from "node:http";
import fs from "node:fs";
import { URL } from "node:url";

const PROXY_PORT = Number(process.env.PT10_PROXY_PORT || 0);
const UPSTREAM = process.env.PT10_PROXY_UPSTREAM || "";
const MODE_FILE = process.env.PT10_PROXY_MODE_FILE || "";

if (!PROXY_PORT || !UPSTREAM || !MODE_FILE) {
  console.error(
    "pt10-002-fault-proxy: missing PT10_PROXY_PORT / PT10_PROXY_UPSTREAM / PT10_PROXY_MODE_FILE",
  );
  process.exit(1);
}

const upstreamUrl = new URL(UPSTREAM);
if (upstreamUrl.hostname !== "127.0.0.1" && upstreamUrl.hostname !== "localhost") {
  console.error(
    `HARD STOP: PT10_PROXY_UPSTREAM (${UPSTREAM}) is not a localhost address. This proxy must only ` +
      "ever forward to the local Supabase stack. Aborting.",
  );
  process.exit(1);
}

function readMode() {
  try {
    const raw = fs.readFileSync(MODE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const mode = ["normal", "down", "slow"].includes(parsed.mode) ? parsed.mode : "normal";
    const slowMs = Number.isFinite(parsed.slowMs) ? parsed.slowMs : 12000;
    return { mode, slowMs };
  } catch {
    return { mode: "normal", slowMs: 12000 };
  }
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/__pt10_proxy_health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }

  const { mode, slowMs } = readMode();

  if (mode === "down") {
    // No response, no upstream connection attempt -- the sharpest possible
    // "unreachable" simulation. destroy() on the raw socket, not res.end(),
    // so the client sees a genuine connection-level failure (ECONNRESET /
    // "fetch failed"), not a slow-but-valid HTTP response.
    req.socket.destroy();
    return;
  }

  const forward = () => {
    const target = new URL(req.url || "/", upstreamUrl);
    const upstreamReq = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method: req.method,
        headers: { ...req.headers, host: target.host },
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );
    upstreamReq.on("error", (err) => {
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "pt10_fault_proxy_upstream_error", message: err.message }));
      } else {
        res.destroy();
      }
    });
    req.pipe(upstreamReq);
  };

  if (mode === "slow") {
    setTimeout(forward, slowMs);
    return;
  }

  forward();
});

server.listen(PROXY_PORT, "127.0.0.1", () => {
  console.log(
    `pt10-002-fault-proxy: listening on http://127.0.0.1:${PROXY_PORT} -> ${UPSTREAM} ` +
      `(mode file: ${MODE_FILE})`,
  );
});

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
