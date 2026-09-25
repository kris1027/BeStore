import type { Metadata } from "next";

import { StyleGuidePage } from "@/features/style-guide/components/style-guide-page";

export const metadata: Metadata = { title: "Style guide" };

// Token contrast is read from app/globals.css at build time.
export const dynamic = "force-static";

export default function Page() {
  return <StyleGuidePage />;
}
