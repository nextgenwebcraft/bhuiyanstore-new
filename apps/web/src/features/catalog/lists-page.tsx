"use client";

import { staffRoleKinds } from "@bsd/contracts";
import { t, type TranslationKey } from "@bsd/i18n";
import { useId, useState } from "react";
import { Button } from "@/components/button";
import { Field, inputClass } from "@/components/field";
import { FormDialog } from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { ListSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { StatusField, statusOf } from "@/components/status-field";
import { useSession } from "@/data/http/http-provider";
import type { ConfigListId, ConfigLists } from "@/data/ports/distribution-service";
import { describeError, type DescribedError } from "@/data/ports/service-error";
import { useConfigList, useSaveConfig } from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";

const PATH = "masters/lists";

type KindOption = { value: string; labelKey: TranslationKey };

type ListSpec = { titleKey: TranslationKey; hintKey?: TranslationKey; kinds?: KindOption[] };

const specs: { [K in ConfigListId]: ListSpec } = {
  staffRoles: {
    titleKey: "settings.staffRoles",
    hintKey: "settings.staffRolesHint",
    kinds: staffRoleKinds.map((kind) => ({ value: kind, labelKey: `staff.kind.${kind}` })),
  },
  expenseCategories: { titleKey: "settings.expenseCategories" },
};

type Item = { id: string; name: string; active: boolean; kind?: string };
type Draft = { id?: string; name: string; kind: string; active: boolean };

function ItemDialog<K extends ConfigListId>({
  list,
  draft,
  onClose,
}: {
  list: K;
  draft: Draft;
  onClose: () => void;
}) {
  const id = useId();
  const { kinds } = specs[list];
  const save = useSaveConfig(list);
  const [values, setValues] = useState(draft);
  const [errors, setErrors] = useState<DescribedError>({ fields: {} });

  async function submit() {
    if (!values.name.trim()) {
      setErrors({ fields: { name: t("validation.required") } });
      return;
    }
    setErrors({ fields: {} });
    // Lists with a kind get it; the request schemas own which lists have one.
    const input = {
      name: values.name.trim(),
      active: values.active,
      ...(kinds ? { kind: values.kind } : {}),
    } as ConfigLists[K]["input"];
    try {
      await save.mutateAsync({ ...(values.id ? { id: values.id } : {}), input });
      onClose();
    } catch (error) {
      setErrors(describeError(error, ["name", "kind"]));
    }
  }

  return (
    <FormDialog
      open
      title={t(values.id ? "settings.editTitle" : "settings.createTitle")}
      error={errors.form}
      pending={save.isPending}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <Field id={`${id}-name`} label={t("common.name")} error={errors.fields.name}>
        <input
          id={`${id}-name`}
          value={values.name}
          onChange={(event) => setValues({ ...values, name: event.target.value })}
          className={inputClass}
        />
      </Field>
      {kinds ? (
        <Field id={`${id}-kind`} label={t("common.kind")} error={errors.fields.kind}>
          <select
            id={`${id}-kind`}
            value={values.kind}
            onChange={(event) => setValues({ ...values, kind: event.target.value })}
            className={inputClass}
          >
            {kinds.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {t(kind.labelKey)}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <StatusField
        id={`${id}-status`}
        value={statusOf(values.active)}
        onChange={(status) => setValues({ ...values, active: status === "active" })}
      />
    </FormDialog>
  );
}

function ListSection<K extends ConfigListId>({ list, canEdit }: { list: K; canEdit: boolean }) {
  const { titleKey, hintKey, kinds } = specs[list];
  const items = useConfigList(list);
  const [draft, setDraft] = useState<Draft | null>(null);
  const kindLabel = (value: string | undefined) => {
    const option = kinds?.find((kind) => kind.value === value);
    return option ? t(option.labelKey) : null;
  };

  let body: React.ReactNode;
  if (items.isPending) body = <ListSkeleton rows={4} action />;
  else if (items.isError) {
    body = <QueryError error={items.error} onRetry={() => void items.refetch()} />;
  } else if (items.data.length === 0) body = <StatePanel title={t("settings.empty")} />;
  else {
    body = (
      <ul className="flex flex-col gap-2">
        {(items.data as Item[]).map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3"
          >
            <div>
              <div className="font-medium">{item.name}</div>
              <div className="text-sm text-text-muted">
                {kindLabel(item.kind) ? `${kindLabel(item.kind)} · ` : ""}
                <span className={item.active ? "text-success" : undefined}>
                  {t(`common.status.${statusOf(item.active)}`)}
                </span>
              </div>
            </div>
            {canEdit ? (
              <Button
                onClick={() =>
                  setDraft({
                    id: item.id,
                    name: item.name,
                    kind: item.kind ?? "",
                    active: item.active,
                  })
                }
              >
                {t("common.edit")}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t(titleKey)}</h2>
          {hintKey ? <p className="text-sm text-text-muted">{t(hintKey)}</p> : null}
        </div>
        {canEdit ? (
          <Button
            onClick={() => setDraft({ name: "", kind: kinds?.[0]?.value ?? "", active: true })}
          >
            {t("common.add")}
          </Button>
        ) : null}
      </div>
      {body}
      {draft ? <ItemDialog list={list} draft={draft} onClose={() => setDraft(null)} /> : null}
    </section>
  );
}

/** Tenant lists (guide 4.4): staff roles and expense categories. */
function Lists() {
  const session = useSession();
  const canEdit = session?.me.isSuperAdmin === true;
  return (
    <>
      <PageHeader
        title={t("nav.masters.lists")}
        {...(canEdit ? {} : { description: t("common.superAdminOnly") })}
      />
      <div className="flex flex-col gap-8">
        <ListSection list="staffRoles" canEdit={canEdit} />
        <ListSection list="expenseCategories" canEdit={canEdit} />{" "}
      </div>
    </>
  );
}

export function ListsPage() {
  return (
    <NavGate path={PATH}>
      <Lists />
    </NavGate>
  );
}
