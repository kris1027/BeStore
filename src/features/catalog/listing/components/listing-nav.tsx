"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useOptimistic, useTransition } from "react";

import { useStoreFormat } from "@/components/store-format-provider";

import { type ListingKind, type ListingState, listingHref } from "../params";

type ListingNav = {
  // The state on screen: the URL's, or the one a change is moving to.
  readonly state: ListingState;
  readonly pending: boolean;
  readonly kind: ListingKind;
  readonly path: string;
  readonly currency: string;
  readonly href: (state: ListingState) => string;
  readonly apply: (next: ListingState) => void;
};

const ListingNavContext = createContext<ListingNav | null>(null);

// spec 0013, AC-19: every change pushes the new URL in a transition, so the results swap without
// a full load, the panel (and an open Sheet) keeps its state and focus, and Back undoes it. The
// optimistic state lets a second click build on the first before the server answers.
export function ListingNavProvider({
  kind,
  path,
  state,
  children,
}: {
  readonly kind: ListingKind;
  readonly path: string;
  readonly state: ListingState;
  readonly children: React.ReactNode;
}) {
  const router = useRouter();
  const { currency } = useStoreFormat();
  const [shown, setShown] = useOptimistic(state);
  const [pending, startTransition] = useTransition();
  const href = (next: ListingState) => listingHref(path, next, kind, currency);

  function apply(next: ListingState) {
    startTransition(() => {
      setShown(next);
      router.push(href(next), { scroll: false });
    });
  }

  return (
    <ListingNavContext.Provider
      value={{ state: shown, pending, kind, path, currency, href, apply }}
    >
      {children}
    </ListingNavContext.Provider>
  );
}

export function useListingNav(): ListingNav {
  const nav = useContext(ListingNavContext);
  if (!nav) throw new Error("useListingNav must be used inside ListingNavProvider.");
  return nav;
}
