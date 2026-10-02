import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

// One `.env` at the repository root serves Prisma, the scripts and the web app.
loadEnv({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: [
    "@bsd/application",
    "@bsd/architecture",
    "@bsd/auth",
    "@bsd/contracts",
    "@bsd/database",
    "@bsd/design-system",
    "@bsd/domain",
    "@bsd/i18n",
    "@bsd/importer",
  ],
  serverExternalPackages: ["pg", "@prisma/adapter-pg"],
  poweredByHeader: false,
};

export default nextConfig;
