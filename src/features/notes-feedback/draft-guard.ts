"use client";

import { useEffect } from "react";

export const UNSAVED_MESSAGE = "Discard your unsaved notes or feedback changes?";

/** In-page Session transitions must call this before unmounting an editor. */
export function confirmDraftNavigation(dirty: boolean) {
  return !dirty || window.confirm(UNSAVED_MESSAGE);
}

/** Guard ordinary links, refresh/close and supported browser-history navigation. */
export function useDraftGuard(dirty: boolean, message = UNSAVED_MESSAGE) {
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download") || link.href === window.location.href) return;
      if (!window.confirm(message)) { event.preventDefault(); event.stopPropagation(); }
    };
    const submit=(event:SubmitEvent)=>{
      if(!event.defaultPrevented&&(event.target as Element|null)?.matches?.("form[data-account-sign-out]")&&!window.confirm(message)){
        event.preventDefault();event.stopPropagation();
      }
    };
    const navigation = (window as unknown as { navigation?: EventTarget }).navigation;
    const navigate = (event: Event) => {
      const transition = event as Event & { navigationType?: string };
      if (transition.navigationType === "traverse" && event.cancelable && !window.confirm(message)) event.preventDefault();
    };
    const currentUrl = window.location.href;
    const currentState = window.history.state;
    const popstate = (event: PopStateEvent) => {
      if (window.confirm(message)) return;
      // Legacy browsers announce traversal after changing the URL. Restore the
      // current route and stop the router from unmounting the dirty editor.
      event.stopImmediatePropagation();
      window.history.pushState(currentState, "", currentUrl);
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    document.addEventListener("submit",submit,true);
    navigation?.addEventListener("navigate", navigate);
    if (!navigation) window.addEventListener("popstate", popstate, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
      document.removeEventListener("submit",submit,true);
      navigation?.removeEventListener("navigate", navigate);
      if (!navigation) window.removeEventListener("popstate", popstate, true);
    };
  }, [dirty, message]);
}
