"use client";

import { t } from "@bsd/i18n";
import Link from "next/link";
import { Button } from "@/components/button";
import { ListSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { errorCodeOf } from "@/data/ports/service-error";
import { useWorkspaces } from "@/data/queries";
import { DemoBar } from "@/demo/demo-bar";
import { CompanyMark } from "@/features/shell/company-mark";
import { ConnectionBanner } from "@/features/shell/connection-banner";
import { companyHref } from "@/features/shell/navigation";

export function CompanyPickerPage() {
  const workspaces = useWorkspaces();

  let body: React.ReactNode;
  if (workspaces.isPending) {
    body = <ListSkeleton rows={3} />;
  } else if (workspaces.isError) {
    body = (
      <StatePanel
        tone="error"
        title={t(`error.${errorCodeOf(workspaces.error)}`)}
        action={<Button onClick={() => void workspaces.refetch()}>{t("state.retry")}</Button>}
      />
    );
  } else if (workspaces.data.length === 0) {
    body = <StatePanel title={t("company.none")} />;
  } else {
    body = (
      <ul className="grid gap-3 sm:grid-cols-2">
        {workspaces.data.map(({ company }) => (
          <li key={company.id}>
            <Link
              href={companyHref(company.id)}
              style={{ borderLeftColor: company.theme.primary }}
              className="flex min-h-20 items-center gap-4 rounded-lg border border-l-8 border-border bg-surface p-4 hover:bg-surface-muted"
            >
              <CompanyMark company={company} size="lg" />
              <span className="text-lg font-semibold">{company.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="min-h-dvh">
      <DemoBar />
      <ConnectionBanner />
      <main id="main" className="mx-auto flex max-w-3xl flex-col gap-6 p-4 sm:p-8">
        <header>
          <p className="text-sm text-text-muted">{t("app.name")}</p>
          <h1 className="text-2xl font-semibold">{t("company.choose")}</h1>
          <p className="mt-1 text-text-muted">{t("company.chooseHint")}</p>
        </header>
        {body}
      </main>
    </div>
  );
}
