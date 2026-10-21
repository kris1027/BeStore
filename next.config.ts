import type { NextConfig } from "next";

import { productImagesConfig } from "./src/lib/image-config";
import { legalContent } from "./src/lib/legal/content-path";

const nextConfig: NextConfig = {
  // Static catalog shell, request data behind Suspense (spec 0005, Caching model).
  cacheComponents: true,
  // Next logs every Server Function call with its arguments in development by default, which
  // prints admin passwords and TOTP codes to the terminal (spec 0004, AC-13).
  logging: { serverFunctions: false },
  images: productImagesConfig(process.env.NEXT_PUBLIC_SUPABASE_URL),
  // The legal texts are bundled as strings, never read with fs at runtime (spec 0017). Scoped to
  // their folder, so no other Markdown file changes meaning.
  turbopack: {
    rules: {
      "*.md": {
        condition: { path: legalContent },
        loaders: ["./scripts/raw-text-loader.cjs"],
        as: "*.js",
      },
    },
  },
  // The confirmation URL carries a Stripe session id, the key to the order it shows; it must
  // never reach another site through a Referer header or a search index (spec 0006, AC-11).
  async headers() {
    return [
      {
        source: "/checkout/complete",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex" },
        ],
      },
      // The same for the account confirm link, which carries a one time token (spec 0012, AC-2).
      {
        source: "/account/confirm",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex" },
        ],
      },
    ];
  },
};

export default nextConfig;
