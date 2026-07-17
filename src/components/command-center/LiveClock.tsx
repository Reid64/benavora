"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";

/**
 * Ticking date/time readout for the Command Center title bar. Renders a
 * server-safe placeholder on first paint (no `now` reference) and starts
 * updating once mounted, so there's no hydration mismatch.
 */
export function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.6)" }}>
      {now ? format(now, "EEEE, MMMM d, yyyy · h:mm:ss a") : " "}
    </span>
  );
}
