import { createGroupingExport, type GroupingExport } from "@arc-track/core/grouping-export";
import type { RoundDraft } from "@arc-track/core/scoring";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SvgXml, type Svg } from "react-native-svg";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { colors } from "./theme";
import { EXPORT_TOP_PADDING, mobileExportPreviewWidth, renderMobileGroupingExport } from "./grouping-export-report";

export function GroupingExportButton({ round, context }: { round: RoundDraft; context: string }) {
  const [report, setReport] = useState<GroupingExport | null>(null);
  return <>
    <Pressable accessibilityRole="button" onPress={() => setReport(createGroupingExport(round, context))} style={styles.button}>
      <Text style={styles.buttonText}>Export Grouping Image</Text>
    </Pressable>
    {report && <GroupingExportPreview report={report} onClose={() => setReport(null)}/>}
  </>;
}

function GroupingExportPreview({ report, onClose }: { report: GroupingExport; onClose: () => void }) {
  const image = useRef<Svg>(null);
  const [{ svg, width, height }] = useState(() => renderMobileGroupingExport(report));
  const screen = useWindowDimensions();
  const previewWidth = mobileExportPreviewWidth(screen.width);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  async function save() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(null);
    try {
      if (!FileSystem.cacheDirectory || !await Sharing.isAvailableAsync()) throw new Error("Sharing unavailable");
      const base64 = await new Promise<string>((resolve, reject) => {
        if (!image.current) { reject(new Error("Image unavailable")); return; }
        image.current.toDataURL(resolve, { width, height });
      });
      const file = `${FileSystem.cacheDirectory}arc-track-grouping-${report.round.id}.png`;
      await FileSystem.writeAsStringAsync(file, base64, { encoding: FileSystem.EncodingType.Base64 });
      await Sharing.shareAsync(file, { mimeType: "image/png", UTI: "public.png", dialogTitle: "Save or share grouping image" });
    } catch { setError("The image could not be shared. Please try again on your device."); }
    finally { busyRef.current = false; setBusy(false); }
  }
  return <Modal visible animationType="slide" onRequestClose={() => { if (!busy) onClose(); }}>
    <SafeAreaProvider style={styles.page}>
    <SafeAreaView style={styles.page} edges={["top", "right", "bottom", "left"]}>
      <View style={styles.toolbar}><Pressable accessibilityRole="button" disabled={busy} onPress={onClose} style={styles.back}><Text style={styles.backText}>Back</Text></Pressable>
        <Text style={styles.title}>Grouping Export</Text>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => void save()} style={styles.button}><Text style={styles.buttonText}>{busy ? "Saving…" : "Save / Share PNG"}</Text></Pressable>
      </View>
      {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.preview} horizontal={false}>
        <SvgXml xml={svg} override={{ ref: image, width: previewWidth, height: height * previewWidth / width,
          viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "xMidYMid meet", pointerEvents: "none",
          accessibilityLabel: `Static grouping report for ${report.round.name}` }}/>
      </ScrollView>
    </SafeAreaView>
    </SafeAreaProvider>
  </Modal>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  button: { minHeight: 48, justifyContent: "center", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 9, backgroundColor: colors.accent },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 14, textAlign: "center" },
  toolbar: { padding: 12, flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" },
  back: { minHeight: 44, paddingHorizontal: 8, justifyContent: "center" }, backText: { color: colors.accent, fontWeight: "700" },
  title: { color: colors.text, fontWeight: "800", fontSize: 18, flexGrow: 1 },
  scroll: { flex: 1 },
  preview: { alignItems: "center", paddingHorizontal: 12, paddingTop: EXPORT_TOP_PADDING, paddingBottom: 32 },
  error: { color: colors.error, padding: 12 },
});
