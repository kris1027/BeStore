"use client";

import Link from "next/link";
import { useEffect } from "react";

import { StatusPage } from "@/components/status-page";
import { Wordmark } from "@/components/wordmark";
import { Button, buttonVariants } from "@/components/ui/button";

type ErrorPageProps = {
  readonly error: Error & { digest?: string };
  readonly retry: () => void;
};

// Replaces the page below the root layout, the store shell included, so it brings its own
// header and main. The message and stack never reach the visitor; the digest matches the logs.
export default function ErrorPage({ error, retry }: ErrorPageProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex h-(--header-height) items-center border-b px-4 sm:px-6 lg:px-8">
        <Wordmark />
      </header>
      <main id="main" tabIndex={-1} className="flex flex-1 flex-col">
        <StatusPage
          eyebrow={error.digest ? `Reference ${error.digest}` : undefined}
          title="Something went wrong"
          description="We couldn't load this page. It may work if you try again."
          actions={
            <>
              {/* retry() fetches and renders again; Next 16.3 prefers it over reset(). */}
              <Button size="lg" className="h-11 px-5" onClick={() => retry()}>
                Try again
              </Button>
              <Link
                href="/"
                className={buttonVariants({
                  variant: "outline",
                  size: "lg",
                  className: "h-11 px-5",
                })}
              >
                Go to the home page
              </Link>
            </>
          }
        />
      </main>
    </div>
  );
}
