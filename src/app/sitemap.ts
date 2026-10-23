import type { MetadataRoute } from "next";
import { PUBLIC_SITE_URL, publicIndexingAllowed } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  if (!publicIndexingAllowed()) return [];
  return ["/", "/sign-in", "/privacy", "/delete-account"].map((path) => ({
    url: `${PUBLIC_SITE_URL}${path}`,
  }));
}
