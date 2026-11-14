"use client";

import type { OrderTarget, OrderTargetKind } from "@bsd/contracts";
import { formatBusinessDate, normalizeDigits, t } from "@bsd/i18n";
import { useId, useState } from "react";
import { Button } from "@/components/button";
import { DatePicker } from "@/components/date-picker";
import { Field, inputClass } from "@/components/field";
import { FormDialog } from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { TableSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { describeError, type DescribedError } from "@/data/ports/service-error";
import {
  useArchiveOrderTarget,
  useOrderTargets,
  useProducts,
  useSaveOrderTarget,
} from "@/data/queries";
import { clean } from "@/features/daily/daily-kit";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { useToday } from "@/lib/today";
import { TargetProgressBlock, targetLabel } from "./target-progress";

const PATH = "masters/targets";
const MAX_DASHBOARD_PINS = 2;
const noErrors: DescribedError = { fields: {} };

type ProductScope = "single" | "multi";

type Draft = {
  id?: string;
  kind: OrderTargetKind;
  productScope: ProductScope;
  productIds: string[];
  amount: string;
  quantityCartons: string;
  startDate: string;
  endDate: string;
  showOnDashboard: boolean;
};

function emptyDraft(today: string): Draft {
  return {
    kind: "overall",
    productScope: "single",
    productIds: [],
    amount: "",
    quantityCartons: "",
    startDate: today,
    endDate: today,
    showOnDashboard: false,
  };
}

function draftFrom(target: OrderTarget): Draft {
  return {
    id: target.id,
    kind: target.kind,
    productScope: target.products.length > 1 ? "multi" : "single",
    productIds: target.products.map((p) => p.id),
    amount: target.amount ?? "",
    quantityCartons: target.quantityCartons ?? "",
    startDate: target.startDate,
    endDate: target.endDate,
    showOnDashboard: target.showOnDashboard,
  };
}

function TargetDialog({
  companyId,
  draft,
  pinnedCount,
  onClose,
}: {
  companyId: string;
  draft: Draft;
  pinnedCount: number;
  onClose: () => void;
}) {
  const id = useId();
  const save = useSaveOrderTarget(companyId);
  const products = useProducts(companyId);
  const [values, setValues] = useState(draft);
  const [errors, setErrors] = useState(noErrors);
  const set = (patch: Partial<Draft>) => setValues({ ...values, ...patch });

  const alreadyPinned = Boolean(draft.id && draft.showOnDashboard);
  const pinBlocked = !alreadyPinned && pinnedCount >= MAX_DASHBOARD_PINS;

  function toggleProduct(productId: string, checked: boolean) {
    const next = checked
      ? [...values.productIds, productId]
      : values.productIds.filter((id) => id !== productId);
    set({ productIds: next });
  }

  async function submit() {
    const amount = clean(values.amount);
    const cartons = clean(values.quantityCartons);
    const fields: Partial<Record<string, string>> = {};
    if (!values.startDate) fields.startDate = t("validation.required");
    if (!values.endDate) fields.endDate = t("validation.required");
    if (values.startDate && values.endDate && values.startDate > values.endDate) {
      fields.endDate = t("validation.target.dateOrder");
    }
    if (values.kind === "overall") {
      if (!amount || !/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
        fields.amount = t("validation.target.amount");
      }
    } else {
      if (!cartons || !/^\d+(\.\d{1,2})?$/.test(cartons) || Number(cartons) <= 0) {
        fields.quantityCartons = t("validation.target.cartons");
      }
      if (values.productScope === "single") {
        if (values.productIds.length !== 1) {
          fields.productIds = t("validation.target.productRequired");
        }
      } else if (values.productIds.length < 2) {
        fields.productIds = t("validation.target.productsRequired");
      }
    }
    if (values.showOnDashboard && pinBlocked) {
      fields.showOnDashboard = t("validation.target.dashboardFull");
    }
    if (Object.keys(fields).length > 0) {
      setErrors({ fields });
      return;
    }
    setErrors(noErrors);
    try {
      await save.mutateAsync({
        ...(values.id ? { targetId: values.id } : {}),
        input: {
          kind: values.kind,
          productIds: values.kind === "product" ? values.productIds : [],
          amount: values.kind === "overall" ? amount : null,
          quantityCartons: values.kind === "product" ? cartons : null,
          startDate: values.startDate,
          endDate: values.endDate,
          showOnDashboard: values.showOnDashboard,
        },
      });
      onClose();
    } catch (error) {
      setErrors(
        describeError(error, [
          "kind",
          "productIds",
          "amount",
          "quantityCartons",
          "startDate",
          "endDate",
          "showOnDashboard",
        ]),
      );
    }
  }

  const activeProducts = products.data?.filter((p) => p.status === "active") ?? [];

  return (
    <FormDialog
      open
      wide
      title={t(values.id ? "target.form.editTitle" : "target.form.createTitle")}
      error={errors.form}
      pending={save.isPending}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <fieldset className="flex flex-wrap gap-4">
        <legend className="mb-1 text-sm font-medium">{t("target.kind")}</legend>
        {(["overall", "product"] as const).map((kind) => (
          <label key={kind} className="flex min-h-(--touch-target) items-center gap-2 text-sm">
            <input
              type="radio"
              name={`${id}-kind`}
              checked={values.kind === kind}
              onChange={() =>
                set({
                  kind,
                  productIds: kind === "overall" ? [] : values.productIds,
                  amount: kind === "overall" ? values.amount : "",
                  quantityCartons: kind === "product" ? values.quantityCartons : "",
                })
              }
            />
            {kind === "overall" ? t("target.kind.overall") : t("target.kind.product")}
          </label>
        ))}
      </fieldset>
      {values.kind === "product" ? (
        <>
          <fieldset className="flex flex-wrap gap-4">
            <legend className="mb-1 text-sm font-medium">{t("target.productScope")}</legend>
            {(["single", "multi"] as const).map((scope) => (
              <label
                key={scope}
                className="flex min-h-(--touch-target) items-center gap-2 text-sm"
              >
                <input
                  type="radio"
                  name={`${id}-scope`}
                  checked={values.productScope === scope}
                  onChange={() =>
                    set({
                      productScope: scope,
                      productIds:
                        scope === "single" ? values.productIds.slice(0, 1) : values.productIds,
                    })
                  }
                />
                {t(`target.productScope.${scope}`)}
              </label>
            ))}
          </fieldset>
          {values.productScope === "single" ? (
            <Field
              id={`${id}-product`}
              label={t("target.product")}
              error={errors.fields.productIds}
            >
              <select
                id={`${id}-product`}
                value={values.productIds[0] ?? ""}
                onChange={(event) =>
                  set({ productIds: event.target.value ? [event.target.value] : [] })
                }
                className={inputClass}
              >
                <option value="">{t("common.select")}</option>
                {activeProducts.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} ({product.sku})
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <fieldset>
              <legend className="mb-2 text-sm font-medium">{t("target.products")}</legend>
              {errors.fields.productIds ? (
                <p className="mb-2 text-sm text-error" role="alert">
                  {errors.fields.productIds}
                </p>
              ) : null}
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                {activeProducts.length === 0 ? (
                  <p className="text-sm text-text-muted">{t("target.productsEmpty")}</p>
                ) : (
                  activeProducts.map((product) => (
                    <label
                      key={product.id}
                      className="flex min-h-(--touch-target) items-center gap-2 rounded-md px-2 text-sm hover:bg-surface-muted"
                    >
                      <input
                        type="checkbox"
                        checked={values.productIds.includes(product.id)}
                        onChange={(event) => toggleProduct(product.id, event.target.checked)}
                      />
                      <span>
                        {product.name}{" "}
                        <span className="text-text-muted">({product.sku})</span>
                      </span>
                    </label>
                  ))
                )}
              </div>
            </fieldset>
          )}
          <Field
            id={`${id}-cartons`}
            label={t("target.cartons")}
            error={errors.fields.quantityCartons}
          >
            <input
              id={`${id}-cartons`}
              inputMode="decimal"
              value={values.quantityCartons}
              onChange={(event) => set({ quantityCartons: normalizeDigits(event.target.value) })}
              className={inputClass}
            />
          </Field>
        </>
      ) : (
        <Field id={`${id}-amount`} label={t("target.amount")} error={errors.fields.amount}>
          <input
            id={`${id}-amount`}
            inputMode="decimal"
            value={values.amount}
            onChange={(event) => set({ amount: normalizeDigits(event.target.value) })}
            className={inputClass}
          />
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${id}-start`} label={t("target.startDate")} error={errors.fields.startDate}>
          <DatePicker
            id={`${id}-start`}
            value={values.startDate}
            label={t("target.startDate")}
            onChange={(startDate) => set({ startDate })}
          />
        </Field>
        <Field id={`${id}-end`} label={t("target.endDate")} error={errors.fields.endDate}>
          <DatePicker
            id={`${id}-end`}
            value={values.endDate}
            label={t("target.endDate")}
            onChange={(endDate) => set({ endDate })}
          />
        </Field>
      </div>
      <label className="flex min-h-(--touch-target) items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={values.showOnDashboard}
          disabled={pinBlocked && !values.showOnDashboard}
          onChange={(event) => set({ showOnDashboard: event.target.checked })}
        />
        <span>
          {t("target.showOnDashboard")}
          {pinBlocked ? (
            <span className="mt-1 block text-text-muted">{t("target.dashboardFullHint")}</span>
          ) : null}
          {errors.fields.showOnDashboard ? (
            <span className="mt-1 block text-error" role="alert">
              {errors.fields.showOnDashboard}
            </span>
          ) : null}
        </span>
      </label>
    </FormDialog>
  );
}

function ArchiveDialog({
  companyId,
  target,
  onClose,
}: {
  companyId: string;
  target: OrderTarget;
  onClose: () => void;
}) {
  const archive = useArchiveOrderTarget(companyId);
  const [error, setError] = useState<string | undefined>();

  async function submit() {
    setError(undefined);
    try {
      await archive.mutateAsync(target.id);
      onClose();
    } catch (failure) {
      setError(describeError(failure, []).form);
    }
  }

  return (
    <FormDialog
      open
      title={t("target.archive.title")}
      error={error}
      pending={archive.isPending}
      submitLabel={t("target.archive.confirm")}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <p className="text-sm text-text-muted">
        {t("target.archive.hint").replace("{name}", targetLabel(target))}
      </p>
    </FormDialog>
  );
}

function TargetCard({
  companyId,
  target,
  canManage,
  pinnedCount,
  onEdit,
  onArchive,
}: {
  companyId: string;
  target: OrderTarget;
  canManage: boolean;
  pinnedCount: number;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const save = useSaveOrderTarget(companyId);
  const [pinError, setPinError] = useState<string | undefined>();
  const pinBlocked = !target.showOnDashboard && pinnedCount >= MAX_DASHBOARD_PINS;

  async function togglePin(checked: boolean) {
    if (checked && pinBlocked) {
      setPinError(t("validation.target.dashboardFull"));
      return;
    }
    setPinError(undefined);
    try {
      await save.mutateAsync({
        targetId: target.id,
        input: {
          kind: target.kind,
          productIds: target.products.map((p) => p.id),
          amount: target.kind === "overall" ? target.amount : null,
          quantityCartons: target.kind === "product" ? target.quantityCartons : null,
          startDate: target.startDate,
          endDate: target.endDate,
          showOnDashboard: checked,
        },
      });
    } catch (error) {
      setPinError(
        describeError(error, ["showOnDashboard"]).fields.showOnDashboard ??
          describeError(error, []).form,
      );
    }
  }

  return (
    <li className="rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-text">{targetLabel(target)}</h3>
          <p className="text-sm text-text-muted">
            {formatBusinessDate(target.startDate)} – {formatBusinessDate(target.endDate)}
          </p>
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={onEdit}>
              {t("common.edit")}
            </Button>
            <Button type="button" variant="secondary" onClick={onArchive}>
              {t("target.archive.action")}
            </Button>
          </div>
        ) : null}
      </div>
      <TargetProgressBlock target={target} />
      {canManage ? (
        <label className="mt-4 flex min-h-(--touch-target) items-start gap-2 border-t border-border pt-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={target.showOnDashboard}
            disabled={save.isPending || (pinBlocked && !target.showOnDashboard)}
            onChange={(event) => void togglePin(event.target.checked)}
          />
          <span>
            {t("target.showOnDashboard")}
            {pinBlocked && !target.showOnDashboard ? (
              <span className="mt-1 block text-text-muted">{t("target.dashboardFullHint")}</span>
            ) : null}
            {pinError ? (
              <span className="mt-1 block text-error" role="alert">
                {pinError}
              </span>
            ) : null}
          </span>
        </label>
      ) : target.showOnDashboard ? (
        <p className="mt-4 border-t border-border pt-3 text-sm text-text-muted">
          {t("target.onDashboard")}
        </p>
      ) : null}
    </li>
  );
}

function TargetsBody() {
  const { company, permissions } = useCurrentWorkspace();
  const today = useToday();
  const targets = useOrderTargets(company.id, false);
  const canManage = permissions.includes("company.manage");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [archiveOf, setArchiveOf] = useState<OrderTarget | null>(null);

  let body: React.ReactNode;
  if (targets.isPending) body = <TableSkeleton rows={4} columns={3} />;
  else if (targets.isError) {
    body = <QueryError error={targets.error} onRetry={() => void targets.refetch()} />;
  } else if (targets.data.items.length === 0) {
    body = canManage ? (
      <StatePanel title={t("target.empty")} hint={t("target.emptyHint")} />
    ) : (
      <StatePanel title={t("target.empty")} />
    );
  } else {
    const pinnedCount = targets.data.dashboardPinned;
    body = (
      <ul className="grid gap-4 lg:grid-cols-2">
        {targets.data.items.map((target) => (
          <TargetCard
            key={target.id}
            companyId={company.id}
            target={target}
            canManage={canManage}
            pinnedCount={pinnedCount}
            onEdit={() => setDraft(draftFrom(target))}
            onArchive={() => setArchiveOf(target)}
          />
        ))}
      </ul>
    );
  }

  return (
    <>
      <PageHeader
        title={t("nav.masters.targets")}
        description={t("target.description")}
        actions={
          canManage ? (
            <Button type="button" variant="primary" onClick={() => setDraft(emptyDraft(today))}>
              {t("target.create")}
            </Button>
          ) : null
        }
      />
      {draft ? (
        <TargetDialog
          companyId={company.id}
          draft={draft}
          pinnedCount={targets.data?.dashboardPinned ?? 0}
          onClose={() => setDraft(null)}
        />
      ) : null}
      {archiveOf ? (
        <ArchiveDialog
          companyId={company.id}
          target={archiveOf}
          onClose={() => setArchiveOf(null)}
        />
      ) : null}
      {body}
    </>
  );
}

export function TargetsPage() {
  return (
    <NavGate path={PATH}>
      <TargetsBody />
    </NavGate>
  );
}
