import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PUBLIC_SITE_URL } from "@/lib/seo";
import "@/styles/globals.css";
import "@/styles/theme.css";

export const metadata: Metadata = {
  metadataBase: new URL(PUBLIC_SITE_URL),
  applicationName: "Arc Track",
  title: { default: "Arc Track", template: "%s | Arc Track" },
  description:
    "An archery performance platform for recurve and compound archers.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
