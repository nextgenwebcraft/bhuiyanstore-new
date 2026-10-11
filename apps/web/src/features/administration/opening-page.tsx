"use client";

import { t } from "@bsd/i18n";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { PageSkeleton } from "@/components/skeleton";
import { useOpening } from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";
import { companyHref } from "@/features/shell/navigation";
import { PrintButton, PrintHeader } from "@/features/shell/print";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { OPENING_PATH, OpeningCards } from "./opening-cards";
import { isSectionId } from "./opening-draft";
import { OpeningSectionForm } from "./opening-section-form";

/**
 * প্রারম্ভিক তথ্য (D43): cards for the sections; `?section=<id>` opens one section's form. Each
 * section saves on its own and is live at once; the page is read-only once a month is closed.
 */
function OpeningLoader() {
  const { company, permissions } = useCurrentWorkspace();
  const router = useRouter();
  const opening = useOpening(company.id);
  const params = useSearchParams();
  const requested = params.get("section");
  const saved = params.get("saved");
  if (opening.isPending) return <PageSkeleton tabs={4} />;
  if (opening.isError) {
    return (
      <>
        <PageHeader title={t("nav.administration.opening")} />
        <QueryError error={opening.error} onRetry={() => void opening.refetch()} />
      </>
    );
  }
  const view = opening.data;
  const canEdit = permissions.includes("opening.prepare");

  if (isSectionId(requested)) {
    return (
      <OpeningSectionForm
        key={`${requested}-${view.version}`}
        view={view}
        section={requested}
        canEdit={canEdit}
        onSaved={(section) =>
          router.push(companyHref(company.id, `${OPENING_PATH}?saved=${section}`))
        }
      />
    );
  }
  return (
    <>
      <PageHeader
        title={t("nav.administration.opening")}
        description={t("opening.description")}
        actions={<PrintButton />}
      />
      <PrintHeader title={t("nav.administration.opening")} from={view.cutoffDate ?? undefined} />
      <OpeningCards
        view={view}
        canEdit={canEdit}
        savedSection={isSectionId(saved) ? saved : null}
      />
    </>
  );
}

export function OpeningPage() {
  return (
    <NavGate path={OPENING_PATH}>
      <Suspense fallback={<PageSkeleton tabs={4} />}>
        <OpeningLoader />
      </Suspense>
    </NavGate>
  );
}
