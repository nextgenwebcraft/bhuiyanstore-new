"use client";

import { t } from "@bsd/i18n";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/button";
import { Icon } from "@/components/icons";
import { ListSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { useSession } from "@/data/http/http-provider";
import { errorCodeOf } from "@/data/ports/service-error";
import { useWorkspaces } from "@/data/queries";
import { TopBar } from "@/features/shell/top-bar";
import { CompanyMark } from "@/features/shell/company-mark";
import { ConnectionBanner } from "@/features/shell/connection-banner";
import { companyHref } from "@/features/shell/navigation";
import { CompanyForm } from "./company-form";

export function CompanyPickerPage() {
  const workspaces = useWorkspaces();
  const session = useSession();
  const canCreate = session?.me.isSuperAdmin === true;
  const [creating, setCreating] = useState(false);

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
    body = <StatePanel title={t(canCreate ? "company.noneYet" : "company.none")} />;
  } else {
    body = (
      <ul className="grid gap-3 sm:grid-cols-2">
        {workspaces.data.map(({ company }) => (
          <li key={company.id}>
            <Link
              href={companyHref(company.id)}
              className="group flex min-h-20 items-center gap-4 rounded-xl border border-border bg-surface p-4 shadow-card transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow-raised"
            >
              <CompanyMark company={company} size="lg" />
              <span className="min-w-0 flex-1 truncate text-base font-semibold">
                {company.name}
              </span>
              <Icon
                name="arrowRight"
                className="size-4 text-text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-text-muted"
              />
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-border bg-canvas/80 px-4 backdrop-blur-md sm:px-8">
        <span className="text-sm font-semibold tracking-tight">{t("app.name")}</span>
        <TopBar />
      </header>
      <ConnectionBanner />
      <main id="main" className="mx-auto flex max-w-3xl flex-col gap-6 p-4 sm:p-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">{t("company.choose")}</h1>
            <p className="mt-1 text-sm text-text-muted">{t("company.chooseHint")}</p>
          </div>
          {canCreate ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Icon name="plus" className="size-4" />
              {t("company.new")}
            </Button>
          ) : null}
        </header>
        {creating ? <CompanyForm onClose={() => setCreating(false)} /> : null}
        {body}
      </main>
    </div>
  );
}
