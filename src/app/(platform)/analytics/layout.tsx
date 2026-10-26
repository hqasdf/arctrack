import type { ReactNode } from "react";
import { AnalyticsNavigation } from "@/features/analytics/components/analytics-navigation";

export default function AnalyticsLayout({ children }: { children: ReactNode }) {
  return <><AnalyticsNavigation />{children}</>;
}
