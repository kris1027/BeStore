import { LegalPage, legalSeo } from "@/features/legal/components/legal-page";
import { storePageMetadata } from "@/lib/seo/site";

export const metadata = storePageMetadata(legalSeo("terms"));

export default function TermsPage() {
  return <LegalPage slug="terms" />;
}
