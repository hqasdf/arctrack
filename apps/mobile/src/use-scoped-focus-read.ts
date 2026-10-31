import {useFocusEffect} from 'expo-router';
import {useCallback,useLayoutEffect,useRef,useState} from 'react';

function authorizationLost(error:unknown,depth=0):boolean {
 if(!error||typeof error!=='object'||depth>3)return false;
 const value=error as {reason?:string;code?:string;status?:number;cause?:unknown};
 return value.reason==='authorization'||value.status===401||value.status===403||['42501','PGRST301','PGRST302'].includes(value.code??'')||authorizationLost(value.cause,depth+1);
}
type Snapshot<T>={scope:string|null;data:T|null;loading:boolean;error:string|null};
/** No polling or provider work. Each focused read owns one generation and scope.
 * Scope-tagged state prevents even the pre-effect render from exposing old data.
 */
export function useScopedFocusRead<T>(scope:string|null,read:(current:()=>boolean)=>Promise<T|null>,message:string,background=false){
 const gate=useRef({scope:null as string|null,generation:0,mounted:false,focused:false});
 const [snapshot,setSnapshot]=useState<Snapshot<T>>({scope:null,data:null,loading:false,error:null});
 useLayoutEffect(()=>{
  const control=gate.current;control.scope=scope;control.mounted=true;control.generation++;
  return ()=>{control.mounted=false;control.focused=false;control.generation++;};
 },[scope]);
 const reload=useCallback(async()=>{
  const control=gate.current;
  if(!control.mounted||!control.focused||control.scope!==scope)return;
  if(!scope){setSnapshot({scope:null,data:null,loading:false,error:null});return;}
  const ticket=++control.generation;
  const current=()=>control.mounted&&control.focused&&control.scope===scope&&control.generation===ticket;
  setSnapshot(previous=>current()?{scope,data:previous.scope===scope?previous.data:null,loading:!(background&&previous.scope===scope&&previous.data!==null),error:null}:previous);
  try{
   const data=await read(current);
   if(current())setSnapshot(previous=>current()?{scope,data,loading:false,error:null}:previous);
  }catch(error){
   if(current())setSnapshot(previous=>current()?{scope,data:background&&!authorizationLost(error)&&previous.scope===scope?previous.data:null,loading:false,error:message}:previous);
  }
 },[scope,read,message,background]);
 useFocusEffect(useCallback(()=>{
  const control=gate.current;control.focused=true;void reload();
  return ()=>{control.focused=false;control.generation++;};
 },[reload]));
 const visible=scope===null?{data:null,loading:false,error:null}:snapshot.scope===scope?snapshot:{data:null,loading:true,error:null};
 return {data:visible.data,loading:visible.loading,error:visible.error,reload};
}
