"use client";

import { useState } from "react";
import { CoachFeedbackPanel } from "@/features/notes-feedback/coach-feedback-panel";

export function SessionFeedbackHistory({ viewerId }: { viewerId: string }) {
  const [loaded, setLoaded] = useState(false);
  return <details onToggle={event => { if (event.currentTarget.open) setLoaded(true); }}>
    <summary>Session Feedback history</summary>
    {loaded && <CoachFeedbackPanel context={{ viewerId }} history/>}
  </details>;
}
