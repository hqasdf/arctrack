import {sessionAuthority,supabase} from './supabase';
export type TrainingInvitation={id:string;organization_id:string;title:string;training_date:string;state:'created'|'waiting'|'active'|'completed'|'cancelled';version:number;organization_name:string;coach_name:string|null;participation_state:'invited'|'joined'|'declined'|'left'};
export type AthleteTrainingDetail={session:{id:string;organization_id:string;state:TrainingInvitation['state'];version:number;training_date:string};coach:false;viewerId:string;participants:{athleteId:string;state:TrainingInvitation['participation_state'];scoringSessionId:string|null}[];eligibleSessions:{id:string;title:string;session_date:string}[]};
async function clientFor(userId:string){
 if(!supabase)throw Error('Live Coaching is unavailable.');
 const before=sessionAuthority?.snapshot();const accepted=before?.accepted;
 const check=()=>{const now=sessionAuthority?.snapshot();if(!accepted||accepted.accountId!==userId||accepted.mode!=='normal'||before?.retiring||now?.retiring||now?.accepted?.mode!=='normal'||now?.accepted?.accountId!==userId||now.accepted.epoch!==accepted.epoch)throw Error('Account changed. Reopen Organisations.');};
 check();const {data,error}=await supabase.auth.getUser();check();if(error||data.user?.id!==userId)throw Error('Sign in again to view training.');
 return {client:supabase,check};
}
function failure(code?:string){return code==='40001'?'Training changed. Reload and retry.':code==='42501'?'Training access expired or membership changed.':'Training could not be confirmed. Check your connection and retry.';}
export async function readTrainingInvitations(userId:string,organizationId:string){const {client,check}=await clientFor(userId);const {data,error}=await client.rpc('read_live_coaching_invitations',{p_org:organizationId});check();if(error)throw Error(failure(error.code));if(!Array.isArray(data?.sessions))throw Error('Invitations could not be verified.');return (data.sessions as TrainingInvitation[]).filter(s=>s.organization_id===organizationId);}
export async function readAthleteTraining(userId:string,id:string){const {client,check}=await clientFor(userId);const {data,error}=await client.rpc('read_live_coaching',{p_id:id,p_org:null});check();if(error)throw Error(failure(error.code));if(data?.coach!==false||data.viewerId!==userId||data.session?.id!==id||!Array.isArray(data.participants)||data.participants.some((p:{athleteId:string})=>p.athleteId!==userId))throw Error('Athlete access could not be verified.');return data as AthleteTrainingDetail;}
export async function trainingAction(userId:string,session:{id:string;version:number},action:'join'|'decline'|'leave'|'link',scoringSessionId?:string){
 if(!Number.isSafeInteger(session.version)||session.version<1||action==='link'&&!scoringSessionId)throw Error('Reload the training and choose your scoring Session.');
 const {client,check}=await clientFor(userId);const {data,error}=await client.rpc('live_coaching_command',{p_action:action,p_id:session.id,p_org:null,p_title:null,p_date:null,p_athletes:[],p_scoring:scoringSessionId??null,p_expected:session.version});check();if(error)throw Error(failure(error.code));if(data!==session.id)throw Error('Training change was not confirmed.');
}
/** Payload-free invalidations only. No HR subscription and no scoring uploads here. */
export function watchAthleteTraining(userId:string,id:string,onChange:()=>void,onUnavailable:()=>void){
 if(!supabase)return ()=>{};const client=supabase;let stopped=false;
 const channel=client.channel('live-coaching:'+id+':'+userId,{config:{private:true}}).on('broadcast',{event:'changed'},()=>{if(!stopped)onChange();}).subscribe(status=>{if(stopped)return;if(status==='SUBSCRIBED')onChange();else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED')onUnavailable();});
 return ()=>{stopped=true;void client.removeChannel(channel);};
}
