import type { Metadata } from "next";
import { cacheLife } from "next/cache";

import { StyleGuidePage } from "@/features/style-guide/components/style-guide-page";

export const metadata: Metadata = { title: "Style guide" };

// Token contrast is read from app/globals.css once, then served from the cache.
export default async function Page() {
  "use cache";
  cacheLife("max");
  return <StyleGuidePage />;
}
