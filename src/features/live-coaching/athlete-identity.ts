import type {Participant} from './model';
type Identity = {userId:string;displayName?:string|null;firstName?:string|null;lastName?:string|null};
const clean=(value:string|null|undefined)=>value?.trim().replace(/\s+/g,' ')??'';
/** displayName is the saved profiles.display_name from the authorized roster RPC.
 * Never classify a real profile value as a placeholder based on its spelling. */
export function athleteIdentities<T extends Identity>(roster:T[]){
 const names=roster.map(a=>clean(a.displayName)||[clean(a.firstName),clean(a.lastName)].filter(Boolean).join(' '));
 return roster.map((a,i)=>{
  const name=names[i],missing=!name;
  const duplicate=names.some((n,j)=>j!==i&&n.toLocaleLowerCase()===name.toLocaleLowerCase());
  let length=8;while(length<a.userId.length&&roster.some(b=>b.userId!==a.userId&&b.userId.slice(0,length)===a.userId.slice(0,length)))length++;
  return {...a,name:missing?'Name not provided':name,identifier:missing||duplicate?'Account '+a.userId.slice(0,length):null};
 });
}
/** Use the same identity resolution throughout the scoreboard, details and sensor controls. */
export function identifyParticipants(participants:Participant[]):Participant[]{
 const identities=athleteIdentities(participants.map(p=>({userId:p.athleteId,displayName:p.displayName})));
 return participants.map((p,i)=>({...p,displayName:identities[i].name,identityLabel:identities[i].identifier}));
}
