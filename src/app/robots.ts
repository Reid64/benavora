import type { MetadataRoute } from "next";

const BASE_URL = "https://benavora.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/login", "/register", "/forgot-password", "/reset-password", "/invite/"],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
