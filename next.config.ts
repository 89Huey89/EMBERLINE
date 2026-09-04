import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  ...(process.env.STATIC_EXPORT ? { output: "export" as const } : {}),
  assetPrefix: process.env.ASSET_PREFIX || undefined,
  images: { unoptimized: true },
};

export default nextConfig;
