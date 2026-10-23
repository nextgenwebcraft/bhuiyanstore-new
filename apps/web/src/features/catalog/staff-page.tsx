"use client";

import {
  masterPanelHireRole,
  MIN_PASSWORD_LENGTH,
  staffEmployers,
  type StaffAssignment,
  type StaffEmployer,
  type StaffRecord,
  type RecordStatus,
  type StaffRole,
} from "@bsd/contracts";
import { todayBusinessDate } from "@bsd/domain";
import { formatAmount, normalizeDigits, t, toBengaliDigits } from "@bsd/i18n";
import { useId, useState } from "react";
import { Button } from "@/components/button";
import { DatePicker } from "@/components/date-picker";
import { DeleteButton } from "@/components/delete-button";
import { Field, inputClass } from "@/components/field";
import { FormDialog } from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { ListSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { StatusField } from "@/components/status-field";
import { useSession } from "@/data/http/http-provider";
import { describeError, type DescribedError } from "@/data/ports/service-error";
import {
  useAllStaff,
  useConfigList,
  useCreateStaff,
  useCreateStaffLogin,
  useDeleteStaff,
  useSaveStaffAssignment,
  useStaffRecords,
  useUpdateStaff,
  useWorkspaces,
} from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";

const PATH = "masters/staff";

const noErrors: DescribedError = { fields: {} };

/** SRs are supplier-employed and DSRs distributor-employed (D02, D23); other roles fit both. */
function fitsEmployer(role: StaffRole, employer: StaffEmployer): boolean {
  if (role.kind === "sr") return employer === "supplier";
  if (role.kind === "dsr") return employer === "distributor";
  return true;
}

type Period = { roleId: string; from: string; to: string; monthlySalary: string };

const newPeriod = (): Period => ({
  roleId: "",
  from: todayBusinessDate(),
  to: "",
  monthlySalary: "",
});

/** Role + from/to, shared by "new person" and the assignment dialog. */
function PeriodFields({
  id,
  period,
  roles,
  employer,
  errors,
  pathPrefix,
  onChange,
  dates = true,
  salaryHint = true,
}: {
  id: string;
  period: Period;
  roles: StaffRole[];
  employer: StaffEmployer;
  errors: DescribedError;
  pathPrefix: string;
  onChange: (period: Period) => void;
  /** Hidden on the master hire form; the server stores the entry date (D80). */
  dates?: boolean;
  salaryHint?: boolean;
}) {
  const options = roles.filter(
    (role) => (role.active && fitsEmployer(role, employer)) || role.id === period.roleId,
  );
  const isSr = roles.find((role) => role.id === period.roleId)?.kind === "sr";
  return (
    <>
      <Field id={`${id}-role`} label={t("staff.role")} error={errors.fields[`${pathPrefix}roleId`]}>
        <select
          id={`${id}-role`}
          value={period.roleId}
          onChange={(event) => onChange({ ...period, roleId: event.target.value })}
          className={inputClass}
        >
          <option value="">{t("common.select")}</option>
          {options.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name} ({t(`staff.kind.${role.kind}`)})
            </option>
          ))}
        </select>
      </Field>
      {options.length === 0 ? (
        <p className="text-sm text-text-muted">{t("staff.noRoles")}</p>
      ) : null}
      {dates ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            id={`${id}-from`}
            label={t("common.from")}
            error={errors.fields[`${pathPrefix}from`]}
          >
            <DatePicker
              id={`${id}-from`}
              value={period.from}
              label={t("common.from")}
              onChange={(from) => onChange({ ...period, from })}
              className="w-full"
            />
          </Field>
          <Field
            id={`${id}-to`}
            label={t("common.to")}
            hint={t("staff.assignment.endHint")}
            error={errors.fields[`${pathPrefix}to`]}
          >
            <DatePicker
              id={`${id}-to`}
              value={period.to}
              clearable
              min={period.from || undefined}
              label={t("common.to")}
              onChange={(to) => onChange({ ...period, to })}
              className="w-full"
            />
          </Field>
        </div>
      ) : null}
      {isSr ? null : (
        <Field
          id={`${id}-salary`}
          label={t("staff.monthlySalary")}
          hint={salaryHint ? t("staff.monthlySalaryHint") : undefined}
          error={errors.fields[`${pathPrefix}monthlySalary`]}
        >
          <input
            id={`${id}-salary`}
            inputMode="decimal"
            value={period.monthlySalary}
            onChange={(event) => onChange({ ...period, monthlySalary: event.target.value })}
            className={inputClass}
          />
        </Field>
      )}
    </>
  );
}

