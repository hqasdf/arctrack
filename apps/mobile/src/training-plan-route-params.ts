/** Expo Router params may be repeated query values; never pass arrays into readers. */
export function singleTrainingPlanRouteParam(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
