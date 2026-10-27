import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { readRecentRoundConfigurations, forgetRecentRoundConfiguration, roundConfigurationLabel, type RecentRoundConfiguration, type RoundConfiguration } from '@arc-track/core/recent-round-configs';
import { supabase } from './supabase';
import { createThemedStyles } from './appearance';

export function RecentRoundConfigs({ userId, disabled, compatible, onSelect }: { userId: string; disabled?: boolean; compatible?: (config: RoundConfiguration) => boolean; onSelect: (config: RoundConfiguration) => void }) {
  const styles = useStyles();
  const [rows, setRows] = useState<RecentRoundConfiguration[]>([]), [loaded, setLoaded] = useState(false), [error, setError] = useState(''), [removing, setRemoving] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const active = useRef(true);
  const alive = useRef(true), reading = useRef(false), mutation = useRef(false), sequence = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const refresh = useCallback(async () => {
    if (reading.current || mutation.current) return;
    reading.current = true;
    const ticket = ++sequence.current;
    try {
      if (!supabase) throw Error('Network unavailable');
      const result = await readRecentRoundConfigurations(supabase, userId);
      if (alive.current && ticket === sequence.current) { setRows(result); setLoaded(true); setError(''); setRetryAttempt(0); }
    } catch { if (alive.current && ticket === sequence.current) { setError('Recent configurations are temporarily unavailable. You can still configure a Round normally.'); setRetryAttempt(attempt => attempt + 1); } }
    finally { reading.current = false; }
  }, [userId]);
  useFocusEffect(useCallback(() => {
    active.current = AppState.currentState !== 'background' && AppState.currentState !== 'inactive'; setRetryAttempt(0); if (active.current) void refresh();
    const listener = AppState.addEventListener('change', state => { const returning = state === 'active' && !active.current; active.current = state === 'active'; if (returning) { setRetryAttempt(0); void refresh(); } });
    return () => { active.current = false; listener.remove(); };
  }, [refresh]));
  useEffect(() => {
    if (retryAttempt < 1 || retryAttempt > 3) return;
    const timer = setTimeout(() => { if (active.current) void refresh(); }, [1000, 4000, 15000][retryAttempt - 1]);
    return () => clearTimeout(timer);
  }, [retryAttempt, refresh]);
  async function remove(row: RecentRoundConfiguration) {
    if (mutation.current) return;
    mutation.current = true; sequence.current++; setRemoving(true); setRetryAttempt(0);
    try {
      if (!supabase) throw Error('Network unavailable');
      await forgetRecentRoundConfiguration(supabase, userId, row.id);
      if (alive.current) { setRows(old => old.filter(r => r.id !== row.id)); setError(''); setRetryAttempt(0); }
    } catch { if (alive.current) { setError('Removal could not be confirmed. The list will reload automatically; try removing the entry again if needed.'); setRetryAttempt(1); } }
    finally { mutation.current = false; if (alive.current) setRemoving(false); }
  }
  return <View style={styles.panel}>
    <Text style={styles.title}>Recent Custom Configurations</Text>
    <Text style={styles.note}>Remembered after confirmation. Ends × arrows per End; latest first.</Text>
    {!loaded && !error && <Text accessibilityLiveRegion="polite" style={styles.note}>Loading recent configurations…</Text>}
    {loaded && !rows.length && <Text style={styles.note}>Custom settings appear here after a Round is successfully confirmed.</Text>}
    {error !== '' && <Text accessibilityLiveRegion="polite" style={styles.note}>{error}</Text>}
    <ScrollView horizontal contentContainerStyle={styles.history} showsHorizontalScrollIndicator={false}>{rows.map(row => {
      const allowed = !compatible || compatible(row.configuration);
      return <View key={row.id} style={styles.row}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Use ${roundConfigurationLabel(row.configuration)}, ${row.configuration.name}`} accessibilityState={{ disabled: Boolean(disabled || removing || !allowed) }} disabled={disabled || removing || !allowed} onPress={() => onSelect({ ...row.configuration })} style={[styles.button, styles.selection, !allowed && styles.dim]}>
          <Text style={styles.action}>{roundConfigurationLabel(row.configuration)}</Text><Text style={styles.note}>{row.configuration.name}</Text>
          {!allowed && <Text style={styles.note}>Use Configure Round for a new Round to change layout/arrows or reduce Ends.</Text>}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove recent configuration ${roundConfigurationLabel(row.configuration)}`} disabled={disabled || removing} onPress={() => void remove(row)} style={styles.button}><Text style={styles.action}>Remove</Text></Pressable>
      </View>;
    })}</ScrollView>
  </View>;
}
const useStyles = createThemedStyles(c => StyleSheet.create({
  panel: { gap: 8, padding: 12, marginVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.soft },
  title: { color: c.text, fontSize: 15, fontWeight: '700' }, note: { color: c.muted, fontSize: 12, lineHeight: 18 }, row: { gap: 7, width: 250 }, history: { gap: 10 },
  button: { minHeight: 44, justifyContent: 'center', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, alignSelf: 'flex-start' },
  selection: { alignSelf: 'stretch' }, action: { color: c.accent, fontWeight: '600', fontSize: 13 }, dim: { opacity: 0.55 },
}));
