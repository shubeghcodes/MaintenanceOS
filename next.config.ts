import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: { ignoreDuringBuilds: true },
  serverExternalPackages: ["exceljs"],
  experimental: { serverActions: { bodySizeLimit: "40mb" } },
};

export default nextConfig;
