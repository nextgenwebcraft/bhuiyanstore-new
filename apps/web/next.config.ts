import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: [
    "@bsd/architecture",
    "@bsd/contracts",
    "@bsd/design-system",
    "@bsd/domain",
    "@bsd/i18n",
  ],
  poweredByHeader: false,
};

export default nextConfig;
