import { LegalPage, legalSeo } from "@/features/legal/components/legal-page";
import { shippingValues } from "@/features/legal/shipping-values";
import { env } from "@/lib/env";
import { storePageMetadata } from "@/lib/seo/site";
import { getShippingSettings } from "@/lib/shipping/settings";

export const metadata = storePageMetadata(legalSeo("shipping"));

// spec 0017, AC-5: static plus the cached settings read, which an admin save expires.
export default async function ShippingPage() {
  const settings = await getShippingSettings();
  return (
    <LegalPage
      slug="shipping"
      values={shippingValues(settings, {
        currency: env.STORE_CURRENCY,
        locale: env.STORE_LOCALE,
      })}
    />
  );
}
