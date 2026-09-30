import type { CSSProperties } from "react";

type IconName = "arrow" | "sessions" | "analytics" | "target" | "check" | "profile" | "organization" | "eye" | "eyeOff";

const paths: Record<IconName, string> = {
  arrow: "M5 12h14m-6-6 6 6-6 6",
  sessions: "M8 4H5v17h14V4h-3M8 2h8v5H8zm0 10h8m-8 4h5",
  analytics: "M4 19V9m6 10V5m6 14v-7m4 7V3",
  target: "M21 12a9 9 0 1 1-9-9m5 9a5 5 0 1 1-5-5m0 5 9-9m-5 0h5v5",
  check: "m5 12 4 4L19 6",
  profile: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2",
  organization: "M4 20v-9h6v9M14 20v-9h6v9M2 20h20M3 7l9-4 9 4v3H3V7Z",
  eye: "M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
  eyeOff: "M3 3l18 18M9.9 5.2A11.6 11.6 0 0 1 12 5c6.4 0 10 7 10 7a15.7 15.7 0 0 1-3.1 3.7M6.3 6.3C3.5 8.1 2 12 2 12s3.6 7 10 7c1.3 0 2.5-.3 3.6-.8M10 10a3 3 0 0 0 4 4",
};

export function Icon({
  name,
  size = 20,
  style,
}: {
  name: IconName;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}
