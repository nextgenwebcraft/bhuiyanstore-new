"use client";

import type { CompanyWorkspace } from "@bsd/contracts";
import { t, toBengaliDigits } from "@bsd/i18n";
import Link from "next/link";
import { Icon, sectionIcon } from "@/components/icons";
import { companyHref, visibleFlow, type FlowLink, type FlowLinkGroup } from "./navigation";

export function ShortcutHint({ n }: { n: number }) {
  return (
    <kbd className="ml-auto hidden shrink-0 rounded border border-border bg-surface-muted px-1.5 font-sans text-[10.5px] text-text-muted md:inline">
      Alt {toBengaliDigits(String(n))}
    </kbd>
  );
}

function FlowNavLink({
  companyId,
  link,
  active,
  onNavigate,
}: {
  companyId: string;
  link: FlowLink;
  active: boolean;
  onNavigate: (() => void) | undefined;
}) {
  return (
    <Link
      href={companyHref(companyId, link.path)}
      aria-current={active ? "page" : undefined}
      aria-keyshortcuts={link.shortcut ? `Alt+${link.shortcut}` : undefined}
      {...(onNavigate ? { onClick: onNavigate } : {})}
      className={`group relative flex min-h-9 items-center gap-2.5 rounded-lg px-3 text-[13.5px] transition-colors ${
        active
          ? "bg-brand/10 font-medium text-text"
          : "text-text-muted hover:bg-surface-hover hover:text-text"
      }`}
    >
      {active ? (
        <span aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-brand" />
      ) : null}
      <Icon
        name={sectionIcon(link.sectionId)}
        className={`size-4 ${active ? "text-brand" : "text-text-subtle group-hover:text-text-muted"}`}
      />
      <span className="truncate">{t(link.labelKey)}</span>
      {link.shortcut ? <ShortcutHint n={link.shortcut} /> : null}
    </Link>
  );
}

function Group({
  group,
  companyId,
  currentPath,
  onNavigate,
}: {
  group: FlowLinkGroup;
  companyId: string;
  currentPath: string;
  onNavigate: (() => void) | undefined;
}) {
  const links = (
    <ul className="flex flex-col gap-0.5">
      {group.links.map((link) => (
        <li key={link.path}>
          <FlowNavLink
            companyId={companyId}
            link={link}
            active={link.path === currentPath}
            onNavigate={onNavigate}
          />
        </li>
      ))}
    </ul>
  );
  const caption = "px-3 pb-1.5 text-[11px] font-semibold tracking-wider text-text-muted";

  if (!group.collapsed) {
    return (
      <div className="flex flex-col">
        <h2 className={caption}>{t(group.labelKey)}</h2>
        {links}
      </div>
    );
  }
  const holdsCurrent = group.links.some((l) => l.path === currentPath);
  return (
    <details className="group/details flex flex-col" open={holdsCurrent || undefined}>
      <summary
        className={`${caption} flex cursor-pointer list-none items-center gap-1 rounded-md pt-1 hover:text-text [&::-webkit-details-marker]:hidden`}
      >
        {t(group.labelKey)}
        <Icon
          name="chevronDown"
          className="size-3.5 -rotate-90 transition-transform group-open/details:rotate-0"
        />
      </summary>
      {links}
    </details>
  );
}

/**
 * The sidebar follows the work order of the workbook (`flowGroups`): today's overview, the day's
 * entries with their Alt shortcuts, checking, month end, then folded accounts, reports and setup.
 */
export function SideNav({
  workspace,
  currentPath,
  onNavigate,
  onSearch,
}: {
  workspace: CompanyWorkspace;
  currentPath: string;
  onNavigate?: () => void;
  onSearch?: () => void;
}) {
  const companyId = workspace.company.id;
  const groups = visibleFlow(workspace);
  const onDashboard = currentPath === "";

  return (
    <nav aria-label={t("nav.menu")} className="flex flex-col gap-5 px-3 py-4">
      <div className="flex flex-col gap-1.5">
        {onSearch ? (
          <button
            type="button"
            onClick={onSearch}
            aria-keyshortcuts="Control+K"
            className="flex min-h-9 items-center gap-2 rounded-lg border border-border bg-surface-muted px-3 text-[13px] text-text-muted transition-colors hover:border-border-strong hover:text-text"
          >
            <Icon name="search" className="size-4" />
            {t("nav.jump.open")}
            <kbd className="ml-auto hidden rounded border border-border bg-surface px-1.5 font-sans text-[10.5px] md:inline">
              Ctrl K
            </kbd>
          </button>
        ) : null}
        <Link
          href={companyHref(companyId)}
          aria-current={onDashboard ? "page" : undefined}
          {...(onNavigate ? { onClick: onNavigate } : {})}
          className={`flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-sm font-medium transition-colors ${
            onDashboard
              ? "bg-brand text-brand-foreground shadow-card"
              : "text-text hover:bg-surface-hover"
          }`}
        >
          <Icon name="dashboard" className="size-[18px]" />
          {t("nav.dashboard")}
        </Link>
      </div>

      {groups.map((group) => (
        <Group
          key={group.id}
          group={group}
          companyId={companyId}
          currentPath={currentPath}
          onNavigate={onNavigate}
        />
      ))}
    </nav>
  );
}
