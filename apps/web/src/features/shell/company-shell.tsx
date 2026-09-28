"use client";

import { themeToCssVars } from "@bsd/design-system";
import { t } from "@bsd/i18n";
import { usePathname } from "next/navigation";
import { ButtonLink } from "@/components/button";
import { ListSkeleton, Skeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { errorCodeOf } from "@/data/ports/service-error";
import { useWorkspace } from "@/data/queries";
import { DemoBar } from "@/demo/demo-bar";
import { CompanyMark } from "./company-mark";
import { CompanySwitcher } from "./company-switcher";
import { ConnectionBanner } from "./connection-banner";
import { DraftGuardProvider } from "./draft-guard";
import { MobileNav } from "./mobile-nav";
import { SideNav } from "./side-nav";
import { WorkspaceProvider } from "./workspace-context";

function subPath(pathname: string, companyId: string): string {
  const prefix = `/c/${companyId}`;
  return pathname.startsWith(prefix) ? pathname.slice(prefix.length).replace(/^\/+|\/+$/g, "") : "";
}

/**
 * Company workspace boundary. Mounted with `key={companyId}`, so switching company discards all
 * component state. Theme, permissions and navigation load before any company data renders
 * (guide section 4.2 step 5).
 */
export function CompanyShell({
  companyId,
  children,
}: {
  companyId: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const currentPath = subPath(pathname, companyId);
  const workspace = useWorkspace(companyId);

  if (workspace.isPending) {
    return (
      <div className="min-h-dvh">
        <DemoBar />
        <div className="flex h-16 items-center gap-3 border-b border-border bg-surface px-4">
          <Skeleton className="size-9" />
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="mx-auto max-w-5xl p-4 sm:p-8">
          <ListSkeleton />
        </div>
      </div>
    );
  }

  if (workspace.isError) {
    const code = errorCodeOf(workspace.error);
    return (
      <div className="min-h-dvh">
        <DemoBar />
        <main className="mx-auto max-w-2xl p-4 sm:p-8">
          <StatePanel
            tone="error"
            title={t(`error.${code}`)}
            action={
              <ButtonLink href="/" variant="secondary">
                {t("state.backToCompanies")}
              </ButtonLink>
            }
          />
        </main>
      </div>
    );
  }

  const { company } = workspace.data;

  return (
    <WorkspaceProvider value={workspace.data}>
      <DraftGuardProvider>
        <div style={themeToCssVars(company.theme) as React.CSSProperties} className="min-h-dvh">
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:z-10 focus:bg-surface focus:p-2"
          >
            {t("app.skipToContent")}
          </a>
          <DemoBar />
          <header className="sticky top-0 z-20 flex min-h-16 items-center gap-3 bg-brand px-4 text-brand-foreground">
            <MobileNav workspace={workspace.data} currentPath={currentPath} />
            <CompanyMark company={company} />
            <span className="min-w-0 flex-1 truncate text-lg font-semibold">{company.name}</span>
            <CompanySwitcher currentCompanyId={company.id} currentPath={currentPath} />
          </header>
          <ConnectionBanner />
          <div className="flex">
            <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-64 shrink-0 overflow-y-auto border-r border-border bg-surface md:block">
              <SideNav workspace={workspace.data} currentPath={currentPath} />
            </aside>
            <main id="main" className="min-w-0 flex-1 p-4 sm:p-8">
              {children}
            </main>
          </div>
        </div>
      </DraftGuardProvider>
    </WorkspaceProvider>
  );
}
