"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, Monitor } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// Draft & Automation section treatment — PAGE_TREATMENT_PROTOCOL_V2.md. This
// applies only to the OUTER "Live Session Viewer" panel (frame + header) —
// the monitor mockup inside (bezel/screen/stand) is a deliberate dark
// skeuomorphic illustration and is left as-is, same as the fullscreen mode.
const FRAME_GOLD = "#C49A4F";
const FRAME_NAVY = "#2C4E3B";
const CARD_BG = "#F8F5EE";

type ConnectionState = "connecting" | "connected" | "live" | "offline";

interface StatusMessage {
  step?: string;
  funder?: string;
  elapsed?: number;
}

const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];

interface MonitorContentProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  connState: ConnectionState;
  statusMsg: StatusMessage | null;
  screenWidth: number;
  screenHeight: number;
  onStartSession?: () => void;
}

function MonitorContent({
  canvasRef,
  connState,
  statusMsg,
  screenWidth,
  screenHeight,
  onStartSession,
}: MonitorContentProps) {
  const ledStyle: React.CSSProperties =
    connState === "live"
      ? { backgroundColor: "#22c55e", boxShadow: "0 0 8px 2px rgba(34,197,94,0.65)" }
      : connState === "connected"
        ? { backgroundColor: "#22c55e", boxShadow: "0 0 4px 1px rgba(34,197,94,0.3)" }
        : connState === "connecting"
          ? { backgroundColor: "#f59e0b" }
          : { backgroundColor: "#444" };

  const ledAnimClass =
    connState === "connected" || connState === "connecting" ? "animate-pulse" : "";

  const statusLabel =
    connState === "live"
      ? "LIVE"
      : connState === "connected"
        ? "STANDBY"
        : connState === "connecting"
          ? "CONNECTING..."
          : "OFFLINE";

  const statusColor =
    connState === "live"
      ? "#22c55e"
      : connState === "connecting"
        ? "#f59e0b"
        : "#555";

  const screenPlaceholderText =
    connState === "connected"
      ? "Waiting for submission…"
      : connState === "connecting"
        ? "Connecting…"
        : "No active session";

  return (
    <div
      className="inline-flex flex-col items-center"
      style={{ width: screenWidth + 32 }}
    >
      {/* Monitor body */}
      <div
        style={{
          backgroundColor: "#1a1a2e",
          borderRadius: 12,
          padding: 16,
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          width: "100%",
        }}
      >
        {/* Top bezel */}
        <div
          style={{
            height: 12,
            backgroundColor: "#252540",
            borderRadius: "6px 6px 0 0",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 4,
          }}
        >
          <span
            style={{
              fontSize: 9,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              color: "#555",
              fontFamily: "monospace",
            }}
          >
            BENAVORA AUTOAPPLY
          </span>
        </div>

        {/* Screen area */}
        <div
          style={{
            border: "2px solid #333",
            borderRadius: 4,
            overflow: "hidden",
            backgroundColor: "#0a0a15",
            width: screenWidth,
            height: screenHeight,
            position: "relative",
          }}
        >
          {/* Canvas — always mounted so the ref is valid when frames arrive */}
          <canvas
            ref={canvasRef}
            width={screenWidth}
            height={screenHeight}
            style={{
              display: connState === "live" ? "block" : "none",
              width: "100%",
              height: "100%",
            }}
          />

          {/* Idle / disconnected overlay */}
          {connState !== "live" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <Monitor className="h-8 w-8" style={{ color: "#2a2a4a" }} />
              {connState === "offline" ? (
                <>
                  <div className="space-y-1">
                    <p style={{ fontSize: 13, fontWeight: 700, color: "#94A3B8" }}>
                      No active session
                    </p>
                    <p style={{ fontSize: 11, color: "#4B5563", maxWidth: 220 }}>
                      Start a session from the queue to see live browser automation here.
                    </p>
                  </div>
                  {onStartSession && (
                    <button
                      type="button"
                      onClick={onStartSession}
                      className="hover:brightness-95"
                      style={{
                        backgroundColor: "#C17817",
                        color: "#0A1628",
                        border: "none",
                        borderRadius: 8,
                        padding: "6px 16px",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Start Session
                    </button>
                  )}
                </>
              ) : (
                <p style={{ fontSize: 13, color: "#444" }}>{screenPlaceholderText}</p>
              )}
            </div>
          )}

          {/* Status overlay — bottom gradient bar when live */}
          {connState === "live" && statusMsg && (
            <div
              className="absolute bottom-0 left-0 right-0 px-3 py-2 text-xs"
              style={{
                background:
                  "linear-gradient(to bottom, transparent, rgba(0,0,0,0.82))",
              }}
            >
              {statusMsg.step && (
                <p className="font-medium text-white">{statusMsg.step}</p>
              )}
              <div className="mt-0.5 flex items-center gap-3" style={{ color: "#ccc" }}>
                {statusMsg.funder && <span>{statusMsg.funder}</span>}
                {statusMsg.elapsed !== undefined && (
                  <span>{statusMsg.elapsed}s elapsed</span>
                )}
              </div>
            </div>
          )}

          {/* LIVE badge — top-right when streaming */}
          {connState === "live" && (
            <div
              className="absolute right-2 top-2 flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-bold text-white"
              style={{ background: "rgba(220,38,38,0.85)" }}
            >
              <span className="inline-block h-2 w-2 animate-ping rounded-full bg-surface opacity-90" />
              LIVE
            </div>
          )}
        </div>

        {/* Bottom bezel */}
        <div
          style={{
            height: 16,
            backgroundColor: "#252540",
            borderRadius: "0 0 6px 6px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingLeft: 10,
            paddingRight: 12,
            marginTop: 4,
          }}
        >
          {/* Power LED */}
          <div
            className={ledAnimClass}
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              transition: "box-shadow 0.3s ease",
              ...ledStyle,
            }}
          />
          {/* Status label */}
          <span
            style={{
              fontSize: 9,
              letterSpacing: "0.1em",
              color: statusColor,
              fontFamily: "monospace",
            }}
          >
            {statusLabel}
          </span>
        </div>
      </div>

      {/* Monitor stand — trapezoid + base */}
      <div className="flex flex-col items-center">
        <div
          style={{
            width: 120,
            height: 20,
            backgroundColor: "#1a1a2e",
            clipPath: "polygon(25% 0%, 75% 0%, 100% 100%, 0% 100%)",
          }}
        />
        <div
          style={{
            width: 160,
            height: 6,
            backgroundColor: "#252540",
            borderRadius: 3,
          }}
        />
      </div>
    </div>
  );
}

