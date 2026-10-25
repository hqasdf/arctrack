import { timingSafeEqual, randomUUID } from 'node:crypto';

const TARGET = 'https://archery-website.vercel.app/api/internal/garmin-health/ingest';
// Match the private receiver and stay below Vercel's 4.5 MB function ceiling.
const MAX_BYTES = 4 * 1024 * 1024;
const validKey = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const reply = status => new Response(null, { status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });

// Factory permits isolated transport testing; the deployed worker has a fixed destination.
export function createIngress({ fetcher = fetch, target = TARGET } = {}) {
  return async (request, env) => {
    let limits, ticket;
    try {
      if (env.INGRESS_ENABLED !== 'true' || !validKey(env.GARMIN_ENDPOINT_SECRET) || !validKey(env.GARMIN_FORWARD_KEY)
        || env.GARMIN_ENDPOINT_SECRET === env.GARMIN_FORWARD_KEY || !env.LIMITS) return reply(503);
      if (request.method !== 'POST') return reply(405);
      const url = new URL(request.url);
      if (url.protocol !== 'https:' || url.search) return reply(401);
      const candidate = /^\/garmin\/([a-f0-9]{64})$/.exec(url.pathname)?.[1];
      const matches = timingSafeEqual(Buffer.from(env.GARMIN_ENDPOINT_SECRET, 'hex'), Buffer.from(candidate ?? '0'.repeat(64), 'hex'));
      // Bad capabilities cannot exhaust the legitimate delivery budget.
      // All replicas share each durable authority, not a process-local Map.
      limits = env.LIMITS.get(env.LIMITS.idFromName(candidate && matches ? 'garmin-global-v1' : 'garmin-rejected-v1'));
      if (!(await limits.fetch('https://limits/attempt', { method: 'POST' })).ok) return reply(429);
      if (!candidate || !matches) return reply(401);
      if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
        || ![null, 'identity'].includes(request.headers.get('content-encoding'))) return reply(415);
      const length = request.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) return reply(413);
      const reservation = await limits.fetch('https://limits/reserve', { method: 'POST' });
      if (!reservation.ok) return reply(429);
      ticket = await reservation.text();
      const reader = request.body?.getReader();
      if (!reader) return reply(400);
      const body = new Uint8Array(MAX_BYTES); let size = 0, timedOut = false;
      const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 10000);
      try {
        while (true) {
          const chunk = await reader.read(); if (chunk.done) break;
          if (size + chunk.value.length > MAX_BYTES) { await reader.cancel(); return reply(413); }
          body.set(chunk.value, size); size += chunk.value.length;
        }
      } finally { clearTimeout(timer); reader.releaseLock(); }
      if (timedOut) return reply(408);
      try { JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body.subarray(0, size))); } catch { return reply(400); }
      // Never copy URL, query, original URI, cookies, tracing, referrer or caller headers.
      const result = await fetcher(target, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(20000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.GARMIN_FORWARD_KEY}` }, body: body.subarray(0, size) });
      await result.body?.cancel();
      // Only a durable inbox acknowledgment is success. Never follow redirects.
      return reply(result.status === 200 ? 200 : [400, 401, 413, 415, 429].includes(result.status) ? result.status : 503);
    } catch { return reply(503); }
    finally {
      if (ticket) { try { await limits.fetch('https://limits/release', { method: 'POST', body: ticket }); } catch { /* Lease expires after 45s. */ } }
    }
  };
}
const worker = { fetch: createIngress() };
export default worker;

// Classic Durable Object fetch interface. Transactional state survives isolate eviction.
export class GarminIngressLimits {
  constructor(state) { this.storage = state.storage; }
  async fetch(request) {
    const action = new URL(request.url).pathname;
    const release = action === '/release' ? await request.text() : '';
    return this.storage.transaction(async txn => {
      const now = Date.now(), minute = Math.floor(now / 60000);
      const previous = await txn.get('quota');
      const quota = previous ?? { minute, attempts: 0, accepted: 0, leases: {} };
      if (quota.minute !== minute) { quota.minute = minute; quota.attempts = 0; quota.accepted = 0; }
      quota.leases = Object.fromEntries(Object.entries(quota.leases).filter(([, until]) => until > now));
      let result;
      if (action === '/attempt') { result = reply(++quota.attempts <= 600 ? 204 : 429); }
      else if (action === '/reserve') {
        if (quota.accepted >= 30 || Object.keys(quota.leases).length >= 4) result = reply(429);
        else { const id = randomUUID(); quota.accepted++; quota.leases[id] = now + 45000; result = new Response(id); }
      } else if (action === '/release') { delete quota.leases[release]; result = reply(204); }
      else result = reply(404);
      await txn.put('quota', quota); return result;
    });
  }
}
