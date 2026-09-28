"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Spinner } from "@/components/ui/spinner";

export const REFRESH_EVERY_MS = 3_000;
export const GIVE_UP_AFTER_MS = 60_000;

// spec 0006, AC-11: while the webhook has not landed, rerender the page every 3 seconds for up
// to a minute. The server decides each time; this only asks again. It stays mounted across
// refreshes, so the minute counts from the first render, and unmounts once the order is paid.
export function CompleteRefresher({ orderNumber }: { readonly orderNumber: number }) {
  const router = useRouter();
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - startedAt >= GIVE_UP_AFTER_MS) {
        window.clearInterval(timer);
        setGaveUp(true);
        return;
      }
      router.refresh();
    }, REFRESH_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [router]);

  if (gaveUp) {
    return (
      <div className="flex flex-col gap-3">
        <p role="status" className="sr-only">
          This is taking longer than usual. Your order number is {orderNumber}.
        </p>
        <h1 className="font-heading text-4xl md:text-5xl">This is taking longer than usual</h1>
        <p className="text-lg text-muted-foreground">
          Your order number is <span className="font-medium text-foreground">#{orderNumber}</span>.
          We are still waiting for the payment confirmation. You can reload this page in a few
          minutes to check again.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <h1 className="flex items-center gap-3 font-heading text-4xl md:text-5xl">
        <Spinner aria-hidden="true" className="size-7" />
        Confirming your payment
      </h1>
      <p className="text-lg text-muted-foreground">
        This usually takes a few seconds. Order{" "}
        <span className="font-medium text-foreground">#{orderNumber}</span>.
      </p>
    </div>
  );
}
