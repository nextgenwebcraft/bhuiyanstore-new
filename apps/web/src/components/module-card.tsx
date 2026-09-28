import Link from "next/link";
import { t, toBengaliDigits } from "@bsd/i18n";

/**
 * One reusable card link for module/screen navigation (guide section 21.6, R10): used for the
 * dashboard's module cards and each module landing page's screen cards. Plain surface/border
 * tokens only; no decorative styling.
 */
export function ModuleCard({
  href,
  title,
  screenCount,
  notBuilt = false,
}: {
  href: string;
  title: string;
  /** Number of screens inside this module, shown on a group-level card. */
  screenCount?: number;
  /** Marks a leaf screen that has no prototype yet (guide section 5.5). */
  notBuilt?: boolean;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-(--touch-target) flex-col gap-1 rounded-lg border border-border bg-surface p-4 hover:bg-surface-muted"
    >
      <span className="font-medium">{title}</span>
      {screenCount !== undefined ? (
        <span className="text-sm text-text-muted">
          {toBengaliDigits(String(screenCount))} {t("nav.moduleLanding.screenCount")}
        </span>
      ) : null}
      {notBuilt ? (
        <span className="text-sm text-text-muted">{t("nav.moduleLanding.notBuilt")}</span>
      ) : null}
    </Link>
  );
}
