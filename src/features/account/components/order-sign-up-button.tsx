"use client";

import { useState, useTransition } from "react";

import { FormNotice } from "@/components/form-notice";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useHydrated } from "@/hooks/use-hydrated";

import { signUpFromOrder } from "../actions/sign-up-from-order";
import { accountMessages } from "../messages";

// A button, no fields: the email comes from the order on the server.
export function OrderSignUpButton({ sessionId }: { readonly sessionId: string }) {
  const hydrated = useHydrated();
  const [state, setState] = useState<"idle" | "sent" | "not_eligible">("idle");
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col items-start gap-3">
      <FormNotice
        tone="info"
        message={
          state === "sent"
            ? `${accountMessages.checkEmailTitle}. ${accountMessages.checkEmailBody}`
            : state === "not_eligible"
              ? "This order can no longer start an account here. Sign up from the account page instead."
              : null
        }
      />
      {state === "idle" ? (
        <Button
          type="button"
          size="lg"
          disabled={pending || !hydrated}
          onClick={() =>
            startTransition(async () => {
              const result = await signUpFromOrder(sessionId);
              setState(result.ok ? "sent" : "not_eligible");
            })
          }
        >
          {pending ? <Spinner data-icon="inline-start" /> : null}
          Create an account to track this order
        </Button>
      ) : null}
    </div>
  );
}
