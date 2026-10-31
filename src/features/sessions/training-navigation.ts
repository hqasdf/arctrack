export const TRAINING_NAVIGATION = "arctrack:training-navigation";
export const TRAINING_LOCATION_CHANGED = "arctrack:training-location-changed";
export function trainingHref(sessionId?: string, roundId?: string, counter = false) {
  const query = new URLSearchParams();
  if(sessionId)query.set("session",sessionId);
  if(roundId)query.set("round",roundId);
  if(counter)query.set("tool","counter");
  return "/sessions"+(query.size?"?"+query.toString():"");
}
export function navigateTraining(sessionId?: string, roundId?: string, counter = false) {
  const href=trainingHref(sessionId,roundId,counter);
  if(window.location.pathname+window.location.search!==href)window.history.pushState(null,"",href);
  window.dispatchEvent(new Event(TRAINING_LOCATION_CHANGED));
}
