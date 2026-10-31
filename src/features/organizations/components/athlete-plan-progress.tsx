"use client";
import { useEffect, useRef, useState } from "react";
import { AthletePlanCard } from "./training-plan-ui";
import { loadOwnTrainingPlanProgress } from "../training-plan-progress-actions";
import { TRAINING_PLAN_PROGRESS_CHANGED, trainingPlanProgressRevision } from "../training-plan-events";
import type { readOwnTrainingPlanProgress } from "../training-plans-read.server";

type Plans=Awaited<ReturnType<typeof readOwnTrainingPlanProgress>>;
export function AthletePlanProgress({plans,today}:{plans:Plans;today:string}) {
  const [updated,setUpdated]=useState<{source:Plans;value:Plans}|null>(null),[error,setError]=useState("");
  const retry=useRef<()=>void>(()=>{});
  useEffect(()=>{
    let alive=true,running=false,again=false;
    const refresh=async()=>{
      again=true;if(running)return;running=true;
      try{while(again&&alive){again=false;const result=await loadOwnTrainingPlanProgress();if(!alive)return;
        if(result.ok){setUpdated({source:plans,value:result.data});setError("");}else setError(result.message);
      }}catch{if(alive)setError("Training Plan progress could not be refreshed. Your scores remain saved.");}
      finally{running=false;}
    };
    retry.current=()=>{void refresh();};window.addEventListener(TRAINING_PLAN_PROGRESS_CHANGED,retry.current);
    const listener=retry.current;
    if(trainingPlanProgressRevision()>0)void refresh();
    return()=>{alive=false;window.removeEventListener(TRAINING_PLAN_PROGRESS_CHANGED,listener);retry.current=()=>{};};
  },[plans]);
  return <>{error&&<p role="status">{error} <button type="button" onClick={()=>retry.current()}>Retry progress</button></p>}
    <AthletePlanCard plans={updated?.source===plans?updated.value:plans} today={today}/></>;
}
