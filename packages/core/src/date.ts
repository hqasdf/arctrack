const shortMonthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Convert an instant to the Session calendar date used on both platforms. */
export function singaporeDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/** Inclusive date-only bounds. All Time deliberately has no upper bound. */
export function analyticsDateWindow(period: "7" | "30" | "90" | "all", today: string) {
  if (period === "all") return null;
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() + 1 - Number(period));
  return { start: start.toISOString().slice(0, 10), end: today };
}

export function matchesAnalyticsDate(date: string, window: ReturnType<typeof analyticsDateWindow>): boolean {
  return window === null || date >= window.start && date <= window.end;
}

function dateParts(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

export function formatDateOnly(value: string, includeYear = true) {
  const { day, month, year } = dateParts(value);
  const formatted = `${day} ${shortMonthNames[month - 1]}`;
  return includeYear ? `${formatted} ${year}` : formatted;
}

export function formatWeekRange(startDate: string, endDate: string) {
  const start = dateParts(startDate);
  const end = dateParts(endDate);
  if (start.month === end.month && start.year === end.year) return `${start.day}–${end.day} ${shortMonthNames[end.month - 1]}`;
  return `${formatDateOnly(startDate, false)}–${formatDateOnly(endDate, false)}`;
}

