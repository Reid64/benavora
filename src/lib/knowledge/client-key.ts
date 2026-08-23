import { createHash } from "crypto";

// Derives the per-visitor rate-limit key for Benavora Assist's public surface:
// sha256(ip + ":" + sessionId). Kept out of the route file since Next.js App
// Router route modules may only export HTTP method handlers and a small
// fixed set of config keys - any other named export fails the build's route
// type check.
export function computeClientKey(ip: string, sessionId: string): string {
  return createHash("sha256").update(`${ip}:${sessionId}`).digest("hex");
}
