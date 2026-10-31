/** Complete, single-snapshot persistence contract; contains no platform client. */
export type HistoryArrow={id:string;arrow_number:number;score_points:number;is_x:boolean;plot_x:number|null;plot_y:number|null;face_index:number|null};
export type HistoryEnd={id:string;end_number:number;arrows:HistoryArrow[]};
export type HistoryRound={id:string;round_number:number;name:string;division:string;distance_metres:number;face_diameter_cm:number;face_type:string;planned_ends:number;arrows_per_end:number;session_ends:HistoryEnd[]};
export type HistorySession={id:string;user_id:string;title:string;session_date:string;session_type:string;arrow_count:number;created_at:string;session_rounds:HistoryRound[]};
export type HistorySessionIndex=Omit<HistorySession,'session_rounds'>;
export type HistoryOptions={owner?:string;organization?:string;session?:string;sessionType?:string;details?:boolean;allowedOwners?:readonly string[]};
type HistoryClient={rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>};
export class SessionHistoryError extends Error {
 constructor(){super('Complete Session history could not be verified. No partial results were used. Please retry.');this.name='SessionHistoryError';}
}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const integer=(v:unknown,min=0):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min;
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/.test(v);
/** Reject absent counts/arrays, duplicate IDs/slots, malformed rows and truncation.
 * Counts describe persisted rows, never planned or athlete-recorded Arrow volume.
 */
export function verifySessionHistory(value:unknown,actor:string,options:HistoryOptions&{details:false}):HistorySessionIndex[];
export function verifySessionHistory(value:unknown,actor:string,options?:HistoryOptions&{details?:true}):HistorySession[];
export function verifySessionHistory(value:unknown,actor:string,options:HistoryOptions={}):HistorySessionIndex[]{
 const fail=():never=>{throw new SessionHistoryError();};
 if(!object(value)||value.version!==1||value.complete!==true||value.details!==(options.details!==false)||!object(value.counts)||!Array.isArray(value.items))return fail();
 if(!Array.isArray(value.owners)||value.owners.some(v=>!uuid(v))||new Set(value.owners).size!==value.owners.length)return fail();
 const owners=value.owners;
 const expected=options.allowedOwners??(options.organization?(options.owner?[options.owner]:undefined):[actor]);
 if(expected&&(new Set(expected).size!==owners.length||expected.some(id=>!owners.includes(id))))return fail();
 const counts=value.counts,actual={sessions:0,rounds:0,ends:0,arrows:0},seen={sessions:new Set<string>(),rounds:new Set<string>(),ends:new Set<string>(),arrows:new Set<string>()};
 const identity=(v:unknown,kind:keyof typeof seen)=>{if(!uuid(v)||seen[kind].has(v))return fail();seen[kind].add(v);};
 let previous:Record<string,unknown>|undefined;
 for(const s of value.items){
  if(!object(s))return fail();identity(s.id,'sessions');actual.sessions++;
  if(!uuid(s.user_id)||!owners.includes(s.user_id)||!options.organization&&s.user_id!==actor||options.owner&&s.user_id!==options.owner||options.session&&s.id!==options.session
   ||typeof s.title!=='string'||typeof s.session_date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s.session_date)
   ||!Number.isFinite(Date.parse(s.session_date))||new Date(s.session_date).toISOString().slice(0,10)!==s.session_date
   ||typeof s.created_at!=='string'||!Number.isFinite(Date.parse(s.created_at))||!integer(s.arrow_count)
   ||!['training','competition'].includes(String(s.session_type))||options.sessionType&&s.session_type!==options.sessionType)return fail();
  if(previous){const date=String(previous.session_date).localeCompare(s.session_date),time=Date.parse(String(previous.created_at))-Date.parse(s.created_at);
   if(date<0||date===0&&(time<0||time===0&&String(previous.id)<String(s.id)))return fail();}
  previous=s;
  if(options.details===false)continue;
  if(!Array.isArray(s.session_rounds))return fail();const roundNumbers=new Set<number>();
  for(const r of s.session_rounds){
   if(!object(r))return fail();identity(r.id,'rounds');actual.rounds++;
   if(!integer(r.round_number,1)||roundNumbers.has(r.round_number)||typeof r.name!=='string'||typeof r.division!=='string'
    ||!integer(r.planned_ends,1)||!integer(r.arrows_per_end,1)||!integer(r.distance_metres)||!integer(r.face_diameter_cm,1)
    ||!['full_face','six_ring','triple_face'].includes(String(r.face_type))||!Array.isArray(r.session_ends))return fail();
   roundNumbers.add(r.round_number);const endNumbers=new Set<number>();
   for(const e of r.session_ends){
    if(!object(e))return fail();identity(e.id,'ends');actual.ends++;
    if(!integer(e.end_number,1)||e.end_number>r.planned_ends||endNumbers.has(e.end_number)||!Array.isArray(e.arrows))return fail();endNumbers.add(e.end_number);
    const slots=new Set<number>();for(const a of e.arrows){
     if(!object(a))return fail();identity(a.id,'arrows');actual.arrows++;
     if(!integer(a.arrow_number,1)||a.arrow_number>r.arrows_per_end||slots.has(a.arrow_number)||!integer(a.score_points)||a.score_points>10
      ||typeof a.is_x!=='boolean'||a.is_x&&a.score_points!==10
      ||!((a.plot_x===null&&a.plot_y===null)||(typeof a.plot_x==='number'&&Number.isFinite(a.plot_x)&&typeof a.plot_y==='number'&&Number.isFinite(a.plot_y)))
      ||!(a.face_index===null||integer(a.face_index)&&a.face_index<=2))return fail();slots.add(a.arrow_number);
    }
   }
  }
 }
 for(const key of ['sessions','rounds','ends','arrows'] as const)if(!integer(counts[key])||counts[key]!==actual[key])return fail();
 if(actual.sessions>10000||actual.rounds>100000||actual.ends>500000||actual.arrows>1000000)return fail();
 return value.items as HistorySession[];
}
export function readCompleteSessionHistory(client:HistoryClient,actor:string,options:HistoryOptions&{details:false}):Promise<HistorySessionIndex[]>;
export function readCompleteSessionHistory(client:HistoryClient,actor:string,options?:HistoryOptions&{details?:true}):Promise<HistorySession[]>;
export async function readCompleteSessionHistory(client:HistoryClient,actor:string,options:HistoryOptions={}):Promise<HistorySessionIndex[]>{
 const {data,error}=await client.rpc('read_complete_session_history_v1',{p_actor:actor,p_owner:options.owner??null,p_organization:options.organization??null,p_session:options.session??null,p_type:options.sessionType??null,p_details:options.details!==false});
 if(error)throw new SessionHistoryError();
 return options.details===false?verifySessionHistory(data,actor,{...options,details:false}):verifySessionHistory(data,actor,{...options,details:true});
}
