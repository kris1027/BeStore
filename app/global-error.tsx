"use client";

import { StatusPage } from "@/components/status-page";
import { Button } from "@/components/ui/button";
import { fontHeading, fontSans } from "@/lib/brand/fonts";
import { cn } from "@/lib/utils";

import "./globals.css";

type GlobalErrorProps = {
  readonly error: Error & { digest?: string };
  readonly retry: () => void;
};

// Replaces the root layout when it fails, so it renders its own document with the fonts and
// tokens. `lang` is a literal: a client boundary cannot read the server env (spec 0003).
// A plain <a> for home: a full reload recovers from a broken root layout, a client
// navigation may not.
export default function GlobalError({ error, retry }: GlobalErrorProps) {
  return (
    <html lang="en" className={cn("h-full antialiased", fontSans.variable, fontHeading.variable)}>
      <body className="flex min-h-full flex-col">
        <title>Something went wrong</title>
        <main id="main" className="flex flex-1 flex-col">
          <StatusPage
            eyebrow={error.digest ? `Reference ${error.digest}` : undefined}
            title="Something went wrong"
            description="We couldn't load the store. It may work if you try again."
            actions={
              <>
                <Button size="lg" className="h-11 px-5" onClick={() => retry()}>
                  Try again
                </Button>
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                <a
                  href="/"
                  className="inline-flex h-11 items-center text-sm underline underline-offset-4"
                >
                  Go to the home page
                </a>
              </>
            }
          />
        </main>
      </body>
    </html>
  );
}