export function LiveSessionViewer({
  onStartSession,
}: {
  onStartSession?: () => void;
} = {}) {
  const [connState, setConnState] = useState<ConnectionState>("connecting");
  const [statusMsg, setStatusMsg] = useState<StatusMessage | null>(null);
  const [expanded, setExpanded] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const connect = useCallback(async () => {
    if (!mountedRef.current) return;

    const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL;
    if (!workerUrl) {
      setConnState("offline");
      return;
    }

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      setConnState("offline");
      return;
    }

    const ws = new WebSocket(`ws://${workerUrl}?token=${token}`);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) {
        ws.close();
        return;
      }
      retryRef.current = 0;
      setConnState("connected");
    };

    ws.onmessage = (event: MessageEvent<unknown>) => {
      if (!mountedRef.current) return;
      const { data } = event;
      if (data instanceof ArrayBuffer) {
        void createImageBitmap(new Blob([data])).then((bitmap) => {
          if (!mountedRef.current) return;
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext("2d");
          if (ctx && canvas) {
            ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          }
          setConnState("live");
        });
      } else if (typeof data === "string") {
        try {
          const msg = JSON.parse(data) as StatusMessage;
          setStatusMsg(msg);
          setConnState("live");
        } catch {
          // ignore malformed JSON
        }
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      wsRef.current = null;
      setConnState("offline");
      setStatusMsg(null);
      const delay =
        BACKOFF_MS[Math.min(retryRef.current, BACKOFF_MS.length - 1)];
      retryRef.current += 1;
      retryTimerRef.current = setTimeout(() => void connect(), delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void connect();
    return () => {
      mountedRef.current = false;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const screenWidth = expanded ? 960 : 384;
  const screenHeight = Math.round(screenWidth * (2 / 3));

  const monitorProps: MonitorContentProps = {
    canvasRef,
    connState,
    statusMsg,
    screenWidth,
    screenHeight,
    onStartSession,
  };

  return (
    <>
      {!expanded && (
        <div style={{ backgroundColor: FRAME_GOLD, borderRadius: "16px", boxShadow: "0 4px 20px rgba(184,138,46,0.22)", padding: "3px" }}>
        <div
          style={{
            backgroundColor: CARD_BG,
            borderRadius: "13px",
            padding: "20px",
          }}
        >
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 style={{ fontSize: "13px", fontWeight: 700, color: FRAME_NAVY }}>
                Live Session Viewer
              </h3>
              <p style={{ fontSize: "12px", color: "#64748B", marginTop: "2px" }}>
                Real-time browser automation stream from the AutoApply worker
              </p>
            </div>
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="rounded-md p-1.5 hover:bg-black/5"
              style={{ color: "#64748B" }}
              title="Expand to fullscreen"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          </div>
          <div className="flex justify-center overflow-x-auto">
            <MonitorContent {...monitorProps} />
          </div>
        </div>
        </div>
      )}

      {expanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-8"
          onClick={() => setExpanded(false)}
        >
          <div
            className="flex flex-col items-center gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex w-full items-center justify-between px-1">
              <h2 className="text-sm font-semibold text-white">
                Live Session Viewer
              </h2>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="rounded-md p-1.5 text-gray-400 hover:bg-white/10 hover:text-white"
                title="Close fullscreen"
              >
                <Minimize2 className="h-4 w-4" />
              </button>
            </div>
            <MonitorContent {...monitorProps} />
          </div>
        </div>
      )}
    </>
  );
}
