"use client";

import { useEffect, useRef, useState } from "react";
import { createGroupingExport, renderGroupingExport, type GroupingExport } from "@arc-track/core/grouping-export";
import type { RoundDraft } from "../scoring-model";
import styles from "./sessions.module.css";

export function GroupingExportButton({ round, context }: { round: RoundDraft; context: string }) {
  const [report, setReport] = useState<GroupingExport | null>(null);
  return <>
    <button type="button" className={`${styles.primary} ${styles.groupingExportButton}`} onClick={() => setReport(createGroupingExport(round, context))}>Export Grouping Image</button>
    {report && <GroupingExportPreview report={report} onClose={() => setReport(null)}/>}
  </>;
}

function GroupingExportPreview({ report, onClose }: { report: GroupingExport; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [{ svg, width, height }] = useState(() => renderGroupingExport(report));
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function save() {
    setBusy(true); setError(null);
    try {
      const image = new Image(); image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      context.drawImage(image, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("PNG unavailable")), "image/png"));
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = downloadUrl;
      link.download = `arc-track-${report.round.id}.png`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    } catch { setError("The image could not be saved. Please try again."); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className={styles.groupingExportDialog} aria-labelledby="grouping-export-title" onCancel={onClose}>
    <div className={styles.groupingExportToolbar}><h2 id="grouping-export-title">Grouping Export</h2><button type="button" className={styles.textButton} onClick={onClose}>Back</button><button type="button" className={styles.primary} disabled={busy || !url} onClick={() => void save()}>{busy ? "Saving…" : "Save PNG"}</button></div>
    {error && <p role="alert" className={styles.saveError}>{error}</p>}
    {/* A dedicated static report, never a capture of the interactive scoring page. */}
    {url && <picture><img className={styles.groupingExportImage} src={url} width={width} height={height} alt={`Grouping and every End score for ${report.round.name}`}/></picture>}
  </dialog>;
}
