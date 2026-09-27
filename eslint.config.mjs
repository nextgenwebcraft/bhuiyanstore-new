import js from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Module boundaries (guide section 21.3), enforced as lint errors.
 * Domain and contracts stay framework-free; client code never reaches server-only packages.
 */
const frameworkImports = [
  {
    group: ["react", "react-dom", "react/*", "next", "next/*"],
    message: "Framework-free package.",
  },
  { group: ["@prisma/*", "prisma", "pg", "@neondatabase/*"], message: "No database access here." },
  { group: ["redis", "ioredis", "bullmq"], message: "No cache/queue access here." },
];

const serverOnlyPackages = [
  { group: ["@bsd/database", "@bsd/application", "@bsd/auth"], message: "Server-only package." },
];

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/.next/**", "**/coverage/**", "**/next-env.d.ts"],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    extends: [...nextVitals],
    settings: { next: { rootDir: "apps/web" } },
  },
  {
    files: ["packages/domain/**/*.ts", "packages/contracts/**/*.ts", "packages/i18n/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [...frameworkImports, ...serverOnlyPackages] },
      ],
    },
  },
  {
    files: ["packages/architecture/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...frameworkImports,
            { group: ["@bsd/*"], message: "architecture IDs are leaf definitions." },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: serverOnlyPackages }],
    },
  },
);
