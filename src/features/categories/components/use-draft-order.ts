import { useState } from "react";

// spec 0013, AC-23: the arranged order is a draft over the loaded list until Save order. A
// refresh with a new list (a save, a reload after stale, an add or remove) replaces the draft.
export function useDraftOrder(loaded: readonly string[]) {
  const loadedKey = loaded.join(",");
  const [order, setOrder] = useState<readonly string[]>(loaded);
  const [seen, setSeen] = useState(loadedKey);
  if (seen !== loadedKey) {
    setSeen(loadedKey);
    setOrder(loaded);
  }
  return {
    order,
    setOrder,
    reset: () => setOrder(loaded),
    dirty: order.join(",") !== loadedKey,
  } as const;
}
