import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@/styles/globals.css";
import "@/styles/theme.css";

export const metadata: Metadata = {
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
