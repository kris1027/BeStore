import { LegalPage, legalMetadata } from "@/features/legal/components/legal-page";

export const metadata = legalMetadata("returns");

export default function ReturnsPage() {
  return <LegalPage slug="returns" />;
}
