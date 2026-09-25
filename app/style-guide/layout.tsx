import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { env } from "@/lib/env";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// VERCEL_ENV, not NODE_ENV: NODE_ENV is "production" on preview deploys too, where the
// style guide should stay visible for review.
export default function StyleGuideLayout({ children }: LayoutProps<"/style-guide">) {
  if (env.VERCEL_ENV === "production") notFound();
  return children;
}
