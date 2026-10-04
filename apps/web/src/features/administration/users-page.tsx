"use client";

import type { MembershipInput, Role, User } from "@bsd/contracts";
import { t } from "@bsd/i18n";
import { useId, useState } from "react";
import { Button } from "@/components/button";
import { Field, inputClass } from "@/components/field";
import { FormDialog } from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { ListSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { describeError, type DescribedError } from "@/data/ports/service-error";
import {
  useCreateUser,
  useResetUserPassword,
  useRoles,
  useUpdateUser,
  useUsers,
  useWorkspaces,
} from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";

const PATH = "admin/users";
const MIN_PASSWORD = 12;
const noErrors: DescribedError = { fields: {} };

type Company = { id: string; name: string };

/** One row per company: include it, then pick at least one role there. */
function MembershipsEditor({
  companies,
  roles,
  value,
  error,
  onChange,
}: {
  companies: Company[];
  roles: Role[];
  value: MembershipInput[];
  error?: string | undefined;
  onChange: (memberships: MembershipInput[]) => void;
}) {
  const byCompany = new Map(value.map((m) => [m.companyId, m.roleIds]));

  function setRoles(companyId: string, roleIds: string[] | null) {
    const others = value.filter((m) => m.companyId !== companyId);
    onChange(roleIds === null ? others : [...others, { companyId, roleIds }]);
  }

  return (
    <fieldset className="flex max-h-[40dvh] flex-col gap-3 overflow-y-auto">
      <legend className="mb-2 text-sm font-medium">{t("user.memberships")}</legend>
      {companies.map((company) => {
        const roleIds = byCompany.get(company.id);
        return (
          <div key={company.id} className="rounded-md border border-border p-3">
            <label className="flex min-h-(--touch-target) items-center gap-2 font-medium">
              <input
                type="checkbox"
                checked={roleIds !== undefined}
                onChange={(event) => setRoles(company.id, event.target.checked ? [] : null)}
              />
              {company.name}
            </label>
            {roleIds !== undefined ? (
              <div className="mt-2 grid gap-1 pl-6 sm:grid-cols-2">
                {roles.map((role) => (
                  <label key={role.id} className="flex min-h-(--touch-target) items-center gap-2">
                    <input
                      type="checkbox"
                      checked={roleIds.includes(role.id)}
                      onChange={(event) =>
                        setRoles(
                          company.id,
                          event.target.checked
                            ? [...roleIds, role.id]
                            : roleIds.filter((r) => r !== role.id),
                        )
                      }
                    />
                    {role.name}
                  </label>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
      {error ? (
        <p className="text-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

const missingRole = (memberships: MembershipInput[]) =>
  memberships.some((m) => m.roleIds.length === 0);

type UserDraft = { user?: User };

function UserDialog({
  draft,
  companies,
  roles,
  onClose,
}: {
  draft: UserDraft;
  companies: Company[];
  roles: Role[];
  onClose: () => void;
}) {
  const id = useId();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const editing = draft.user;
  const [name, setName] = useState(editing?.name ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [active, setActive] = useState(editing?.active ?? true);
  const [memberships, setMemberships] = useState<MembershipInput[]>(editing?.memberships ?? []);
  const [errors, setErrors] = useState(noErrors);

  async function submit() {
    const fields: Partial<Record<string, string>> = {};
    if (!name.trim()) fields.name = t("validation.required");
    if (!editing) {
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) fields.email = t("validation.email");
      if (password.length < MIN_PASSWORD) fields.password = t("auth.passwordTooShort");
    }
    if (missingRole(memberships)) fields.memberships = t("validation.membership.roleRequired");
    if (Object.keys(fields).length > 0) {
      setErrors({ fields });
      return;
    }
    setErrors(noErrors);
    try {
      if (editing) {
        await updateUser.mutateAsync({
          userId: editing.id,
          input: { name: name.trim(), active, memberships },
        });
      } else {
        await createUser.mutateAsync({
          name: name.trim(),
          email: email.trim(),
          password,
          memberships,
        });
      }
      onClose();
    } catch (error) {
      setErrors(describeError(error, ["name", "email", "password", "active", "memberships"]));
    }
  }

  return (
    <FormDialog
      open
      wide
      title={t(editing ? "user.form.editTitle" : "user.form.createTitle")}
      error={errors.form}
      pending={createUser.isPending || updateUser.isPending}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <Field id={`${id}-name`} label={t("common.name")} error={errors.fields.name}>
        <input
          id={`${id}-name`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={inputClass}
        />
      </Field>
      {editing ? (
        <p className="text-sm text-text-muted">{editing.email}</p>
      ) : (
        <>
          <Field id={`${id}-email`} label={t("auth.email")} error={errors.fields.email}>
            <input
              id={`${id}-email`}
              type="email"
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field
            id={`${id}-password`}
            label={t("user.temporaryPassword")}
            hint={t("user.temporaryPasswordHint")}
            error={errors.fields.password}
          >
            <input
              id={`${id}-password`}
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={inputClass}
            />
          </Field>
        </>
      )}
      {editing ? (
        <div>
          <label className="flex min-h-(--touch-target) items-center gap-2 font-medium">
            <input
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
            />
            {t("user.active")}
          </label>
          <p className="text-sm text-text-muted">{t("user.activeHint")}</p>
          {errors.fields.active ? (
            <p className="text-sm text-error" role="alert">
              {errors.fields.active}
            </p>
          ) : null}
        </div>
      ) : null}
      <MembershipsEditor
        companies={companies}
        roles={roles}
        value={memberships}
        error={errors.fields.memberships}
        onChange={setMemberships}
      />
    </FormDialog>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: User; onClose: () => void }) {
  const id = useId();
  const reset = useResetUserPassword();
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState(noErrors);

  async function submit() {
    if (password.length < MIN_PASSWORD) {
      setErrors({ fields: { password: t("auth.passwordTooShort") } });
      return;
    }
    setErrors(noErrors);
    try {
      await reset.mutateAsync({ userId: user.id, input: { password } });
      onClose();
    } catch (error) {
      setErrors(describeError(error, ["password"]));
    }
  }

  return (
    <FormDialog
      open
      title={t("user.resetTitle")}
      error={errors.form}
      pending={reset.isPending}
      submitLabel={t("user.resetPassword")}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <p className="font-medium">
        {user.name} <span className="text-text-muted">({user.email})</span>
      </p>
      <p className="text-sm text-text-muted">{t("user.resetHint")}</p>
      <Field
        id={`${id}-password`}
        label={t("user.temporaryPassword")}
        hint={t("user.temporaryPasswordHint")}
        error={errors.fields.password}
      >
        <input
          id={`${id}-password`}
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={inputClass}
        />
      </Field>
    </FormDialog>
  );
}

/** Users, their company memberships and roles (guide 12.2). Super-admin only for now. */
function Users() {
  const users = useUsers();
  const roles = useRoles();
  const workspaces = useWorkspaces();
  const [draft, setDraft] = useState<UserDraft | null>(null);
  const [resetting, setResetting] = useState<User | null>(null);

  const companies: Company[] = (workspaces.data ?? []).map((w) => ({
    id: w.company.id,
    name: w.company.name,
  }));
  const roleList = roles.data ?? [];
  const companyName = (id: string) => companies.find((c) => c.id === id)?.name ?? "";
  const roleName = (id: string) => roleList.find((r) => r.id === id)?.name ?? "";

  let body: React.ReactNode;
  if (users.isPending || roles.isPending) body = <ListSkeleton rows={4} detail action />;
  else if (users.isError) {
    body = <QueryError error={users.error} onRetry={() => void users.refetch()} />;
  } else if (roles.isError) {
    body = <QueryError error={roles.error} onRetry={() => void roles.refetch()} />;
  } else if (users.data.length === 0) body = <StatePanel title={t("user.empty")} />;
  else {
    body = (
      <ul className="flex flex-col gap-2">
        {users.data.map((user) => (
          <li key={user.id} className="rounded-lg border border-border bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-medium">{user.name}</div>
                <div className="text-sm text-text-muted">{user.email}</div>
                <div className="mt-1 flex flex-wrap gap-2 text-sm">
                  <span className={user.active ? "text-success" : "text-text-muted"}>
                    {t(user.active ? "user.active" : "user.inactive")}
                  </span>
                  {user.isSuperAdmin ? <span>· {t("user.superAdmin")}</span> : null}
                  {user.mustChangePassword ? (
                    <span className="text-text-muted">· {t("user.mustChange")}</span>
                  ) : null}
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => setResetting(user)}>{t("user.resetPassword")}</Button>
                <Button onClick={() => setDraft({ user })}>{t("common.edit")}</Button>
              </div>
            </div>
            <ul className="mt-2 text-sm">
              {user.memberships.length === 0 && !user.isSuperAdmin ? (
                <li className="text-text-muted">{t("user.noAccess")}</li>
              ) : null}
              {user.memberships.map((m) => (
                <li key={m.companyId}>
                  <span className="font-medium">{companyName(m.companyId)}</span>:{" "}
                  {m.roleIds.map(roleName).join(", ")}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <>
      <PageHeader
        title={t("nav.administration.users")}
        description={t("common.superAdminOnly")}
        actions={
          <Button variant="primary" onClick={() => setDraft({})}>
            {t("user.new")}
          </Button>
        }
      />
      {draft ? (
        <UserDialog
          draft={draft}
          companies={companies}
          roles={roleList}
          onClose={() => setDraft(null)}
        />
      ) : null}
      {resetting ? (
        <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />
      ) : null}
      {body}
    </>
  );
}

export function UsersPage() {
  return (
    <NavGate path={PATH}>
      <Users />
    </NavGate>
  );
}
