import type { CompanyTheme } from "@bsd/contracts";

/** Starting theme for a new company; the same neutral values as the tokens.css defaults. */
export const DEFAULT_COMPANY_THEME = {
  primary: "#1f2937",
  primaryForeground: "#ffffff",
} as const satisfies CompanyTheme;

/**
 * Maps an approved company theme (shape owned by @bsd/contracts) to the CSS custom properties
 * consumed by tokens.css. Status colors are never overridden per company (guide section 4.3).
 */
export function themeToCssVars(theme: CompanyTheme): Record<string, string> {
  return {
    "--brand-primary": theme.primary,
    "--brand-primary-foreground": theme.primaryForeground,
    ...(theme.accent ? { "--brand-accent": theme.accent } : {}),
  };
}
