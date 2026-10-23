import { CookieTable } from "@/features/legal/components/cookie-table";
import { LegalPage, legalSeo } from "@/features/legal/components/legal-page";
import { cookieRegistry } from "@/lib/consent/registry";
import { CookieSettingsButton } from "@/lib/consent/cookie-settings-control";
import { storePageMetadata } from "@/lib/seo/site";

export const metadata = storePageMetadata(legalSeo("cookies"));

// spec 0017, AC-16 and AC-17: the policy, the registry table, and the settings button.
export default function CookiesPage() {
  return (
    <LegalPage slug="cookies">
      <CookieTable registry={cookieRegistry} />
      <CookieSettingsButton />
    </LegalPage>
  );
}
