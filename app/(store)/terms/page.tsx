import { LegalPage, legalSeo } from "@/features/legal/components/legal-page";
import { pageMetadata } from "@/lib/seo/metadata";
import { site } from "@/lib/seo/site";

export const metadata = pageMetadata(legalSeo("terms"), site);

export default function TermsPage() {
  return <LegalPage slug="terms" />;
}
