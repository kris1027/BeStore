"use client";

import { createContext, useContext } from "react";

import type { MoneyFormat } from "@/lib/money";

const StoreFormatContext = createContext<MoneyFormat | null>(null);

// Mounted once in the root layout from env, so client components (the cart) format prices
// without the server env ever reaching the browser: only these two values cross over.
export function StoreFormatProvider({
  locale,
  currency,
  children,
}: MoneyFormat & { readonly children: React.ReactNode }) {
  return (
    <StoreFormatContext.Provider value={{ locale, currency }}>
      {children}
    </StoreFormatContext.Provider>
  );
}

export function useStoreFormat(): MoneyFormat {
  const format = useContext(StoreFormatContext);
  if (!format) {
    throw new Error("useStoreFormat must be used inside StoreFormatProvider (app/layout.tsx).");
  }
  return format;
}
