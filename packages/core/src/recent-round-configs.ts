import type { RoundDraft } from './scoring-model.ts';
import { DIVISIONS } from './round-presets.ts';

export type RoundConfiguration = Pick<RoundDraft, 'name' | 'division' | 'distanceMetres' | 'faceDiameterCm' | 'faceType' | 'ends' | 'arrowsPerEnd'>;
export type RecentRoundConfiguration = { id: string; configuration: RoundConfiguration; lastUsedAt: string };
export const RECENT_ROUND_LIMIT = 20;

/** Explicit whitelist: no Round/Session IDs, dates, scores, plots or notes. */
export function validateRoundConfiguration(input: RoundConfiguration): RoundConfiguration {
  const name = input.name?.trim();
  if (!name || Array.from(name).length > 80 || name.includes('\0')) throw Error('Round name must contain 1 to 80 characters.');
  if (!(DIVISIONS as readonly unknown[]).includes(input.division)) throw Error('Choose a valid division.');
  if (!['full_face', 'six_ring', 'triple_face'].includes(input.faceType)) throw Error('Choose a valid target face.');
  if ([input.distanceMetres, input.faceDiameterCm, input.ends, input.arrowsPerEnd].some(n => !Number.isInteger(n) || n < 1 || n > 32767)) throw Error('Enter positive whole numbers up to 32767 for Round settings.');
  return { name, division: input.division, distanceMetres: input.distanceMetres, faceDiameterCm: input.faceDiameterCm, faceType: input.faceType, ends: input.ends, arrowsPerEnd: input.arrowsPerEnd };
}
export function roundConfigurationLabel(c: RoundConfiguration) {
  const face = { full_face: 'full face', six_ring: '6-ring face', triple_face: 'triple face' }[c.faceType];
  return `${c.ends} × ${c.arrowsPerEnd} · ${c.division} · ${c.distanceMetres} m · ${c.faceDiameterCm} cm ${face}`;
}
export interface RecentRoundClient { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> }
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export async function readRecentRoundConfigurations(client: RecentRoundClient, actor: string): Promise<RecentRoundConfiguration[]> {
  if (!uuid(actor)) throw Error('Sign in again to read recent configurations.');
  const { data, error } = await client.rpc('read_recent_round_configs', { p_actor: actor });
  if (error || !Array.isArray(data) || data.length > RECENT_ROUND_LIMIT) throw Error('Recent configurations are unavailable. You can still configure a Round normally.');
  return data.map(row => {
    if (!row || !uuid(row.id) || typeof row.last_used_at !== 'string') throw Error('Recent configurations could not be verified.');
    return { id: row.id, lastUsedAt: row.last_used_at, configuration: validateRoundConfiguration({ name: row.round_name, division: row.division, distanceMetres: row.distance_metres, faceDiameterCm: row.face_diameter_cm, faceType: row.face_type, ends: row.planned_ends, arrowsPerEnd: row.arrows_per_end }) };
  });
}
export async function forgetRecentRoundConfiguration(client: RecentRoundClient, actor: string, id: string) {
  if (!uuid(actor) || !uuid(id)) throw Error('This recent configuration could not be identified.');
  const { data, error } = await client.rpc('forget_recent_round_config', { p_actor: actor, p_id: id });
  if (error || data !== true) throw Error('Removal could not be confirmed. Refresh recent configurations and retry.');
}
