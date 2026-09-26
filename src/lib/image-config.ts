import type { NextConfig } from "next";

type ImagesConfig = NonNullable<NextConfig["images"]>;

// Product images come from the public product-images bucket (spec 0005, Caching model). The
// optimizer refuses local addresses unless allowed, which only the local and CI stacks need.
export function productImagesConfig(supabaseUrl: string | undefined): ImagesConfig {
  if (!supabaseUrl) return {};
  const url = new URL(supabaseUrl);
  const isLocal = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  return {
    remotePatterns: [
      {
        protocol: url.protocol === "https:" ? "https" : "http",
        hostname: url.hostname,
        port: url.port,
        pathname: "/storage/v1/object/public/product-images/**",
      },
    ],
    ...(isLocal ? { dangerouslyAllowLocalIP: true } : {}),
  };
}
