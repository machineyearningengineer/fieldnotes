import type { NextConfig } from "next";
const api = process.env.API_ORIGIN;
const config: NextConfig = {
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1"],
  devIndicators: false,
  agentRules: false,
  transpilePackages: ["@valyu-research/contracts"],
  async rewrites() {
    return api && process.env.NEXT_PUBLIC_APP_MODE !== "production"
      ? [{ source: "/api/research/:path*", destination: `${api}/:path*` }]
      : [];
  },
};
export default config;
