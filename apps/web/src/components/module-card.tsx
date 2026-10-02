import Link from "next/link";
import { t, toBengaliDigits } from "@bsd/i18n";
import { Icon, type IconName } from "./icons";

/**
 * One reusable card link for module/screen navigation (guide section 21.6, R10): used for the
 * dashboard's module cards and each module landing page's screen cards.
 */
export function ModuleCard({
  href,
  title,
  icon,
  screenCount,
  notBuilt = false,
}: {
  href: string;
  title: string;
  icon?: IconName;
  /** Number of screens inside this module, shown on a group-level card. */
  screenCount?: number;
  /** Marks a leaf screen that has no prototype yet (guide section 5.5). */
  notBuilt?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group flex min-h-(--touch-target) items-center gap-4 rounded-xl border border-border bg-surface p-4 shadow-card transition-all hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-raised ${
        notBuilt ? "opacity-70" : ""
      }`}
    >
      {icon ? (
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand ring-1 ring-brand/10">
          <Icon name={icon} />
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium">{title}</span>
        {screenCount !== undefined ? (
          <span className="text-xs text-text-muted">
            {toBengaliDigits(String(screenCount))} {t("nav.moduleLanding.screenCount")}
          </span>
        ) : null}
        {notBuilt ? (
          <span className="text-xs text-text-muted">{t("nav.moduleLanding.notBuilt")}</span>
        ) : null}
      </span>
      <Icon
        name="arrowRight"
        className="size-4 text-text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-text-muted"
      />
    </Link>
  );
}
