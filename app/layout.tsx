import type { Metadata } from "next";

import { StoreFormatProvider } from "@/components/store-format-provider";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { brand } from "@/lib/brand/brand";
import { fontHeading, fontSans } from "@/lib/brand/fonts";
import { env } from "@/lib/env";
import { defaultDescription } from "@/lib/seo/metadata";
import { cn } from "@/lib/utils";

import "./globals.css";

// spec 0018, AC-1: every relative metadata URL resolves on the site's own origin.
export const metadata: Metadata = {
  metadataBase: new URL(env.NEXT_PUBLIC_SITE_URL),
  title: { default: brand.name, template: `%s · ${brand.name}` },
  description: defaultDescription(brand.name),
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang={env.STORE_LOCALE}
      className={cn("h-full antialiased", fontSans.variable, fontHeading.variable)}
    >
      <body className="flex min-h-full flex-col">
        {/* Only the two format values cross to the client, never the whole env. */}
        <StoreFormatProvider locale={env.STORE_LOCALE} currency={env.STORE_CURRENCY}>
          <TooltipProvider>
            <Toaster>{children}</Toaster>
          </TooltipProvider>
        </StoreFormatProvider>
      </body>
    </html>
  );
}
