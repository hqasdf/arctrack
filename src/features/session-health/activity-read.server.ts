import 'server-only';
import {createHash} from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { HRDataset, HRCandidate } from './model';
export class ActivityAccessError extends Error {}
export type ActivityDetail={revision?:string;unchanged?:boolean;recording:HRCandidate;metrics:Record<string,number|string|null>;datasets:HRDataset[];updatedAt:string|null};
export async function readImportedActivity(db:SupabaseClient,userId:string,sourceId:string,known?:string):Promise<ActivityDetail|null>{
 const permission=await db.rpc('garmin_hr_owner_access',{p_source:'activity'});
 if(permission.error)throw Error('Garmin authorization could not be verified.');
 if(permission.data!==true)throw new ActivityAccessError('Garmin authorization is unavailable.');
 const summary=await db.from('garmin_health_records').select('source_id,start_seconds,duration_seconds,metrics,updated_at').eq('user_id',userId).eq('kind','activities').eq('source_id',sourceId).order('updated_at',{ascending:false}).limit(1);
 if(summary.error)throw Error('Activity summary unavailable.');
 const dataset=await db.from('garmin_hr_datasets').select('id,source_id,start_seconds,duration_seconds,activity_type,state,sample_count,part_count,published').eq('user_id',userId).eq('source','activity').eq('source_id',sourceId).eq('published',true).maybeSingle();
 if(dataset.error)throw Error('Activity detail unavailable.');
 const row=summary.data?.[0],d=dataset.data;if(!row&&!d)return null;
 const revision=createHash('sha256').update(JSON.stringify([row,d])).digest('hex');
 const unchanged=known===revision;
 const datasets:HRDataset[]=[];
 if(d&&!unchanged){const chunks=await db.from('garmin_hr_chunks').select('part,samples').eq('user_id',userId).eq('dataset_id',d.id).order('part').limit(290);
  if(chunks.error||!chunks.data||chunks.data.length!==d.part_count||chunks.data.some((c,i)=>c.part!==i||!Array.isArray(c.samples)))throw Error('Detailed samples are incomplete.');
  const samples=chunks.data.flatMap(c=>c.samples);
  if(samples.length!==d.sample_count||samples.length>86401||samples.some(s=>!Array.isArray(s)||s.length!==2||!Number.isSafeInteger(s[0])||s[0]<d.start_seconds||s[0]>d.start_seconds+d.duration_seconds||s[1]!==null&&(!Number.isInteger(s[1])||s[1]<1||s[1]>300)))throw Error('Detailed samples are incomplete.');
  datasets.push({id:d.id,source:'activity',sourceId:d.source_id,start:d.start_seconds,duration:d.duration_seconds,samples});
 }
 const current=await db.rpc('garmin_hr_owner_access',{p_source:'activity'});if(current.error)throw Error('Garmin authorization could not be verified.');if(current.data!==true)throw new ActivityAccessError('Garmin authorization changed.');
 const textKeys=new Set(['activityType','activityName','deviceName']);
 const numberKeys=new Set(['averageHeartRate','maxHeartRate','distanceMeters','activeCalories','averageSpeed','elevationGain','elevationLoss','runCadence','bikeCadence']);
 const metrics=Object.fromEntries(Object.entries(row?.metrics??{}).filter(([key,value])=>textKeys.has(key)&&typeof value==='string'&&value.length<=256||numberKeys.has(key)&&(value===null||typeof value==='number'&&Number.isFinite(value))));
 return {revision,unchanged,recording:{source_id:sourceId,start_seconds:d?.start_seconds??row!.start_seconds,duration_seconds:d?.duration_seconds??row!.duration_seconds,activity_type:d?.activity_type??row?.metrics?.activityType??null,state:d?.state??'summary_only',sample_count:d?.sample_count??0,published:!!d},metrics:metrics as ActivityDetail['metrics'],datasets,updatedAt:row?.updated_at??null};
}
