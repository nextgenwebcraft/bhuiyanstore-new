"use client";

import { isFieldOnly, type CompanyWorkspace } from "@bsd/contracts";
import { themeToCssVars } from "@bsd/design-system";
import { t } from "@bsd/i18n";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { ButtonLink } from "@/components/button";
import { Icon } from "@/components/icons";
import { NavSkeleton, PageSkeleton, Skeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { errorCodeOf } from "@/data/ports/service-error";
import { useWorkspace } from "@/data/queries";
import { TopBar } from "./top-bar";
import { CompanyMark } from "./company-mark";
import { CompanySwitcher } from "./company-switcher";
import { ConnectionBanner } from "./connection-banner";
import { DraftGuardProvider } from "./draft-guard";
import { MobileNav } from "./mobile-nav";
import { NavProgress } from "./nav-progress";
import { companyHref, FIELD_PATH } from "./navigation";
import { NotificationBell, NotificationsProvider } from "./notifications";
import { QuickJump, type QuickJumpHandle } from "./quick-jump";
import { SideNav } from "./side-nav";
import { WorkspaceProvider } from "./workspace-context";

function subPath(pathname: string, companyId: string): string {
  const prefix = `/c/${companyId}`;
  return pathname.startsWith(prefix) ? pathname.slice(prefix.length).replace(/^\/+|\/+$/g, "") : "";
}

/**
 * A DSR holding only field permissions sees the phone panel alone (D40): no navigation, and any
 * other company path is sent to it. The API refuses office routes independently.
 */
function FieldShell({
  workspace,
  currentPath,
  children,
}: {
  workspace: CompanyWorkspace;
  currentPath: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { company } = workspace;
  const onField = currentPath === FIELD_PATH;
  useEffect(() => {
    if (!onField) router.replace(companyHref(company.id, FIELD_PATH));
  }, [onField, router, company.id]);

  return (
    <WorkspaceProvider value={workspace}>
      <DraftGuardProvider>
        <NotificationsProvider>
          <div style={themeToCssVars(company.theme) as React.CSSProperties} className="min-h-dvh">
            <NavProgress />
            <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-canvas/80 px-3 backdrop-blur-md">
              <CompanyMark company={company} size="sm" />
              <span className="min-w-0 flex-1 truncate font-semibold">{company.name}</span>
              <TopBar />
            </header>
            <ConnectionBanner />
            <main id="main" className="mx-auto w-full max-w-xl p-3 pb-16">
              {onField ? children : <PageSkeleton />}
            </main>
          </div>
        </NotificationsProvider>
      </DraftGuardProvider>
    </WorkspaceProvider>
  );
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
  const jumpRef = useRef<QuickJumpHandle>(null);
  const openSearch = () => jumpRef.current?.open();

  if (workspace.isPending) {
    return (
      <div className="min-h-dvh">
        <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col gap-4 border-r border-border bg-surface/85 p-4 md:flex">
          <div className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-lg" />
            <Skeleton className="h-5 w-32" />
          </div>
          <Skeleton className="h-9 w-full" />
          <NavSkeleton />
        </aside>
        <div className="md:pl-64">
          <div className="h-16 border-b border-border" />
          <div className="mx-auto max-w-400 p-4 sm:p-6">
            <PageSkeleton />
          </div>
        </div>
      </div>
    );
  }

  if (workspace.isError) {
    const code = errorCodeOf(workspace.error);
    return (
      <div className="min-h-dvh">
        <header className="flex h-16 items-center justify-end border-b border-border px-4 sm:px-8">
          <TopBar />
        </header>
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

  if (isFieldOnly(workspace.data.permissions)) {
    return (
      <FieldShell workspace={workspace.data} currentPath={currentPath}>
        {children}
      </FieldShell>
    );
  }

  return (
    <WorkspaceProvider value={workspace.data}>
      <DraftGuardProvider>
        <NotificationsProvider>
          <div style={themeToCssVars(company.theme) as React.CSSProperties} className="min-h-dvh">
            <NavProgress />
            <a
              href="#main"
              className="sr-only focus:not-sr-only focus:absolute focus:z-10 focus:bg-surface focus:p-2"
            >
              {t("app.skipToContent")}
            </a>
            <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-surface/85 backdrop-blur-xl md:flex">
              <span
                aria-hidden
                className="h-0.5 bg-linear-to-r from-brand via-brand/50 to-transparent"
              />
              <div className="flex h-16 shrink-0 items-center px-2.5">
                <CompanySwitcher company={company} currentPath={currentPath} />
              </div>
              <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto">
                <SideNav
                  workspace={workspace.data}
                  currentPath={currentPath}
                  onSearch={openSearch}
                />
              </div>
            </aside>
            <div className="md:pl-64">
              <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-canvas/80 px-4 backdrop-blur-md sm:px-8">
                <MobileNav
                  workspace={workspace.data}
                  currentPath={currentPath}
                  onSearch={openSearch}
                />
                <div className="flex min-w-0 flex-1 items-center gap-2 md:hidden">
                  <CompanyMark company={company} size="sm" />
                  <span className="truncate font-semibold">{company.name}</span>
                </div>
                <div className="hidden flex-1 md:block" />
                <button
                  type="button"
                  onClick={openSearch}
                  aria-label={t("nav.jump.open")}
                  className="inline-flex size-10 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-hover hover:text-text md:hidden"
                >
                  <Icon name="search" />
                </button>
                <NotificationBell />
                <TopBar />
              </header>
              <ConnectionBanner />
              <main id="main" className="mx-auto w-full max-w-400 p-4 pb-24 sm:p-6 md:pb-6">
                <div key={currentPath} className="animate-page-in">
                  {children}
                </div>
              </main>
              <QuickJump ref={jumpRef} workspace={workspace.data} />
            </div>
          </div>
        </NotificationsProvider>
      </DraftGuardProvider>
    </WorkspaceProvider>
  );
}
