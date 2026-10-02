"use client";

import type { Supplier } from "@bsd/contracts";
import { t } from "@bsd/i18n";
import { useId, useState } from "react";
import { Button } from "@/components/button";
import { Field, inputClass } from "@/components/field";
import { FormDialog } from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { ListSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { StatusField } from "@/components/status-field";
import { describeError, type DescribedError } from "@/data/ports/service-error";
import { useSaveSupplier, useSuppliers } from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";

const PATH = "masters/suppliers";

type Draft = { id?: string; name: string; phone: string; status: Supplier["status"] };

function SupplierDialog({
  companyId,
  draft,
  onClose,
}: {
  companyId: string;
  draft: Draft;
  onClose: () => void;
}) {
  const id = useId();
  const save = useSaveSupplier(companyId);
  const [values, setValues] = useState(draft);
  const [errors, setErrors] = useState<DescribedError>({ fields: {} });

  async function submit() {
    if (!values.name.trim()) {
      setErrors({ fields: { name: t("validation.required") } });
      return;
    }
    setErrors({ fields: {} });
    try {
      await save.mutateAsync({
        ...(values.id ? { supplierId: values.id } : {}),
        input: {
          name: values.name.trim(),
          ...(values.phone.trim() ? { phone: values.phone.trim() } : {}),
          status: values.status,
        },
      });
      onClose();
    } catch (error) {
      setErrors(describeError(error, ["name", "phone", "status"]));
    }
  }

  return (
    <FormDialog
      open
      title={t(values.id ? "supplier.form.editTitle" : "supplier.form.createTitle")}
      error={errors.form}
      pending={save.isPending}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <Field id={`${id}-name`} label={t("supplier.name")} error={errors.fields.name}>
        <input
          id={`${id}-name`}
          value={values.name}
          onChange={(event) => setValues({ ...values, name: event.target.value })}
          className={inputClass}
        />
      </Field>
      <Field id={`${id}-phone`} label={t("common.phone")} hint={t("common.optional")}>
        <input
          id={`${id}-phone`}
          type="tel"
          value={values.phone}
          onChange={(event) => setValues({ ...values, phone: event.target.value })}
          className={inputClass}
        />
      </Field>
      <StatusField
        id={`${id}-status`}
        value={values.status}
        onChange={(status) => setValues({ ...values, status })}
      />
    </FormDialog>
  );
}

function Suppliers() {
  const { company, permissions } = useCurrentWorkspace();
  const suppliers = useSuppliers(company.id);
  const canManage = permissions.includes("supplier.manage");
  const [draft, setDraft] = useState<Draft | null>(null);

  let body: React.ReactNode;
  if (suppliers.isPending) body = <ListSkeleton />;
  else if (suppliers.isError) {
    body = <QueryError error={suppliers.error} onRetry={() => void suppliers.refetch()} />;
  } else if (suppliers.data.length === 0) body = <StatePanel title={t("supplier.empty")} />;
  else {
    body = (
      <ul className="flex flex-col gap-2">
        {suppliers.data.map((s) => (
          <li
            key={s.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4"
          >
            <div>
              <div className="font-medium">{s.name}</div>
              <div className="text-sm text-text-muted">
                {s.phone ? `${s.phone} · ` : ""}
                <span className={s.status === "active" ? "text-success" : undefined}>
                  {t(`common.status.${s.status}`)}
                </span>
              </div>
            </div>
            {canManage ? (
              <Button
                onClick={() =>
                  setDraft({ id: s.id, name: s.name, phone: s.phone ?? "", status: s.status })
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
    <>
      <PageHeader
        title={t("nav.masters.suppliers")}
        actions={
          canManage ? (
            <Button
              variant="primary"
              onClick={() => setDraft({ name: "", phone: "", status: "active" })}
            >
              {t("supplier.new")}
            </Button>
          ) : null
        }
      />
      {draft ? (
        <SupplierDialog companyId={company.id} draft={draft} onClose={() => setDraft(null)} />
      ) : null}
      {body}
    </>
  );
}

export function SuppliersPage() {
  return (
    <NavGate path={PATH}>
      <Suppliers />
    </NavGate>
  );
}
