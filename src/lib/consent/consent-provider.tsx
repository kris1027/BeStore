"use client";

import { createContext, useContext, useMemo, useState, useSyncExternalStore } from "react";

import {
  type Choices,
  CONSENT_COOKIE,
  type ConsentChoice,
  consentCookieString,
  cookieNames,
  cookiesToDelete,
  type CookieRegistry,
  expiredCookieString,
  grantedChoices,
  parseConsent,
  readCookie,
  revokedCategories,
  shouldShowBanner,
} from "./consent";
import { ConsentDialog } from "./consent-dialog";

// spec 0017, AC-15 to AC-22: the browser side of consent. The server never reads the choice, so
// the store shell stays static: everything here starts "not ready" in the server HTML and on the
// first client render, then reads document.cookie once React has hydrated (Build details 9).
//
// The context holds a store that never changes, and each consumer (banner, dialog, settings
// control, gates) subscribes on its own. A context value that changed on hydration would reach
// Suspense boundaries still streaming below the provider, and React would throw away their
// server HTML and render them again on the client.

type ConsentStore = {
  readonly policyVersion: string;
  readonly registry: CookieRegistry;
  readonly subscribe: (listener: () => void) => () => void;
  readonly save: (next: Choices) => void;
  readonly openSettings: () => void;
};

const ConsentContext = createContext<ConsentStore | null>(null);

const noSubscription = () => () => {};

// Global Privacy Control is not in the DOM typings yet.
type GpcNavigator = Navigator & { readonly globalPrivacyControl?: boolean };

// The saved choice as it stands, or null. The 12 month age is checked against when this page
// loaded (performance.timeOrigin, epoch milliseconds), never Date.now() in render, which Cache
// Components refuses; a tab left open across the mark asks on its next load.
function currentChoice(cookieString: string, policyVersion: string): ConsentChoice | null {
  return parseConsent(
    readCookie(cookieString, CONSENT_COOKIE),
    policyVersion,
    performance.timeOrigin,
  );
}

function createConsentStore(
  policyVersion: string,
  registry: CookieRegistry,
  onOpen: (opener: HTMLElement | null) => void,
): ConsentStore {
  const listeners = new Set<() => void>();
  return {
    policyVersion,
    registry,
    openSettings() {
      onOpen(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    save(next) {
      const previous = grantedChoices(currentChoice(document.cookie, policyVersion));
      // AC-20: cookies of a category turned off go first, on the same host only scope they were
      // set with, then the new choice, then a reload so a script already running stops.
      for (const name of cookiesToDelete(previous, next, registry, cookieNames(document.cookie))) {
        document.cookie = expiredCookieString(name);
      }
      document.cookie = consentCookieString(
        { v: policyVersion, at: Date.now(), ...next },
        location.protocol === "https:",
      );
      if (revokedCategories(previous, next).length > 0) {
        location.reload();
        return;
      }
      for (const listener of listeners) listener();
    },
  };
}

export type ConsentState = {
  readonly ready: boolean;
  readonly granted: Choices;
  readonly choice: ConsentChoice | null;
  readonly registry: CookieRegistry;
  readonly showBanner: boolean;
  readonly openSettings: () => void;
  readonly save: (next: Choices) => void;
};

// For the banner, the dialog and the settings control. Null with no provider above, which the
// footer control turns into a plain link to /cookies.
export function useConsentState(): ConsentState | null {
  const store = useContext(ConsentContext);
  // null on the server and until hydration; after it, the cookie string as it is now.
  const cookieString = useSyncExternalStore(
    store?.subscribe ?? noSubscription,
    () => (store === null ? null : document.cookie),
    () => null,
  );
  const gpc = useSyncExternalStore(
    noSubscription,
    () => (navigator as GpcNavigator).globalPrivacyControl === true,
    () => false,
  );
  return useMemo(() => {
    if (store === null) return null;
    const ready = cookieString !== null;
    const choice = ready ? currentChoice(cookieString, store.policyVersion) : null;
    return {
      ready,
      granted: grantedChoices(choice),
      choice,
      registry: store.registry,
      showBanner: ready && shouldShowBanner({ registry: store.registry, choice, gpc }),
      openSettings: store.openSettings,
      save: store.save,
    };
  }, [store, cookieString, gpc]);
}

export type Consent = {
  readonly ready: boolean;
  readonly analytics: boolean;
  readonly marketing: boolean;
  readonly openSettings: () => void;
};

const notReady: Consent = {
  ready: false,
  analytics: false,
  marketing: false,
  openSettings: () => {},
};

// AC-22, for feature 18: whether analytics or marketing may run. Never true before mount.
export function useConsent(): Consent {
  const state = useConsentState();
  if (state === null || !state.ready) return notReady;
  return { ready: true, ...state.granted, openSettings: state.openSettings };
}

export function ConsentProvider({
  policyVersion,
  registry,
  children,
}: {
  // The /cookies front matter `updated`; a choice made against another version asks again.
  readonly policyVersion: string;
  readonly registry: CookieRegistry;
  readonly children: React.ReactNode;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Where focus goes back when the dialog closes: whatever opened it.
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  // Made once; the props never change for a mounted layout.
  const [store] = useState(() =>
    createConsentStore(policyVersion, registry, (element) => {
      setOpener(element);
      setSettingsOpen(true);
    }),
  );

  return (
    <ConsentContext value={store}>
      {children}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} opener={opener} />
    </ConsentContext>
  );
}

function SettingsDialog({
  open,
  onOpenChange,
  opener,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly opener: HTMLElement | null;
}) {
  const state = useConsentState();
  if (state === null || !state.ready) return null;
  return (
    <ConsentDialog
      open={open}
      onOpenChange={onOpenChange}
      registry={state.registry}
      granted={state.granted}
      onSave={(next) => {
        onOpenChange(false);
        state.save(next);
      }}
      finalFocus={opener}
    />
  );
}
