import type { MetadataRoute } from "next";

const BASE_URL = "https://benavora.com";

// Public marketing pages only — /pricing and /about are sections of the
// homepage (#pricing anchor), not separate routes; there is no /blog yet.
export default function sitemap(): MetadataRoute.Sitemap {
  const routes = ["", "/for-consultants", "/privacy", "/terms", "/security"];

  return routes.map((route) => ({
    url: `${BASE_URL}${route}`,
    lastModified: new Date(),
    changeFrequency: route === "" ? "daily" : "monthly",
    priority: route === "" ? 1 : 0.6,
  }));
}
