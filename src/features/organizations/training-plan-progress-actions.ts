"use server";
import { requireUser } from "@/lib/auth/session.server";
import { singaporeDate } from "@/lib/date";
import { readOwnTrainingPlanProgress } from "./training-plans-read.server";

export async function loadOwnTrainingPlanProgress() {
  await requireUser();
  try{return {ok:true as const,data:await readOwnTrainingPlanProgress(singaporeDate(new Date()))};}
  catch{return {ok:false as const,message:"Training Plan progress could not be refreshed. Your scores remain saved."};}
}
