import { LegalPage, legalMetadata } from "@/features/legal/components/legal-page";

export const metadata = legalMetadata("terms");

export default function TermsPage() {
  return <LegalPage slug="terms" />;
}
