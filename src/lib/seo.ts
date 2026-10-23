import type { Metadata } from "next";

export const PUBLIC_SITE_URL = "https://archery-website.vercel.app";

// Local builds can verify production metadata; Vercel previews stay noindex.
export function publicIndexingAllowed() {
  return !process.env.VERCEL_ENV || process.env.VERCEL_ENV === "production";
}

export function publicPageMetadata(
  path: string,
  title: string,
  description: string,
): Metadata {
  const index = publicIndexingAllowed();
  const url = `${PUBLIC_SITE_URL}${path}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    robots: { index, follow: index },
    openGraph: {
      type: "website",
      siteName: "Arc Track",
      title: `${title} | Arc Track`,
      description,
      url,
    },
  };
}
