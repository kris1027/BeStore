import { logoResponse } from "@/lib/seo/brand-images";

// spec 0018, AC-4: the Organization logo, at a fixed URL. Prerendered at build.
export function GET() {
  return logoResponse();
}
