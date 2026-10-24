import { LegalPage, legalSeo } from "@/features/legal/components/legal-page";
import { storePageMetadata } from "@/lib/seo/site";

export const metadata = storePageMetadata(legalSeo("privacy"));

export default function PrivacyPage() {
  return <LegalPage slug="privacy" />;
}
