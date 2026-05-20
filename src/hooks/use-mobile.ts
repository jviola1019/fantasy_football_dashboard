import * as React from "react";

const MOBILE_BREAKPOINT = 768;

/**
 * True when the viewport is below the mobile breakpoint.
 *
 * Implemented with `useSyncExternalStore` rather than the stock shadcn
 * `useEffect` + `setState` pattern: the project's lint config forbids calling
 * setState synchronously inside an effect. useSyncExternalStore is the
 * canonical React way to read a browser media query without that hazard.
 */
function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerWidth < MOBILE_BREAKPOINT;
}

export function useIsMobile(): boolean {
  return React.useSyncExternalStore(subscribe, getSnapshot, () => false);
}