function checkPeriod(period: Period, pathPrefix: string): DescribedError | null {
  const fields: Partial<Record<string, string>> = {};
  if (!period.roleId) fields[`${pathPrefix}roleId`] = t("validation.required");
  if (!period.from) fields[`${pathPrefix}from`] = t("validation.required");
  if (period.to && period.from && period.to < period.from) {
    fields[`${pathPrefix}to`] = t("validation.period.endBeforeStart");
  }
  const salary = normalizeDigits(period.monthlySalary).trim();
  if (salary && !/^\d+(\.\d{1,2})?$/.test(salary)) {
    fields[`${pathPrefix}monthlySalary`] = t("validation.opening.amount");
  }
  return Object.keys(fields).length > 0 ? { fields } : null;
}

const periodInput = (period: Period, roles: StaffRole[]) => {
  const salary = normalizeDigits(period.monthlySalary).trim();
  const isSr = roles.find((role) => role.id === period.roleId)?.kind === "sr";
  return {
    roleId: period.roleId,
    from: period.from,
    to: period.to || null,
    monthlySalary: salary && !isSr ? salary : null,
  };
};

export type PersonDraft = {
  id?: string;
  name: string;
  phone?: string;
  employer: StaffEmployer;
  status: RecordStatus;
};

export function PersonDialog({
  companyId,
  draft,
  roles,
  onClose,
  simpleHire = false,
}: {
  companyId: string;
  draft: PersonDraft;
  roles: StaffRole[];
  onClose: () => void;
  /** Master panel create: no employer, status or dates; the server stores today's start (D80). */
  simpleHire?: boolean;
}) {
  const id = useId();
  const createStaff = useCreateStaff(companyId);
  const updateStaff = useUpdateStaff(companyId);
  const [values, setValues] = useState({ ...draft, phone: draft.phone ?? "" });
  const [period, setPeriod] = useState(newPeriod);
  const [errors, setErrors] = useState(noErrors);
  const creating = !values.id;

  async function submit() {
    const fields: Partial<Record<string, string>> = {};
    if (!values.name.trim()) fields.name = t("validation.required");
    const periodErrors = creating ? checkPeriod(period, "assignment.") : null;
    if (Object.keys(fields).length > 0 || periodErrors) {
      setErrors({ fields: { ...fields, ...periodErrors?.fields } });
      return;
    }
    setErrors(noErrors);
    const person = {
      name: values.name.trim(),
      phone: values.phone.trim(),
      employer: values.employer,
      status: values.status,
    };
    try {
      if (values.id) await updateStaff.mutateAsync({ staffId: values.id, input: person });
      else await createStaff.mutateAsync({ ...person, assignment: periodInput(period, roles) });
      onClose();
    } catch (error) {
      setErrors(
        describeError(error, [
          "name",
          "phone",
          "employer",
          "assignment.roleId",
          "assignment.from",
          "assignment.to",
          "assignment.monthlySalary",
        ]),
      );
    }
  }

  return (
    <FormDialog
      open
      title={t(creating ? "staff.form.createTitle" : "staff.form.editTitle")}
      error={errors.form}
      pending={createStaff.isPending || updateStaff.isPending}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <Field id={`${id}-name`} label={t("staff.name")} error={errors.fields.name}>
        <input
          id={`${id}-name`}
          value={values.name}
          onChange={(event) => setValues({ ...values, name: event.target.value })}
          className={inputClass}
        />
      </Field>
      <Field id={`${id}-phone`} label={t("staff.phone")} error={errors.fields.phone}>
        <input
          id={`${id}-phone`}
          type="tel"
          inputMode="tel"
          value={values.phone}
          onChange={(event) => setValues({ ...values, phone: event.target.value })}
          className={inputClass}
        />
      </Field>
      {simpleHire && creating ? null : (
        <>
          <Field id={`${id}-employer`} label={t("staff.employer")} error={errors.fields.employer}>
            <select
              id={`${id}-employer`}
              value={values.employer}
              onChange={(event) => {
                setValues({ ...values, employer: event.target.value as StaffEmployer });
                setPeriod({ ...period, roleId: "" });
              }}
              className={inputClass}
            >
              {staffEmployers.map((employer) => (
                <option key={employer} value={employer}>
                  {t(`staff.employer.${employer}`)}
                </option>
              ))}
            </select>
          </Field>
          <StatusField
            id={`${id}-status`}
            value={values.status}
            onChange={(status) => setValues({ ...values, status })}
          />
        </>
      )}
      {creating ? (
        <PeriodFields
          id={`${id}-period`}
          period={period}
          roles={roles}
          employer={values.employer}
          errors={errors}
          pathPrefix="assignment."
          dates={!simpleHire}
          salaryHint={!simpleHire}
          onChange={setPeriod}
        />
      ) : null}
    </FormDialog>
  );
}

