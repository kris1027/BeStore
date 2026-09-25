import { useSyncExternalStore } from "react";

// The md breakpoint: below it the admin sidebar becomes an off canvas sheet.
const query = "(max-width: 767px)";

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(query);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

// useSyncExternalStore, not setState in an effect: it reads the media query during render
// and never paints a frame with the wrong layout after hydration.
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
