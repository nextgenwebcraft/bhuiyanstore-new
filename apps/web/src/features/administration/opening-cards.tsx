"use client";

import type { Opening, OpeningSectionId, OpeningSectionSummary, SetupStatus } from "@bsd/contracts";
import { t, type TranslationKey, formatAmount, formatBusinessDate, formatCount } from "@bsd/i18n";
import Link from "next/link";
import { useId, useState } from "react";
import { Button } from "@/components/button";
import { DatePicker } from "@/components/date-picker";
import { Field } from "@/components/field";
import { Icon } from "@/components/icons";
import { StatePanel } from "@/components/state-panel";
import { StatusBadge } from "@/components/status-badge";
import { describeError } from "@/data/ports/service-error";
import { useSaveOpeningCutoff, useSetupStatus } from "@/data/queries";
import { companyHref } from "@/features/shell/navigation";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";

export const OPENING_PATH = "admin/opening";

export const sectionHref = (companyId: string, section: OpeningSectionId) =>
  companyHref(companyId, `${OPENING_PATH}?section=${section}`);

const STATE_BADGE = {
  done: { tone: "success", key: "opening.state.done" },
  pending: { tone: "error", key: "opening.state.pending" },
  optional: { tone: "muted", key: "opening.state.optional" },
} as const;

const AMOUNT_LABEL = {
  total: undefined,
  owesUs: "opening.staff.owesUs",
  weOwe: "opening.staff.weOwe",
} as const satisfies Record<
  OpeningSectionSummary["amounts"][number]["key"],
  TranslationKey | undefined
>;

/** What the opening needs from other screens first, and where each is fixed. */
const PREREQUISITES = [
  { step: "products", path: "masters/products" },
  { step: "staff", path: "masters/staff" },
  { step: "shops", path: "sales/shops" },
] as const;

function Prerequisites({ status, companyId }: { status: SetupStatus; companyId: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">{t("opening.prerequisites")}</h2>
      <ul className="grid gap-3 md:grid-cols-3">
        {PREREQUISITES.map(({ step, path }) => {
          const item = status.steps.find((s) => s.id === step);
          if (!item) return null;
          return (
            <li key={step}>
              <Link
                href={companyHref(companyId, path)}
                className={`flex h-full flex-col gap-1.5 rounded-xl border bg-surface p-3 shadow-card transition-colors hover:border-brand/40 ${
                  item.complete ? "border-success/30" : "border-border"
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{t(`setup.step.${step}`)}</span>
                  <StatusBadge tone={item.complete ? "success" : "error"}>
                    {t(item.complete ? "opening.state.done" : "opening.state.pending")}
                  </StatusBadge>
                </span>
                {item.missing.map((m) => (
                  <span key={m.code} className="text-xs text-warning">
                    {t(m.code as TranslationKey)}
                    {m.count !== null ? ` (${formatCount(m.count)})` : ""}
                  </span>
                ))}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The go-live date saves on its own; once any entry exists it can no longer move. */
function CutoffField({ view, canEdit }: { view: Opening; canEdit: boolean }) {
  const id = useId();
  const { company } = useCurrentWorkspace();
  const save = useSaveOpeningCutoff(company.id);
  const [value, setValue] = useState(view.cutoffDate ?? "");
  const [error, setError] = useState<string | undefined>();
  const editable = canEdit && view.cutoffEditable;

  async function submit() {
    setError(undefined);
    try {
      await save.mutateAsync({ version: view.version, cutoffDate: value });
    } catch (e) {
      setError(describeError(e, []).form);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-72 max-w-full">
        <Field
          id={`${id}-cutoff`}
          label={t("opening.cutoffDate")}
          hint={editable ? t("opening.cutoffHint") : t("opening.cutoffFixed")}
          error={error}
        >
          <DatePicker
            id={`${id}-cutoff`}
            value={value}
            disabled={!editable}
            label={t("opening.cutoffDate")}
            onChange={setValue}
            className="w-full"
          />
        </Field>
      </div>
      {editable ? (
        <Button
          variant="primary"
          disabled={value === "" || value === (view.cutoffDate ?? "") || save.isPending}
          onClick={() => void submit()}
        >
          {save.isPending ? t("common.saving") : t("common.save")}
        </Button>
      ) : null}
    </div>
  );
}

function SectionCard({
  summary,
  companyId,
  hint,
}: {
  summary: OpeningSectionSummary;
  companyId: string;
  hint: string;
}) {
  const badge = STATE_BADGE[summary.state];
  return (
    <li>
      <Link
        href={sectionHref(companyId, summary.section)}
        className="group flex h-full flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-card transition-all hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-raised"
      >
        <span className="flex items-start justify-between gap-2">
          <span className="font-medium">{t(`opening.tab.${summary.section}`)}</span>
          <StatusBadge tone={badge.tone}>{t(badge.key)}</StatusBadge>
        </span>
        <span className="text-sm text-text-muted">{hint}</span>
        <span className="mt-auto flex items-end justify-between gap-2 pt-1">
          <span className="flex flex-col gap-0.5 text-sm tabular-nums">
            {summary.amounts.map((a) => {
              const label = AMOUNT_LABEL[a.key];
              return (
                <span key={a.key}>
                  {label ? <span className="text-text-muted">{t(label)}: </span> : null}
                  <span className="font-semibold">{formatAmount(a.value)}</span>
                </span>
              );
            })}
            <span className="text-xs text-text-subtle">
              {t("opening.card.entered")}: {formatCount(summary.entered)} /{" "}
              {formatCount(summary.total)}
            </span>
          </span>
          <Icon
            name="arrowRight"
            className="size-4 text-text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-text-muted"
          />
        </span>
      </Link>
    </li>
  );
}

/** The opening as cards: cutoff date, what it needs first, then one card per section. */
export function OpeningCards({
  view,
  canEdit,
  savedSection,
}: {
  view: Opening;
  canEdit: boolean;
  /** The section just saved, for the confirmation line. */
  savedSection: OpeningSectionId | null;
}) {
  const { company } = useCurrentWorkspace();
  const status = useSetupStatus(company.id);
  return (
    <div className="flex flex-col gap-5">
      {view.locked ? <StatePanel tone="warning" title={t("opening.lockedHint")} /> : null}
      {savedSection ? (
        <StatePanel title={`${t("opening.saved")}: ${t(`opening.tab.${savedSection}`)}`} />
      ) : null}
      <p className="rounded-lg bg-surface-muted px-3 py-2 text-sm">{t("opening.guide")}</p>
      <CutoffField key={view.version} view={view} canEdit={canEdit && !view.locked} />
      {view.cutoffDate ? (
        <p className="text-sm text-text-muted">
          {t("opening.liveFrom")} {formatBusinessDate(view.cutoffDate)}
        </p>
      ) : (
        <StatePanel tone="warning" title={t("opening.notLive")} hint={t("opening.notLiveHint")} />
      )}
      {status.data ? <Prerequisites status={status.data} companyId={company.id} /> : null}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">{t("opening.sections")}</h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {view.sections.map((summary) => (
            <SectionCard
              key={summary.section}
              summary={summary}
              companyId={company.id}
              hint={t(`opening.tabHint.${summary.section}`)}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}