type AssignmentDraft = {
  /** Unset when the person is picked in the dialog (assigning someone from another company). */
  person?: StaffRecord;
  assignment?: StaffAssignment;
};

function AssignmentDialog({
  companyId,
  draft,
  roles,
  candidates,
  onClose,
}: {
  companyId: string;
  draft: AssignmentDraft;
  roles: StaffRole[];
  candidates: StaffRecord[];
  onClose: () => void;
}) {
  const id = useId();
  const save = useSaveStaffAssignment(companyId);
  const [personId, setPersonId] = useState(draft.person?.id ?? "");
  const [period, setPeriod] = useState<Period>(
    draft.assignment
      ? {
          roleId: draft.assignment.roleId,
          from: draft.assignment.from,
          to: draft.assignment.to ?? "",
          monthlySalary: draft.assignment.monthlySalary ?? "",
        }
      : newPeriod(),
  );
  const [errors, setErrors] = useState(noErrors);
  const person = draft.person ?? candidates.find((c) => c.id === personId);

  async function submit() {
    const checked = checkPeriod(period, "");
    if (!person || checked) {
      setErrors({
        fields: { ...checked?.fields, ...(person ? {} : { staffId: t("validation.required") }) },
      });
      return;
    }
    setErrors(noErrors);
    try {
      await save.mutateAsync({
        staffId: person.id,
        ...(draft.assignment ? { assignmentId: draft.assignment.id } : {}),
        input: periodInput(period, roles),
      });
      onClose();
    } catch (error) {
      setErrors(describeError(error, ["roleId", "from", "to", "monthlySalary"]));
    }
  }

  return (
    <FormDialog
      open
      title={t(draft.assignment ? "staff.assignment.editTitle" : "staff.assignment.createTitle")}
      error={errors.form}
      pending={save.isPending}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      {draft.person ? (
        <p className="font-medium">{draft.person.name}</p>
      ) : (
        <Field id={`${id}-person`} label={t("staff.person")} error={errors.fields.staffId}>
          <select
            id={`${id}-person`}
            value={personId}
            onChange={(event) => {
              setPersonId(event.target.value);
              setPeriod({ ...period, roleId: "" });
            }}
            className={inputClass}
          >
            <option value="">{t("common.select")}</option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name} ({t(`staff.employer.${candidate.employer}`)})
              </option>
            ))}
          </select>
        </Field>
      )}
      {person ? (
        <PeriodFields
          id={`${id}-period`}
          period={period}
          roles={roles}
          employer={person.employer}
          errors={errors}
          pathPrefix=""
          onChange={setPeriod}
        />
      ) : null}
    </FormDialog>
  );
}

/** Super-admin: a field-panel sign-in for a DSR (D40). */
function LoginDialog({
  companyId,
  person,
  onClose,
}: {
  companyId: string;
  person: StaffRecord;
  onClose: () => void;
}) {
  const id = useId();
  const create = useCreateStaffLogin(companyId);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState(noErrors);

  async function submit() {
    const fields: Partial<Record<string, string>> = {};
    if (!email.trim()) fields.email = t("validation.required");
    if (password.length < MIN_PASSWORD_LENGTH) fields.password = t("auth.passwordTooShort");
    if (Object.keys(fields).length > 0) {
      setErrors({ fields });
      return;
    }
    setErrors(noErrors);
    try {
      await create.mutateAsync({ staffId: person.id, input: { email: email.trim(), password } });
      onClose();
    } catch (error) {
      setErrors(describeError(error, ["email", "password"]));
    }
  }

  return (
    <FormDialog
      open
      title={t("staff.login.title")}
      error={errors.form}
      pending={create.isPending}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <p className="font-medium">{person.name}</p>
      <p className="text-sm text-text-muted">{t("staff.login.hint")}</p>
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
        error={errors.fields.password}
      >
        <input
          id={`${id}-password`}
          type="text"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={inputClass}
        />
      </Field>
    </FormDialog>
  );
}

