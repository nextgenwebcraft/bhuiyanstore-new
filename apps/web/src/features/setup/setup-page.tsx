"use client";

import type { SetupStatus, SetupStepId } from "@bsd/contracts";
import { formatAmount, t, toBengaliDigits, type TranslationKey } from "@bsd/i18n";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { ListSkeleton } from "@/components/skeleton";
import { useSetupStatus } from "@/data/queries";
import { companyHref } from "@/features/shell/navigation";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";

const PATH = "admin/setup";

/** Where each step is done; opening steps land on their tab's screen. */
const stepPath: Record<SetupStepId, string> = {
  company: "",
  products: "masters/cartons",
  staff: "masters/staff",
  openingStock: "admin/opening?tab=stock",
  supplierOpening: "admin/opening?tab=company",
  staffOpening: "admin/opening?tab=staff",
  shops: "sales/shops",
  businessOpening: "admin/opening?tab=cash",
  activate: "admin/opening?tab=review",
};

const pathOf = (step: SetupStatus["steps"][number]) =>
  step.id === "staffOpening" && step.missing.some((m) => m.code === "setup.missing.noStaff")
    ? stepPath.staff
    : stepPath[step.id];

function ProgressBar({ status }: { status: SetupStatus }) {
  const total = status.steps.length;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{t("setup.progress")}</span>
        <span className="text-text-muted tabular-nums">
          {toBengaliDigits(String(status.completed))}/{toBengaliDigits(String(total))}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={status.completed}
        className="h-2.5 overflow-hidden rounded-full bg-surface-muted"
      >
        <div
          className="h-full rounded-full bg-brand transition-[width]"
          style={{ width: `${(status.completed / total) * 100}%` }}
        />
      </div>
    </div>
  );
}

function Steps({ status, companyId }: { status: SetupStatus; companyId: string }) {
  return (
    <ol className="flex flex-col gap-3">
      {status.steps.map((step, index) => (
        <li key={step.id}>
          <Link
            href={companyHref(companyId, pathOf(step))}
            className={`group flex gap-3 rounded-xl border bg-surface p-4 shadow-card transition-colors hover:border-brand/40 ${
              step.complete ? "border-success/30" : "border-border"
            }`}
          >
            <span
              aria-hidden
              className={`grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold ${
                step.complete ? "bg-success text-surface" : "bg-surface-muted text-text-muted"
              }`}
            >
              {step.complete ? (
                <Icon name="check" className="size-4" />
              ) : (
                toBengaliDigits(String(index + 1))
              )}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{t(`setup.step.${step.id}`)}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    step.complete ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
                  }`}
                >
                  {step.complete ? t("setup.complete") : t("setup.incomplete")}
                </span>
              </div>
              <p className="text-sm text-text-muted">{t(`setup.hint.${step.id}`)}</p>
              {step.missing.length > 0 ? (
                <ul className="mt-1 flex flex-col gap-0.5 text-sm text-warning">
                  {step.missing.map((m) => (
                    <li key={m.code}>
                      {t(m.code as TranslationKey)}
                      {m.count !== null ? ` (${formatAmount(String(m.count))})` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <Icon
              name="arrowRight"
              className="size-4 self-center text-text-subtle transition-colors group-hover:text-brand"
            />
          </Link>
        </li>
      ))}
    </ol>
  );
}

function Setup() {
  const { company } = useCurrentWorkspace();
  const status = useSetupStatus(company.id);
  let body: React.ReactNode;
  if (status.isPending) body = <ListSkeleton rows={9} detail />;
  else if (status.isError) {
    body = <QueryError error={status.error} onRetry={() => void status.refetch()} />;
  } else {
    body = (
      <div className="flex max-w-3xl flex-col gap-6">
        <ProgressBar status={status.data} />
        {status.data.ready ? (
          <div className="flex items-center gap-3 rounded-xl border border-success/40 bg-success/10 px-5 py-4 text-lg font-semibold text-success">
            <Icon name="check" className="size-6" />
            {t("setup.ready")}
          </div>
        ) : null}
        <Steps status={status.data} companyId={company.id} />
      </div>
    );
  }
  return (
    <>
      <PageHeader title={t("nav.administration.setup")} description={t("setup.description")} />
      {body}
    </>
  );
}

export function SetupPage() {
  return (
    <NavGate path={PATH}>
      <Setup />
    </NavGate>
  );
}

/**
 * Where an owner should go next before go-live: the checklist while any step before activation
 * is open, otherwise the opening's review tab to approve and activate. Null once the opening is
 * active or for users who cannot prepare it.
 */
export function useSetupNext(): { href: string; label: TranslationKey } | null {
  const { company, permissions } = useCurrentWorkspace();
  const canPrepare = permissions.includes("opening.prepare");
  const status = useSetupStatus(company.id, canPrepare);
  if (!canPrepare || status.data?.openingStatus === "active") return null;
  const onlyActivation =
    status.data?.steps.every((s) => s.complete || s.id === "activate") === true;
  return onlyActivation
    ? { href: companyHref(company.id, "admin/opening?tab=review"), label: "setup.next.activate" }
    : { href: companyHref(company.id, PATH), label: "setup.next.checklist" };
}

/** Dashboard banner until the opening is active; hidden when the status cannot be read. */
export function SetupBanner() {
  const { company } = useCurrentWorkspace();
  const status = useSetupStatus(company.id);
  const next = useSetupNext();
  if (!next || !status.data) return null;
  const onlyActivation = next.label === "setup.next.activate";
  return (
    <Link
      href={next.href}
      className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm transition-colors hover:border-warning"
    >
      <Icon name="arrowRight" className="size-4 text-warning" />
      <span className="flex-1 font-medium">
        {onlyActivation ? t("setup.bannerActivate") : t("setup.banner")}
      </span>
      <span className="text-text-muted tabular-nums">
        {toBengaliDigits(String(status.data.completed))}/
        {toBengaliDigits(String(status.data.steps.length))}
      </span>
    </Link>
  );
}
