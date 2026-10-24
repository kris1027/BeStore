import { brandCardResponse } from "@/lib/seo/brand-images";

// spec 0018, AC-3: a fixed URL every page names as its share image. It reads no request data,
// so it prerenders at build.
export function GET() {
  return brandCardResponse();
}
