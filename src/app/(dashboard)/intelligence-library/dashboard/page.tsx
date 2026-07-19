"use client";

import dynamic from "next/dynamic";

// Lazy-loaded: this page statically imported the full recharts library,
// which inflated the route's first-load JS. Defer it to a client-only
// chunk fetched after initial paint.
const DashboardClient = dynamic(() => import("./DashboardClient"), {
  ssr: false,
});

export default function Page() {
  return <DashboardClient />;
}
