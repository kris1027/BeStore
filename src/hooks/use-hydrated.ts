import { useSyncExternalStore } from "react";

const noSubscription = () => () => {};

// False in the server render and until React takes over the page. Forms keep their submit
// buttons disabled until then: before hydration a click would submit natively (a GET with the
// fields in the query), and React Hook Form has not attached its inputs yet.
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}
