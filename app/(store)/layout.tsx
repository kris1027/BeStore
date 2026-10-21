import { Suspense } from "react";

import { StoreShell } from "@/components/layout/store-shell";
import { AccountLink } from "@/features/account/components/account-link";
import { CartLink, CartLinkView } from "@/features/cart/components/cart-link";
import { HeaderSearch } from "@/features/catalog/listing/components/search-box";
import { categoryPath } from "@/features/categories/paths";
import { getNavCategories } from "@/features/categories/queries";
import { ConsentBanner } from "@/lib/consent/consent-banner";
import { ConsentProvider } from "@/lib/consent/consent-provider";
import { cookieRegistry } from "@/lib/consent/registry";
import { cookiePolicyVersion } from "@/lib/legal/documents";

// The nav is a cached read tagged `categories`, so the shell stays static (spec 0013, AC-3).
// Consent is read in the browser only (spec 0017, AC-22), which keeps it static too.
export default async function StoreLayout({ children }: LayoutProps<"/">) {
  const categories = await getNavCategories();
  return (
    <ConsentProvider policyVersion={cookiePolicyVersion} registry={cookieRegistry}>
      <StoreShell
        banner={<ConsentBanner />}
        navItems={categories.map((category) => ({
          href: categoryPath(category.slug),
          label: category.name,
        }))}
        actions={
          <>
            <HeaderSearch />
            <AccountLink />
            <Suspense fallback={<CartLinkView count={0} />}>
              <CartLink />
            </Suspense>
          </>
        }
      >
        {children}
      </StoreShell>
    </ConsentProvider>
  );
}
