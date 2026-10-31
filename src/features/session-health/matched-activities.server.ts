import 'server-only';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {HRCandidate} from './model';
export type MatchedActivity=HRCandidate&{metrics:Record<string,number|string|null>};
/** Two bounded metadata queries; never fetch sample chunks for a card list. */
export async function readMatchedActivitySummaries(db:SupabaseClient,userId:string,activities:HRCandidate[]):Promise<MatchedActivity[]>{
 if(!activities.length)return [];
 const ids=activities.map(c=>c.source_id);
 const summaries=new Map<string,Record<string,unknown>>();
 for(let offset=0;offset<ids.length;offset+=100){
  const rows=await db.from('garmin_health_records').select('source_id,metrics').eq('user_id',userId).eq('kind','activities').in('source_id',ids.slice(offset,offset+100));
  if(rows.error)throw Error('Activity summaries unavailable.');
  for(const row of rows.data??[])summaries.set(row.source_id,row.metrics??{});
 }
 const allowed=new Set(['activityName','activityType','averageHeartRate','maxHeartRate','deviceName']);
 return activities.map(c=>({...c,metrics:Object.fromEntries(Object.entries(summaries.get(c.source_id)??{}).filter(([k,v])=>allowed.has(k)&&(v===null||typeof v==='string'&&v.length<=256||typeof v==='number'&&Number.isFinite(v)))) as MatchedActivity['metrics']}));
}
