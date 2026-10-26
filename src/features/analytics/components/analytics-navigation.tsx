"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./analytics-navigation.module.css";

export function AnalyticsNavigation() {
  const pathname = usePathname();
  return <nav className={styles.sections} aria-label="Analytics sections">
    {[{ href: "/analytics", label: "Archery" }, { href: "/analytics/health", label: "Health" }].map(({ href, label }) => {
      const active = href === "/analytics" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
      return <Link key={href} href={href} prefetch={false} aria-current={active ? "page" : undefined}>{label}</Link>;
    })}
  </nav>;
}
