"use client";

import {
  staffEmployers,
  type StaffAssignment,
  type StaffEmployer,
  type StaffRecord,
  type StaffRole,
  type Supplier,
} from "@bsd/contracts";
import { businessDateOf } from "@bsd/domain";
import { t, toBengaliDigits } from "@bsd/i18n";
import { useId, useState } from "react";
import { Button } from "@/components/button";
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

type Period = { roleId: string; from: string; to: string };

const newPeriod = (): Period => ({ roleId: "", from: businessDateOf(new Date()), to: "" });

/** Role + from/to, shared by "new person" and the assignment dialog. */
function PeriodFields({
  id,
  period,
  roles,
  employer,
  errors,
  pathPrefix,
  onChange,
}: {
  id: string;
  period: Period;
  roles: StaffRole[];
  employer: StaffEmployer;
  errors: DescribedError;
  pathPrefix: string;
  onChange: (period: Period) => void;
}) {
  const options = roles.filter(
    (role) => (role.active && fitsEmployer(role, employer)) || role.id === period.roleId,
  );
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
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          id={`${id}-from`}
          label={t("common.from")}
          error={errors.fields[`${pathPrefix}from`]}
        >
          <input
            id={`${id}-from`}
            type="date"
            value={period.from}
            onChange={(event) => onChange({ ...period, from: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field
          id={`${id}-to`}
          label={t("common.to")}
          hint={t("staff.assignment.endHint")}
          error={errors.fields[`${pathPrefix}to`]}
        >
          <input
            id={`${id}-to`}
            type="date"
            value={period.to}
            onChange={(event) => onChange({ ...period, to: event.target.value })}
            className={inputClass}
          />
        </Field>
      </div>
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
  return Object.keys(fields).length > 0 ? { fields } : null;
}

const periodInput = (period: Period) => ({
  roleId: period.roleId,
  from: period.from,
  to: period.to || null,
});

type PersonDraft = {
  id?: string;
  name: string;
  employer: StaffEmployer;
  phone: string;
  status: Supplier["status"];
};

function PersonDialog({
  companyId,
  draft,
  roles,
  onClose,
}: {
  companyId: string;
  draft: PersonDraft;
  roles: StaffRole[];
  onClose: () => void;
}) {
  const id = useId();
  const createStaff = useCreateStaff(companyId);
  const updateStaff = useUpdateStaff(companyId);
  const [values, setValues] = useState(draft);
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
      employer: values.employer,
      ...(values.phone.trim() ? { phone: values.phone.trim() } : {}),
      status: values.status,
    };
    try {
      if (values.id) await updateStaff.mutateAsync({ staffId: values.id, input: person });
      else await createStaff.mutateAsync({ ...person, assignment: periodInput(period) });
      onClose();
    } catch (error) {
      setErrors(
        describeError(error, [
          "name",
          "employer",
          "phone",
          "assignment.roleId",
          "assignment.from",
          "assignment.to",
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
      {creating ? (
        <PeriodFields
          id={`${id}-period`}
          period={period}
          roles={roles}
          employer={values.employer}
          errors={errors}
          pathPrefix="assignment."
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
        input: periodInput(period),
      });
      onClose();
    } catch (error) {
      setErrors(describeError(error, ["roleId", "from", "to"]));
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
          </span>
          {canManage && assignment.companyId === companyId ? (
            <Button onClick={() => onEdit(assignment)}>{t("common.edit")}</Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** SR, DSR and other staff with dated role assignments; one DSR may serve several brands (D09). */
function Staff() {
  const { company, permissions } = useCurrentWorkspace();
  const session = useSession();
  const records = useStaffRecords(company.id);
  const roles = useConfigList("staffRoles");
  const isSuperAdmin = session?.me.isSuperAdmin === true;
  const allStaff = useAllStaff(isSuperAdmin);
  const canManage = permissions.includes("staff.manage");
  const [person, setPerson] = useState<PersonDraft | null>(null);
  const [assignment, setAssignment] = useState<AssignmentDraft | null>(null);

  const roleList = roles.data ?? [];
  const here = new Set(records.data?.map((r) => r.id));
  const candidates = (allStaff.data ?? []).filter((r) => !here.has(r.id) && r.status === "active");

  let body: React.ReactNode;
  if (records.isPending) body = <ListSkeleton />;
  else if (records.isError) {
    body = <QueryError error={records.error} onRetry={() => void records.refetch()} />;
  } else if (records.data.length === 0) body = <StatePanel title={t("staff.empty")} />;
  else {
    body = (
      <ul className="flex flex-col gap-3">
        {records.data.map((record) => (
          <li key={record.id} className="rounded-lg border border-border bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-medium">{record.name}</div>
                <div className="text-sm text-text-muted">
                  {t(`staff.employer.${record.employer}`)}
                  {record.phone ? ` · ${record.phone}` : ""}
                  {" · "}
                  <span className={record.status === "active" ? "text-success" : undefined}>
                    {t(`common.status.${record.status}`)}
                  </span>
                </div>
              </div>
              {canManage ? (
                <div className="flex gap-2">
                  <Button onClick={() => setAssignment({ person: record })}>
                    {t("staff.assign")}
                  </Button>
                  <Button
                    onClick={() =>
                      setPerson({
                        id: record.id,
                        name: record.name,
                        employer: record.employer,
                        phone: record.phone ?? "",
                        status: record.status,
                      })
                    }
                  >
                    {t("common.edit")}
                  </Button>
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
        title={t("nav.masters.staff")}
        actions={
          canManage ? (
            <>
              {isSuperAdmin && candidates.length > 0 ? (
                <Button onClick={() => setAssignment({})}>{t("staff.assignExisting")}</Button>
              ) : null}
              <Button
                variant="primary"
                onClick={() =>
                  setPerson({ name: "", employer: "distributor", phone: "", status: "active" })
                }
              >
                {t("staff.new")}
              </Button>
            </>
          ) : null
        }
      />
      {person ? (
        <PersonDialog
          companyId={company.id}
          draft={person}
          roles={roleList}
          onClose={() => setPerson(null)}
        />
      ) : null}
      {assignment ? (
        <AssignmentDialog
          companyId={company.id}
          draft={assignment}
          roles={roleList}
          candidates={candidates}
          onClose={() => setAssignment(null)}
        />
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
