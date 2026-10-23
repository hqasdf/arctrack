import type { MetadataRoute } from "next";
import { PUBLIC_SITE_URL, publicIndexingAllowed } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  if (!publicIndexingAllowed()) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    // Let crawlers observe page-level noindex directives. Auth protects user data.
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/auth/"] },
    sitemap: `${PUBLIC_SITE_URL}/sitemap.xml`,
  };
}
