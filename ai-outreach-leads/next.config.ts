import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Invoice uploads: 4 MB file + form overhead (Vercel caps request bodies at ~4.5 MB)
    serverActions: { bodySizeLimit: "4.2mb" },
  },
};

export default nextConfig;
