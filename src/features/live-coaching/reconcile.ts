/** Coalesce notifications; a notification during a read forces a later fresh read. */
export function createReconciler(read:(signal:AbortSignal)=>Promise<void>){
 let stopped=false,running=false,dirty=false;const abort=new AbortController();
 async function request(){if(stopped)return;dirty=true;if(running)return;running=true;try{while(dirty&&!stopped){dirty=false;await read(abort.signal);}}finally{running=false;}}
 return {request,stop(){stopped=true;dirty=false;abort.abort();}};
}
