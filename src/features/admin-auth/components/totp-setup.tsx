"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";

import { enrollTotp, type EnrollTotpData } from "../actions/mfa";
import { authMessages } from "../messages";
import { FormNotice } from "./form-notice";
import { TotpCodeForm } from "./totp-code-form";

// "ABCD EFGH ..." so the secret can be read aloud or typed by hand.
function groupSecret(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(" ") ?? secret;
}

// The enroll view. The QR code and secret stay in this component's state, so a wrong code
// retry keeps the same factor and never invalidates a QR code already scanned (AC-4).
type TotpSetupProps = {
  readonly next: string | null;
  // A factor from an earlier QR code is still waiting for its first code.
  readonly pending: boolean;
};

export function TotpSetup({ next, pending: hasPendingFactor }: TotpSetupProps) {
  const [enrollment, setEnrollment] = useState<EnrollTotpData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const start = () => {
    setError(null);
    startTransition(async () => {
      const result = await enrollTotp();
      if (result.ok) setEnrollment(result.data);
      else setError(authMessages[result.error]);
    });
  };

  if (!enrollment) {
    return (
      <div className="flex flex-col gap-4">
        <FormNotice message={error} />
        <p className="text-sm text-muted-foreground">
          You need an authenticator app on your phone, such as Google Authenticator, 1Password or
          Microsoft Authenticator.
        </p>
        <Button
          type="button"
          size="lg"
          variant={hasPendingFactor ? "outline" : "default"}
          onClick={start}
          disabled={pending}
        >
          {pending ? <Spinner data-icon="inline-start" /> : null}
          Set up authenticator
        </Button>
        {hasPendingFactor ? (
          <>
            <Separator />
            <div className="flex flex-col gap-4">
              <h2 className="text-base font-medium">Already scanned the QR code?</h2>
              <p className="text-sm text-muted-foreground">
                Type the code from your app to finish. Setting up again shows a new QR code and
                replaces the one you scanned.
              </p>
              <TotpCodeForm next={next} submitLabel="Verify and continue" />
            </div>
          </>
        ) : null}
      </div>
    );
  }

  return (
    // The setup button is gone now, so focus moves to the steps that replaced it.
    <div ref={(node) => node?.focus()} tabIndex={-1} className="flex flex-col gap-6">
      <ol className="flex list-decimal flex-col gap-4 pl-5 text-sm">
        <li>
          <p>Scan this QR code with your authenticator app.</p>
          <div className="mt-3 flex justify-center rounded-lg border bg-background p-4">
            {/* An SVG data URL from Supabase; next/image adds nothing for it. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={enrollment.qrCode}
              alt="QR code for your authenticator app. The same key is written out below."
              width={176}
              height={176}
            />
          </div>
        </li>
        <li>
          <p>Or type this key into the app instead:</p>
          <p className="mt-2 rounded-md bg-muted px-3 py-2 font-mono text-base break-all select-all">
            {groupSecret(enrollment.secret)}
          </p>
        </li>
        <li>
          <p>Type the 6 digit code the app now shows.</p>
        </li>
      </ol>
      <TotpCodeForm next={next} submitLabel="Verify and continue" />
    </div>
  );
}
