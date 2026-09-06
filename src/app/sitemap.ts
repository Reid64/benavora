import fs from "fs";
import path from "path";
import type { MetadataRoute } from "next";
import { listPages } from "@/lib/marketing/content";
import { BASE_URL } from "@/lib/marketing/seo";

const MARKETING_DIR = path.join(process.cwd(), "src", "app", "(marketing)");

// Walks the actual (marketing) route-group directory for static page.tsx
// routes, so this list can't drift from what's really in the repo. The
// "[...slug]" catch-all (MDX content routes) is enumerated separately below
// via listPages(), which reads content/marketing directly.
function walkStaticRoutes(dir: string, routeBase: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let routes: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name === "[...slug]") continue;
      routes = routes.concat(
        walkStaticRoutes(path.join(dir, entry.name), `${routeBase}/${entry.name}`)
      );
    } else if (entry.name === "page.tsx") {
      routes.push(routeBase === "" ? "/" : routeBase);
    }
  }
  return routes;
}

function priorityFor(route: string): number {
  if (route === "/") return 1;
  if (route.startsWith("/solutions/")) return 0.8;
  return 0.6;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes = walkStaticRoutes(MARKETING_DIR, "");
  const staticSet = new Set(staticRoutes);

  // MDX routes shadowed by a static page.tsx at the same path (e.g. /demo,
  // /platform/autoapply) are unreachable through the catch-all — Next.js
  // always resolves the static route first — so they're excluded here too.
  const contentRoutes = listPages()
    .map(({ slug }) => `/${slug.join("/")}`)
    .filter((route) => !staticSet.has(route));

  const allRoutes = [...staticRoutes, ...contentRoutes];

  return allRoutes.map((route) => ({
    url: `${BASE_URL}${route}`,
    lastModified: new Date(),
    changeFrequency: route === "/" ? "daily" : "monthly",
    priority: priorityFor(route),
  }));
}
