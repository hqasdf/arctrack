type Identity = {userId:string;displayName?:string|null;firstName?:string|null;lastName?:string|null};
const clean=(value:string|null|undefined)=>value?.trim().replace(/\s+/g,' ')??'';
/** Only supplied, authorized profile fields. Account references reveal no contact data. */
export function athleteIdentities(roster:Identity[]){
 const names=roster.map(a=>[clean(a.firstName),clean(a.lastName)].filter(Boolean).join(' ')||clean(a.displayName));
 return roster.map((a,i)=>{
  const name=names[i],missing=!name||/^(archer|athlete)$/i.test(name);
  const duplicate=names.some((n,j)=>j!==i&&n.toLocaleLowerCase()===name.toLocaleLowerCase());
  let length=8;while(length<a.userId.length&&roster.some(b=>b.userId!==a.userId&&b.userId.slice(0,length)===a.userId.slice(0,length)))length++;
  return {...a,name:missing?'Name not provided':name,identifier:missing||duplicate||!name.includes(' ')?'Account '+a.userId.slice(0,length):null};
 });
}
