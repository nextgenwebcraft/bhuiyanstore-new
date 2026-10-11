"use client";

import type { Opening, OpeningBalanceSectionId, OpeningSectionId } from "@bsd/contracts";
import { t } from "@bsd/i18n";
import { useState } from "react";
import { Button, ButtonLink } from "@/components/button";
import { PageHeader } from "@/components/page-header";
import { StatePanel } from "@/components/state-panel";
import { describeError } from "@/data/ports/service-error";
import { useConfigList, useSaveOpeningSection, useShops, useStaff } from "@/data/queries";
import { useRegisterDraftGuard } from "@/features/shell/draft-guard";
import { companyHref } from "@/features/shell/navigation";
import { PrintButton, PrintHeader } from "@/features/shell/print";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import {
  balanceRowsOf,
  blankStock,
  draftOf,
  isSectionDirty,
  piecesOf,
  sectionRequestOf,
  type BalanceDraft,
  type Draft,
  type Party,
  type StockField,
} from "./opening-draft";
import { OPENING_PATH } from "./opening-cards";
import { BalanceTable, StockTable } from "./opening-tables";

const EMPTY_TEXT = {
  shopDue: "opening.shops.empty",
  staff: "opening.staff.empty",
  cash: "opening.cash.empty",
} as const;

/** One section's form: edits stay local until Save, which sends this section only (D43). */
export function OpeningSectionForm({
  view,
  section,
  canEdit,
  onSaved,
}: {
  view: Opening;
  section: OpeningSectionId;
  canEdit: boolean;
  onSaved: (section: OpeningSectionId) => void;
}) {
  const { company } = useCurrentWorkspace();
  const staff = useStaff(company.id);
  const shops = useShops(company.id);
  const accounts = useConfigList("cashAccounts");
  const save = useSaveOpeningSection(company.id);
  const [draft, setDraft] = useState<Draft>(() => draftOf(view));
  const [error, setError] = useState<string | undefined>();

  const locked = view.locked || !canEdit;
  const dirty = isSectionDirty(view, draft, section);
  const stockInvalid =
    section === "stock" &&
    view.stock.some((l) => piecesOf(l, draft.stock[l.productId]) === "invalid");

  async function submit(): Promise<boolean> {
    setError(undefined);
    try {
      await save.mutateAsync(sectionRequestOf(view, draft, section));
      onSaved(section);
      return true;
    } catch (e) {
      setError(describeError(e, []).form);
      return false;
    }
  }

  useRegisterDraftGuard(
    dirty && !locked ? { save: submit, discard: () => setDraft(draftOf(view)) } : null,
  );

  const members = staff.data ?? [];
  const staffName = new Map(members.map((m) => [m.id, m.name]));
  const accountName = new Map((accounts.data ?? []).map((a) => [a.id, a.name]));
  const shopName = new Map((shops.data ?? []).map((s) => [s.id, s.name]));
  const nameOf = (p: Party) =>
    (p.shopId
      ? shopName.get(p.shopId)
      : p.staffId
        ? staffName.get(p.staffId)
        : p.cashAccountId
          ? accountName.get(p.cashAccountId)
          : "") ?? "—";

  const setStock = (productId: string, field: StockField | "note", value: string) =>
    setDraft((d) => ({
      ...d,
      stock: { ...d.stock, [productId]: { ...(d.stock[productId] ?? blankStock), [field]: value } },
    }));
  const setBalance = (key: string, field: keyof BalanceDraft, value: string) =>
    setDraft((d) => ({
      ...d,
      balances: {
        ...d.balances,
        [key]: { ...(d.balances[key] ?? { amount: "", note: "" }), [field]: value },
      },
    }));

  const rows =
    section === "stock"
      ? []
      : balanceRowsOf(section as OpeningBalanceSectionId, view, {
          members,
          shops: shops.data ?? [],
          cashAccounts: (accounts.data ?? []).filter((a) => a.active),
          nameOf,
        });
  const emptyKey = EMPTY_TEXT[section as keyof typeof EMPTY_TEXT];

  let body: React.ReactNode;
  if (section === "stock") {
    body = <StockTable view={view} draft={draft} locked={locked} onChange={setStock} />;
  } else if (rows.length === 0 && emptyKey) {
    body = <StatePanel title={t(emptyKey)} />;
  } else {
    body = (
      <BalanceTable rows={rows} view={view} draft={draft} locked={locked} onChange={setBalance} />
    );
  }

  return (
    <>
      <PageHeader
        title={t(`opening.tab.${section}`)}
        description={t(`opening.tabHint.${section}`)}
        actions={
          <>
            <ButtonLink href={companyHref(company.id, OPENING_PATH)}>
              {t("opening.back")}
            </ButtonLink>
            {!locked ? (
              <Button
                variant="primary"
                disabled={!dirty || stockInvalid || save.isPending}
                onClick={() => void submit()}
              >
                {save.isPending ? t("common.saving") : t("common.save")}
              </Button>
            ) : null}
            <PrintButton />
          </>
        }
      />
      <PrintHeader title={t(`opening.tab.${section}`)} from={view.cutoffDate ?? undefined} />
      <div className="flex flex-col gap-3">
        {view.locked ? <StatePanel tone="warning" title={t("opening.lockedHint")} /> : null}
        {error ? <StatePanel tone="error" title={error} /> : null}
        {dirty && !locked ? <StatePanel tone="warning" title={t("opening.unsaved")} /> : null}
        {stockInvalid ? <StatePanel tone="error" title={t("opening.cartonsInvalid")} /> : null}
        {body}
      </div>
    </>
  );
}
