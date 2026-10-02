"use client";

import { permissionIds, type PermissionId, type Role } from "@bsd/contracts";
import { t, toBengaliDigits } from "@bsd/i18n";
import { useId, useState } from "react";
import { Button } from "@/components/button";
import { Field, inputClass } from "@/components/field";
import { FormDialog } from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { ListSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { describeError, type DescribedError } from "@/data/ports/service-error";
import { useRoles, useSaveRole } from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";

const PATH = "admin/roles";

/** Permissions grouped by their resource prefix ("sale.view" → "sale"), in canonical order. */
const permissionGroups: PermissionId[][] = Object.values(
  permissionIds.reduce<Record<string, PermissionId[]>>((groups, permission) => {
    const prefix = permission.split(".")[0] ?? permission;
    (groups[prefix] ??= []).push(permission);
    return groups;
  }, {}),
);

type Draft = { id?: string; name: string; permissions: PermissionId[] };

function RoleDialog({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const id = useId();
  const save = useSaveRole();
  const [values, setValues] = useState(draft);
  const [errors, setErrors] = useState<DescribedError>({ fields: {} });
  const selected = new Set(values.permissions);

  function toggle(permission: PermissionId) {
    const next = new Set(selected);
    if (next.has(permission)) next.delete(permission);
    else next.add(permission);
    // Canonical order keeps saved roles stable and diffs in the audit log readable.
    setValues({ ...values, permissions: permissionIds.filter((p) => next.has(p)) });
  }

  async function submit() {
    if (!values.name.trim()) {
      setErrors({ fields: { name: t("validation.required") } });
      return;
    }
    setErrors({ fields: {} });
    try {
      await save.mutateAsync({
        ...(values.id ? { roleId: values.id } : {}),
        input: { name: values.name.trim(), permissions: values.permissions },
      });
      onClose();
    } catch (error) {
      setErrors(describeError(error, ["name"]));
    }
  }

  return (
    <FormDialog
      open
      wide
      title={t(values.id ? "role.form.editTitle" : "role.form.createTitle")}
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
      <fieldset className="flex max-h-[50dvh] flex-col gap-3 overflow-y-auto">
        <legend className="mb-2 text-sm font-medium">
          {t("role.permissions")} ({toBengaliDigits(String(values.permissions.length))})
        </legend>
        {permissionGroups.map((group) => (
          <div key={group[0]} className="grid gap-1 border-t border-border pt-2 sm:grid-cols-2">
            {group.map((permission) => (
              <label key={permission} className="flex min-h-(--touch-target) items-center gap-2">
                <input
                  type="checkbox"
                  checked={selected.has(permission)}
                  onChange={() => toggle(permission)}
                />
                <span>{t(`permission.${permission}`)}</span>
              </label>
            ))}
          </div>
        ))}
      </fieldset>
    </FormDialog>
  );
}

/** Roles are named sets of fixed permission IDs (guide 12.2). Super-admin only for now. */
function Roles() {
  const roles = useRoles();
  const [draft, setDraft] = useState<Draft | null>(null);

  const edit = (role: Role) =>
    setDraft({ id: role.id, name: role.name, permissions: role.permissions });

  let body: React.ReactNode;
  if (roles.isPending) body = <ListSkeleton />;
  else if (roles.isError) {
    body = <QueryError error={roles.error} onRetry={() => void roles.refetch()} />;
  } else if (roles.data.length === 0) body = <StatePanel title={t("role.empty")} />;
  else {
    body = (
      <ul className="flex flex-col gap-2">
        {roles.data.map((role) => (
          <li
            key={role.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4"
          >
            <div>
              <div className="font-medium">{role.name}</div>
              <div className="text-sm text-text-muted">
                {toBengaliDigits(String(role.permissions.length))} {t("role.permissionCount")}
              </div>
            </div>
            <Button onClick={() => edit(role)}>{t("common.edit")}</Button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <>
      <PageHeader
        title={t("nav.administration.roles")}
        description={t("common.superAdminOnly")}
        actions={
          <Button variant="primary" onClick={() => setDraft({ name: "", permissions: [] })}>
            {t("role.new")}
          </Button>
        }
      />
      {draft ? <RoleDialog draft={draft} onClose={() => setDraft(null)} /> : null}
      {body}
    </>
  );
}

export function RolesPage() {
  return (
    <NavGate path={PATH}>
      <Roles />
    </NavGate>
  );
}
