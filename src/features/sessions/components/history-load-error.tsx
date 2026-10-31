'use client';
export function HistoryLoadError({reset}:{reset:()=>void}){
 return <section role="alert"><h2>Complete Session data is unavailable</h2><p>This view could not verify all required data. Partial history has not been used to calculate statistics. Please retry.</p><button type="button" onClick={reset}>Retry loading</button></section>;
}