function AssignmentList({
  record,
  companyId,
  canManage,
  onEdit,
}: {
  record: StaffRecord;
  companyId: string;
  canManage: boolean;
  onEdit: (assignment: StaffAssignment) => void;
}) {
  const workspaces = useWorkspaces();
  const companyName = (id: string) =>
    workspaces.data?.find((w) => w.company.id === id)?.company.name ?? "";
  return (
    <ul className="mt-3 flex flex-col gap-2 text-sm">
      {record.assignments.map((assignment) => (
        <li
          key={assignment.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-muted px-3 py-2"
        >
          <span>
            <span className="font-medium">{assignment.roleName}</span>
            {" · "}
            {companyName(assignment.companyId)}
            {" · "}
            {toBengaliDigits(assignment.from)} –{" "}
            {assignment.to ? toBengaliDigits(assignment.to) : t("common.openEnded")}
            {assignment.monthlySalary !== null
              ? ` · ${t("staff.monthlySalary")}: ${formatAmount(assignment.monthlySalary)}`
              : ""}
          </span>
          {canManage && assignment.companyId === companyId ? (
            <Button onClick={() => onEdit(assignment)}>{t("common.edit")}</Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

type StaffTab = "dsr" | "other";
const STAFF_TABS = ["dsr", "other"] as const;

/** SR, DSR and other staff with dated role assignments; one DSR may serve several brands (D09). */
function Staff() {
  const { company, permissions } = useCurrentWorkspace();
  const session = useSession();
  const records = useStaffRecords(company.id);
  const roles = useConfigList("staffRoles");
  const isSuperAdmin = session?.me.isSuperAdmin === true;
  const allStaff = useAllStaff(isSuperAdmin);
  const canManage = permissions.includes("staff.manage");
  const deleteStaff = useDeleteStaff(company.id);
  const [person, setPerson] = useState<PersonDraft | null>(null);
  const [assignment, setAssignment] = useState<AssignmentDraft | null>(null);
  const [login, setLogin] = useState<StaffRecord | null>(null);
  const [tab, setTab] = useState<StaffTab>("dsr");

  // D65: the master panel holds the global staff (no SR); a company holds its SRs only.
  // D80: a new master hire is only a DSR, driver or manager. Editing an older role still lists it.
  const companyRoles = (roles.data ?? []).filter((role) =>
    company.isMaster ? role.kind !== "sr" : role.kind === "sr",
  );
  const hireRoles = company.isMaster ? companyRoles.filter(masterPanelHireRole) : companyRoles;
  const dsrRoles = new Set(
    (roles.data ?? []).filter((role) => role.kind === "dsr").map((role) => role.id),
  );
  const isDsrHere = (record: StaffRecord) => record.assignments.some((a) => dsrRoles.has(a.roleId));
  const own = (records.data ?? []).filter((r) =>
    r.assignments.some((a) => a.companyId === company.id),
  );
  const here = new Set(own.map((r) => r.id));
  const candidates = (allStaff.data ?? []).filter(
    (r) =>
      !here.has(r.id) &&
      r.status === "active" &&
      r.employer === (company.isMaster ? "distributor" : "supplier"),
  );

  // D80: আমাদের স্টাফ does not list SRs. They stay on এসআর হিসাব.
  const kindOf = new Map((roles.data ?? []).map((role) => [role.id, role.kind]));
  const isSr = (record: StaffRecord) =>
    record.assignments.some((a) => kindOf.get(a.roleId) === "sr");
  const tabOf = (record: StaffRecord): StaffTab =>
    record.assignments.some((a) => kindOf.get(a.roleId) === "dsr") ? "dsr" : "other";
  const source = company.isMaster ? allStaff : records;
  const pool = company.isMaster ? (allStaff.data ?? []).filter((r) => !isSr(r)) : own;
  const listed = company.isMaster ? pool.filter((r) => tabOf(r) === tab) : own;

  let body: React.ReactNode;
  if (source.isPending) body = <ListSkeleton rows={5} detail action />;
  else if (source.isError) {
    body = <QueryError error={source.error} onRetry={() => void source.refetch()} />;
  } else if (listed.length === 0) {
    body = <StatePanel title={t(company.isMaster ? "staff.tab.empty" : "staff.empty")} />;
  } else {
    body = (
      <ul className="flex flex-col gap-3">
        {listed.map((record) => (
          <li key={record.id} className="rounded-lg border border-border bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-medium">{record.name}</div>
                <div className="text-sm text-text-muted">
                  {record.phone ? (
                    <>
                      {toBengaliDigits(record.phone)}
                      {" · "}
                    </>
                  ) : null}
                  {t(`staff.employer.${record.employer}`)}
                  {" · "}
                  <span className={record.status === "active" ? "text-success" : undefined}>
                    {t(`common.status.${record.status}`)}
                  </span>
                  {record.loginEmail ? (
                    <>
                      {" · "}
                      {t("staff.login.linked")}: {record.loginEmail}
                    </>
                  ) : null}
                </div>
              </div>
              {canManage ? (
                <div className="flex flex-wrap gap-2">
                  {isSuperAdmin && record.loginEmail === null && isDsrHere(record) ? (
                    <Button onClick={() => setLogin(record)}>{t("staff.login.create")}</Button>
                  ) : null}
                  <Button onClick={() => setAssignment({ person: record })}>
                    {t("staff.assign")}
                  </Button>
                  <Button
                    onClick={() =>
                      setPerson({
                        id: record.id,
                        name: record.name,
                        phone: record.phone,
                        employer: record.employer,
                        status: record.status,
                      })
                    }
                  >
                    {t("common.edit")}
                  </Button>
                  <DeleteButton
                    name={record.name}
                    message={t("staff.delete.confirm")}
                    onDelete={() => deleteStaff.mutateAsync(record.id)}
                  />
                </div>
              ) : null}
            </div>
            <AssignmentList
              record={record}
              companyId={company.id}
              canManage={canManage}
              onEdit={(a) => setAssignment({ person: record, assignment: a })}
            />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <>
      <PageHeader
        title={t(company.isMaster ? "nav.master.staff" : "nav.masters.staff")}
        actions={
          canManage ? (
            <>
              {isSuperAdmin && candidates.length > 0 ? (
                <Button onClick={() => setAssignment({})}>{t("staff.assignExisting")}</Button>
              ) : null}
              <Button
                variant="primary"
                onClick={() =>
                  setPerson({
                    name: "",
                    employer: company.isMaster ? "distributor" : "supplier",
                    status: "active",
                  })
                }
              >
                {t("staff.new")}
              </Button>
            </>
          ) : null
        }
      />
      <p className="mb-4 text-sm text-text-muted">
        {t(company.isMaster ? "staff.globalHint" : "staff.companyHint")}
      </p>
      {company.isMaster ? (
        <div role="tablist" className="mb-4 flex flex-wrap gap-2">
          {STAFF_TABS.map((id) => (
            <Button
              key={id}
              role="tab"
              aria-selected={id === tab}
              variant={id === tab ? "primary" : "secondary"}
              onClick={() => setTab(id)}
            >
              {t(`staff.tab.${id}`)} (
              {toBengaliDigits(String(pool.filter((r) => tabOf(r) === id).length))})
            </Button>
          ))}
        </div>
      ) : null}
      {person ? (
        <PersonDialog
          companyId={company.id}
          draft={person}
          roles={hireRoles}
          simpleHire={company.isMaster && !person.id}
          onClose={() => setPerson(null)}
        />
      ) : null}
      {assignment ? (
        <AssignmentDialog
          companyId={company.id}
          draft={assignment}
          roles={company.isMaster && !assignment.assignment ? hireRoles : companyRoles}
          candidates={candidates}
          onClose={() => setAssignment(null)}
        />
      ) : null}
      {login ? (
        <LoginDialog companyId={company.id} person={login} onClose={() => setLogin(null)} />
      ) : null}
      {body}
    </>
  );
}

export function StaffPage() {
  return (
    <NavGate path={PATH}>
      <Staff />
    </NavGate>
  );
}
