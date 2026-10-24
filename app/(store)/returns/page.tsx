import { LegalPage, legalSeo } from "@/features/legal/components/legal-page";
import { storePageMetadata } from "@/lib/seo/site";

export const metadata = storePageMetadata(legalSeo("returns"));

export default function ReturnsPage() {
  return <LegalPage slug="returns" />;
}
