"use client";

import type { CompanyWorkspace } from "@bsd/contracts";
import { t, formatCount } from "@bsd/i18n";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { useOverflowTooltip } from "@/components/overflow-tooltip";
import { companyHref, hubOfPath, visibleHubs, type VisibleHub } from "./navigation";

export function ShortcutHint({ n }: { n: number }) {
  return (
    <kbd className="ml-auto hidden shrink-0 rounded border border-border bg-surface-muted px-1.5 font-sans text-[10.5px] text-text-muted md:inline">
      Alt {formatCount(n)}
    </kbd>
  );
}

function HubLink({
  companyId,
  hub,
  active,
  onNavigate,
}: {
  companyId: string;
  hub: VisibleHub;
  active: boolean;
  onNavigate: (() => void) | undefined;
}) {
  const label = t(hub.labelKey);
  const { textRef, rowProps, tooltip } = useOverflowTooltip<HTMLAnchorElement>(label);
  return (
    <Link
      href={companyHref(companyId, hub.path)}
      aria-current={active ? "page" : undefined}
      aria-keyshortcuts={`Alt+${hub.shortcut}`}
      {...rowProps}
      onClick={() => {
        rowProps.onPointerLeave();
        onNavigate?.();
      }}
      className={`group relative flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-sm transition-colors ${
        active
          ? "bg-brand/12 font-medium text-text"
          : "text-text-muted hover:bg-surface-hover hover:text-text"
      }`}
    >
      {active ? (
        <span aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-brand" />
      ) : null}
      <Icon
        name={hub.icon}
        className={`size-[18px] ${active ? "text-brand" : "text-text-subtle group-hover:text-text-muted"}`}
      />
      <span ref={textRef} className="min-w-0 truncate">
        {label}
      </span>
      <ShortcutHint n={hub.shortcut} />
      {tooltip}
    </Link>
  );
}

/**
 * The sidebar is the nine hubs (`hubs`), each linking to its first visible tab; the tabs of the
 * current hub are shown above the page by the shell. Alt+1…9 opens a hub.
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
  const currentHub = hubOfPath(currentPath)?.id;

  return (
    <nav aria-label={t("nav.menu")} className="flex flex-col gap-3 px-3 py-4">
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
      <ul className="flex flex-col gap-0.5">
        {visibleHubs(workspace).map((hub) => (
          <li key={hub.id}>
            <HubLink
              companyId={companyId}
              hub={hub}
              active={hub.id === currentHub}
              onNavigate={onNavigate}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}
