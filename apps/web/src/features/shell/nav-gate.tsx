"use client";

import { t } from "@bsd/i18n";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatePanel } from "@/components/state-panel";
import { companyHref, findNavEntry, navAccess, type NavSection } from "./navigation";
import { useCurrentWorkspace } from "./workspace-context";

function ModuleBreadcrumb({ companyId, section }: { companyId: string; section: NavSection }) {
  if (section.id === "dashboard") return null;
  return (
    <Link
      href={companyHref(companyId, section.id)}
      className="mb-4 inline-block text-sm text-text-muted hover:underline"
    >
      ← {t(section.labelKey)}
    </Link>
  );
}

/**
 * Presentation guard for a navigable screen: unavailable module, forbidden and not-yet-built
 * states (guide section 5.5), plus a link back to the module's card grid. The service enforces
 * the access rules independently.
 */
export function NavGate({ path, children }: { path: string; children?: React.ReactNode }) {
  const workspace = useCurrentWorkspace();
  const entry = findNavEntry(path);
  if (!entry) notFound();

  const access = navAccess(workspace, entry.section, entry.item);
  const companyId = workspace.company.id;

  if (access === "moduleUnavailable") {
    return (
      <>
        <ModuleBreadcrumb companyId={companyId} section={entry.section} />
        <StatePanel
          tone="warning"
          title={t("state.moduleUnavailableTitle")}
          hint={t("state.moduleUnavailableHint")}
        />
      </>
    );
  }
  if (access === "forbidden") {
    return (
      <>
        <ModuleBreadcrumb companyId={companyId} section={entry.section} />
        <StatePanel
          tone="warning"
          title={t("state.forbiddenTitle")}
          hint={t("state.forbiddenHint")}
        />
      </>
    );
  }
  if (!entry.item.implemented) {
    return (
      <>
        <ModuleBreadcrumb companyId={companyId} section={entry.section} />
        <h1 className="mb-6 text-2xl font-semibold">{t(entry.item.labelKey)}</h1>
        <StatePanel title={t("state.notBuiltTitle")} hint={t("state.notBuiltHint")} />
      </>
    );
  }
  return (
    <>
      <ModuleBreadcrumb companyId={companyId} section={entry.section} />
      {children}
    </>
  );
}
