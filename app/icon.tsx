import { logoResponse } from "@/lib/seo/brand-images";
import { logoSize } from "@/lib/seo/metadata";

// spec 0018, AC-4: the tab icon is the logo; favicon.ico stays for browsers that ask for it.
export const size = logoSize;
export const contentType = "image/png";

export default function Icon() {
  return logoResponse();
}
