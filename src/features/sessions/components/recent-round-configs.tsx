'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { roundConfigurationLabel, type RecentRoundConfiguration, type RoundConfiguration } from '@arc-track/core/recent-round-configs';
import { readRecentRounds, forgetRecentRound } from '../recent-round-actions';
import styles from './recent-round-configs.module.css';

export function RecentRoundConfigs({ userId, disabled, onSelect }: { userId: string; disabled?: boolean; onSelect: (config: RoundConfiguration) => void }) {
  const [rows, setRows] = useState<RecentRoundConfiguration[]>([]), [error, setError] = useState(''), [loaded, setLoaded] = useState(false), [removing, setRemoving] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const alive = useRef(true), request = useRef(0), reading = useRef(false), mutation = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const refresh = useCallback(async () => {
    if (reading.current || mutation.current) return;
    reading.current = true;
    const ticket = ++request.current;
    try {
      const recent = await readRecentRounds(userId);
      if (alive.current && ticket === request.current) { setRows(recent); setLoaded(true); setError(''); setRetryAttempt(0); }
    } catch { if (alive.current && ticket === request.current) { setError('Recent configurations are temporarily unavailable. You can still configure a Round normally.'); setRetryAttempt(attempt => attempt + 1); } }
    finally { reading.current = false; }
  }, [userId]);
  useEffect(() => {
    const wake = () => { if (document.visibilityState === 'visible') { setRetryAttempt(0); void refresh(); } };
    const first = window.setTimeout(wake, 0);
    const focus = wake;
    window.addEventListener('focus', focus); window.addEventListener('online', focus); document.addEventListener('visibilitychange', focus);
    return () => { window.clearTimeout(first); window.removeEventListener('focus', focus); window.removeEventListener('online', focus); document.removeEventListener('visibilitychange', focus); };
  }, [refresh]);
  useEffect(() => {
    if (retryAttempt < 1 || retryAttempt > 3) return;
    const timer = window.setTimeout(() => { if (document.visibilityState === 'visible') void refresh(); }, [1000, 4000, 15000][retryAttempt - 1]);
    return () => window.clearTimeout(timer);
  }, [retryAttempt, refresh]);
  async function remove(row: RecentRoundConfiguration) {
    if (mutation.current) return;
    mutation.current = true; request.current++; setRemoving(true); setRetryAttempt(0);
    try { await forgetRecentRound(userId, row.id); if (alive.current) { setRows(old => old.filter(r => r.id !== row.id)); setError(''); setRetryAttempt(0); } }
    catch { if (alive.current) { setError('Removal could not be confirmed. The list will reload automatically; try removing the entry again if needed.'); setRetryAttempt(1); } }
    finally { mutation.current = false; if (alive.current) setRemoving(false); }
  }
  return <section className={styles.recent} aria-label="Recent Custom Configurations">
    <strong>Recent Custom Configurations</strong>
    <p>Automatically remembered after confirmation. Ends × arrows per End; latest first.</p>
    {!loaded && !error && <p role="status">Loading recent configurations…</p>}
    {loaded && !rows.length && <p>Your custom settings will appear here after you successfully confirm a Round.</p>}
    {error && <p role="status">{error}</p>}
    <div className={styles.list}>{rows.map(row => <div key={row.id} className={styles.row}>
      <button type="button" disabled={disabled || removing} onClick={() => onSelect({ ...row.configuration })}><span>{roundConfigurationLabel(row.configuration)}</span><small>{row.configuration.name}</small></button>
      <button type="button" disabled={disabled || removing} aria-label={`Remove recent configuration ${roundConfigurationLabel(row.configuration)}`} onClick={() => void remove(row)}>Remove</button>
    </div>)}</div>
  </section>;
}
