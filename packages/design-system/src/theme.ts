import type { CompanyTheme } from "@bsd/contracts";

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
