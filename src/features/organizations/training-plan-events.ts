export const TRAINING_PLAN_PROGRESS_CHANGED = "arctrack:training-plan-progress";
let revision=0;
export function trainingPlanProgressRevision(){return revision;}
export function notifyTrainingPlanProgress() {
  revision++;
  if(typeof window!=="undefined")window.dispatchEvent(new Event(TRAINING_PLAN_PROGRESS_CHANGED));
}
