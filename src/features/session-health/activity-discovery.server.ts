import 'server-only';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {HRCandidate} from './model';

/** Keyset pages contain only authorized same-day Archery; never sample chunks.
 * A changing import may appear on the next refresh. Never return a capped success.
 */
export async function discoverSessionArchery(db:SupabaseClient,sessionId:string):Promise<HRCandidate[]> {
 const found=new Map<string,HRCandidate>();
 let cursor:HRCandidate|undefined;
 for(let page=0;page<50;page++) {
  const result=await db.rpc('session_garmin_archery_candidates_v2',{p_session:sessionId,p_after_start:cursor?.start_seconds??null,p_after_id:cursor?.source_id??null});
  if(result.error||!Array.isArray(result.data))throw Error('Complete Archery discovery is temporarily unavailable.');
  const rows=result.data as HRCandidate[];
  if(rows.length>200)throw Error('Invalid Archery discovery page.');
  for(const row of rows){
   if(!Number.isSafeInteger(row.start_seconds)||typeof row.source_id!=='string'||!row.source_id)throw Error('Invalid Archery discovery record.');
   if(cursor&&(row.start_seconds<cursor.start_seconds||row.start_seconds===cursor.start_seconds&&row.source_id===cursor.source_id))throw Error('Archery discovery did not advance.');
   found.set(row.source_id,row);
  }
  if(rows.length<200)return [...found.values()];
  cursor=rows.at(-1);
 }
 throw Error('This date exceeds the safe discovery capacity. No partial match was returned.');
}
