/** Synthetic serialized query shapes only; no database or network access. */
const session={id:'00000000-0000-4000-8000-000000000001',title:'Practice',session_date:'2026-10-31',created_at:'2026-10-31T03:00:00.123456Z',session_type:'training',arrow_count:180};
const rounds=Array.from({length:3},(_,r)=>({id:`round-${r}`,round_number:r+1,name:'Custom',division:'Recurve',distance_metres:70,face_diameter_cm:122,face_type:'full_face',planned_ends:12,arrows_per_end:6,session_ends:Array.from({length:12},(_,e)=>({end_number:e+1,arrows:Array.from({length:6},(_,a)=>({id:`arrow-${r}-${e}-${a}`,arrow_number:a+1,score_points:9,is_x:false,plot_x:.12,plot_y:.08,face_index:null}))}))}));
for(const sessions of [1,50]){
 const full=Array.from({length:sessions},()=>({...session,session_rounds:rounds}));
 const summaries=Array.from({length:sessions},()=>({...session,session_rounds:[{count:3}]}));
 console.log(JSON.stringify({sessions,roundsPerSession:3,arrowsPerSession:216,fullDetailJsonBytes:Buffer.byteLength(JSON.stringify(full)),summaryJsonBytes:Buffer.byteLength(JSON.stringify(summaries)),limitation:'Synthetic uncompressed UTF-8 JSON only; excludes HTTP headers, compression, exact-count cost, database latency and rendering. Existing callers are unchanged.'}));
}
