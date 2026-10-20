import { LegalPage, legalMetadata } from "@/features/legal/components/legal-page";

export const metadata = legalMetadata("privacy");

export default function PrivacyPage() {
  return <LegalPage slug="privacy" />;
}
