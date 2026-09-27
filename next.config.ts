import type { NextConfig } from "next";

import { productImagesConfig } from "./src/lib/image-config";

const nextConfig: NextConfig = {
  // Static catalog shell, request data behind Suspense (spec 0005, Caching model).
  cacheComponents: true,
  // Next logs every Server Function call with its arguments in development by default, which
  // prints admin passwords and TOTP codes to the terminal (spec 0004, AC-13).
  logging: { serverFunctions: false },
  images: productImagesConfig(process.env.NEXT_PUBLIC_SUPABASE_URL),
};

export default nextConfig;
