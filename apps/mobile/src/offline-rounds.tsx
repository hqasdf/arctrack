import { router, usePathname } from "expo-router";
import { useEffect, useState } from "react";
import { AppState, Pressable, ScrollView, Text, View } from "react-native";
import { useAuth } from "./auth";
import { useAppearance } from "./appearance";
import { listOfflineScoring } from "./offline-scoring";

/** Recovery entry points remain usable even when the online Sessions reader fails. */
export function OfflineRounds({ deviceOwner, onOpen }: { deviceOwner?: string; onOpen?: (id: string) => void } = {}) {
  const { user } = useAuth(), { colors } = useAppearance();
  const owner = user?.id ?? deviceOwner;
  const pathname = usePathname();
  const visible = !!deviceOwner || pathname === "/sessions";
  const [result, setResult] = useState<{ owner: string; data: Awaited<ReturnType<typeof listOfflineScoring>> } | null>(null);
  const [error, setError] = useState<string | null>(null), [expanded, setExpanded] = useState(false), [limit, setLimit] = useState(50);
  useEffect(() => {
    if (!visible) return;
    let active = true, request = 0;
    const load = async () => {
      const id = ++request; if (!owner) return;
      try { const data = await listOfflineScoring(owner, limit);
        if (active && id === request) { setResult({ owner, data }); setError(null); }
      } catch { if (active && id === request) setError("Device Rounds could not be read. Their contents were kept; retry reopening Sessions."); }
    };
    void load();
    const subscription = AppState.addEventListener("change", state => { if (state === "active") void load(); });
    return () => { active = false; request++; subscription.remove(); };
  }, [owner, limit, visible]);
  const data = result && result.owner === owner ? result.data : null;
  if (!owner || !data?.rounds.length && !data?.damaged && !error) return null;
  return <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, marginBottom: 12, backgroundColor: colors.surface }}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={{ minHeight: 44, justifyContent: "center" }}>
      <Text style={{ color: colors.text, fontWeight: "700" }}>Saved Rounds on this device ({data?.rounds.length ?? 0})</Text>
      <Text style={{ color: colors.muted }}>Open prepared Rounds even without internet.</Text>
    </Pressable>
    {error ? <Text accessibilityRole="alert" style={{ color: colors.error }}>{error}</Text> : null}
    {data?.damaged ? <Text accessibilityRole="alert" style={{ color: colors.error }}>{data.damaged} device record(s) need recovery. Do not clear app storage.</Text> : null}
    {expanded ? <ScrollView style={{ maxHeight: 190 }}>
      {data?.rounds.map(round => <Pressable key={round.id} accessibilityRole="button" style={{ minHeight: 52, paddingVertical: 8 }}
        onPress={() => onOpen ? onOpen(round.id) : router.push({ pathname: "/rounds/[roundId]/score", params: { roundId: round.id } })}>
        <Text style={{ color: colors.accent, fontWeight: "700" }}>{round.session} · {round.title}</Text>
        <Text style={{ color: colors.muted }}>{round.pending ? `${round.pending} device changes waiting to sync` : "Prepared for offline scoring"}</Text>
      </Pressable>)}
      {data?.more && limit < 1000 ? <Pressable accessibilityRole="button" onPress={() => setLimit(value => value + 50)} style={{ minHeight: 44 }}><Text style={{ color: colors.accent }}>Show more device Rounds</Text></Pressable> : null}
    </ScrollView> : null}
  </View>;
}
