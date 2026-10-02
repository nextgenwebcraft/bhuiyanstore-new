"use client";

import type {
  ImportCheck,
  ImportIssue,
  ImportJob,
  ImportJobSummary,
  ImportMapping,
  ImportWorkbookSheets,
} from "@bsd/contracts";
import { businessDateOf } from "@bsd/domain";
import { formatAmount, formatBusinessDate, labelOf, t, type TranslationKey } from "@bsd/i18n";
import { useId, useState } from "react";
import { Button, ButtonLink } from "@/components/button";
import { Field, inputClass } from "@/components/field";
import { FormDialog } from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { ListSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { StatTile } from "@/components/stat-tile";
import { describeError } from "@/data/ports/service-error";
import {
  useCommitImportJob,
  useCreateImportJob,
  useDiscardImportJob,
  useImportJob,
  useImportJobs,
  useInspectImportWorkbook,
  useSaveImportMapping,
} from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";
import { companyHref } from "@/features/shell/navigation";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";

const PATH = "admin/import";

/** The importer names its checks in English; the screen shows them by key. */
const checkLabels: Record<string, TranslationKey> = {
  "Person net (issue − return)": "import.check.personNet",
  "Daily sales": "import.check.dailySales",
  "Daily cash left (Total Amount)": "import.check.dailyCash",
  "Staff net (owes us − we owe)": "import.check.staffNet",
  "Market due closing": "import.check.marketDue",
};
const checkLabel = (check: string) => {
  const key = checkLabels[check];
  return key ? t(key) : check;
};

const dayOf = (instant: string) => formatBusinessDate(businessDateOf(new Date(instant)));

const tableClass = "overflow-x-auto rounded-xl border border-border bg-surface shadow-card";
const headClass = "bg-surface-muted text-left text-xs text-text-muted";

function StatusBadge({ status }: { status: ImportJobSummary["status"] }) {
  const tone =
    status === "committed"
      ? "border-success/30 bg-success/10 text-success"
      : status === "ready"
        ? "border-brand/30 bg-brand/10 text-brand"
        : "border-border bg-surface-muted text-text-muted";
  return (
    <span className={`rounded-full border px-3 py-1 text-xs font-medium ${tone}`}>
      {t(`import.status.${status}`)}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------- upload

function UploadDialog({
  companyId,
  onCreated,
  onClose,
}: {
  companyId: string;
  onCreated: (jobId: string) => void;
  onClose: () => void;
}) {
  const id = useId();
  const inspect = useInspectImportWorkbook(companyId);
  const create = useCreateImportJob(companyId);
  const [file, setFile] = useState<File | null>(null);
  const [found, setFound] = useState<ImportWorkbookSheets | null>(null);
  const [sheet, setSheet] = useState("");
  const [error, setError] = useState<string | undefined>();

  async function choose(next: File | null) {
    setFile(next);
    setFound(null);
    setError(undefined);
    if (!next) return;
    try {
      const result = await inspect.mutateAsync(next);
      setFound(result);
      setSheet(result.sheets[0] ?? "");
    } catch (e) {
      setError(describeError(e, []).form);
    }
  }

  async function submit() {
    if (!file || !found) {
      setError(t("validation.required"));
      return;
    }
    if (!sheet) {
      setError(t("validation.import.sheet"));
      return;
    }
    try {
      const job = await create.mutateAsync({ file, fileName: file.name, sheet });
      onCreated(job.id);
    } catch (e) {
      setError(describeError(e, []).form);
    }
  }

  return (
    <FormDialog
      open
      title={t("import.upload.title")}
      error={error}
      pending={inspect.isPending || create.isPending}
      submitLabel={create.isPending ? t("import.upload.running") : t("import.upload.run")}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <Field id={`${id}-file`} label={t("import.upload.file")} hint={t("import.upload.notStored")}>
        <input
          id={`${id}-file`}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(event) => void choose(event.target.files?.[0] ?? null)}
          className="block w-full text-sm"
        />
      </Field>
      {inspect.isPending || create.isPending ? (
        <p className="text-sm text-text-muted">{t("import.upload.reading")}</p>
      ) : null}
      {found && found.sheets.length === 0 ? (
        <StatePanel tone="warning" title={t("import.upload.noSheets")} />
      ) : null}
      {found && found.sheets.length > 0 ? (
        <Field id={`${id}-sheet`} label={t("import.upload.sheet")}>
          <select
            id={`${id}-sheet`}
            value={sheet}
            onChange={(event) => setSheet(event.target.value)}
            className={inputClass}
          >
            {found.sheets.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
    </FormDialog>
  );
}

// ---------------------------------------------------------------- jobs list

function JobsList({
  jobs,
  selected,
  onSelect,
}: {
  jobs: ImportJobSummary[];
  selected: string | null;
  onSelect: (jobId: string) => void;
}) {
  if (jobs.length === 0) return <StatePanel title={t("import.jobs.empty")} />;
  return (
    <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface shadow-card">
      {jobs.map((job) => (
        <li key={job.id}>
          <button
            type="button"
            aria-current={job.id === selected || undefined}
            onClick={() => onSelect(job.id)}
            className={`flex w-full flex-col gap-1 px-4 py-3 text-left text-sm hover:bg-surface-muted ${
              job.id === selected ? "bg-surface-muted" : ""
            }`}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="font-medium">{job.sheet}</span>
              <StatusBadge status={job.status} />
            </span>
            <span className="truncate text-xs text-text-muted">{job.fileName}</span>
            <span className="flex justify-between text-xs text-text-subtle">
              <span>{dayOf(job.createdAt)}</span>
              {job.unexplained > 0 ? (
                <span className="text-warning">
                  {t("import.job.unexplained")} {formatAmount(String(job.unexplained))}
                </span>
              ) : null}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- job detail pieces

function ChecksTable({ checks }: { checks: ImportCheck[] }) {
  return (
    <div className="flex flex-col gap-2">
      <div className={tableClass}>
        <table className="w-full border-collapse text-sm">
          <thead className={headClass}>
            <tr>
              <th scope="col" className="px-3 py-3 font-medium">
                {t("import.check.name")}
              </th>
              {(["compared", "matched", "known", "unexplained"] as const).map((k) => (
                <th key={k} scope="col" className="px-3 py-3 text-right font-medium">
                  {t(`import.check.${k}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {checks.map((c) => (
              <tr key={c.check} className="border-t border-border">
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  {checkLabel(c.check)}
                </th>
                <td className="px-3 py-2 text-right">{formatAmount(String(c.compared))}</td>
                <td className="px-3 py-2 text-right">{formatAmount(String(c.matched))}</td>
                <td className="px-3 py-2 text-right text-text-muted">
                  {formatAmount(String(c.knownCount))}
                </td>
                <td
                  className={`px-3 py-2 text-right ${c.unexplainedCount > 0 ? "font-semibold text-warning" : ""}`}
                >
                  {formatAmount(String(c.unexplainedCount))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {checks
        .filter((c) => c.unexplained.length > 0 || c.known.length > 0)
        .map((c) => (
          <details key={c.check} className="rounded-xl border border-border bg-surface p-3 text-sm">
            <summary className="cursor-pointer font-medium">
              {checkLabel(c.check)} · {t("import.check.showDifferences")}
            </summary>
            <p className="mt-1 text-xs text-text-subtle">{t("import.check.capped")}</p>
            <table className="mt-2 w-full border-collapse text-sm">
              <thead className={headClass}>
                <tr>
                  <th scope="col" className="px-2 py-2 font-medium">
                    {t("import.check.where")}
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    {t("import.check.engine")}
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    {t("import.check.excel")}
                  </th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {[...c.unexplained, ...c.known].map((d, n) => (
                  <tr key={`${d.where}-${n}`} className="border-t border-border align-top">
                    <td className="px-2 py-1.5">
                      {d.where}
                      {d.knownMistake ? (
                        <div className="text-xs text-text-subtle">
                          {t("import.check.known")}: {d.knownMistake}
                        </div>
                      ) : null}
                    </td>
                    <td
                      className={`px-2 py-1.5 text-right ${d.knownMistake ? "" : "text-warning"}`}
                    >
                      {formatAmount(d.engine)}
                    </td>
                    <td className="px-2 py-1.5 text-right">{formatAmount(d.excel)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ))}
    </div>
  );
}

type Group = keyof ImportMapping;

type MappingRow = {
  key: string;
  label: string;
  hint?: string | undefined;
  muted?: boolean;
};

function MappingTable({
  title,
  group,
  rows,
  options,
  draft,
  locked,
  onChange,
}: {
  title: string;
  group: Group;
  rows: MappingRow[];
  options: { id: string; label: string }[];
  draft: ImportMapping;
  locked: boolean;
  onChange: (group: Group, key: string, id: string | null) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div className={tableClass}>
      <table className="w-full border-collapse text-sm">
        <caption className="px-3 pt-3 text-left text-sm font-semibold">{title}</caption>
        <thead className={headClass}>
          <tr>
            <th scope="col" className="px-3 py-3 font-medium">
              {t("import.mapping.sheetLabel")}
            </th>
            <th scope="col" className="px-3 py-3 font-medium">
              {t("import.mapping.target")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const value = draft[group][row.key] ?? "";
            return (
              <tr key={row.key} className="border-t border-border align-top">
                <th
                  scope="row"
                  className={`px-3 py-2 text-left font-medium ${row.muted ? "text-text-muted" : ""}`}
                >
                  {row.label}
                  {row.hint ? (
                    <div className="text-xs font-normal text-text-subtle">{row.hint}</div>
                  ) : null}
                </th>
                <td className="px-3 py-2">
                  <select
                    aria-label={`${title}: ${row.label}`}
                    value={value}
                    disabled={locked}
                    onChange={(event) => onChange(group, row.key, event.target.value || null)}
                    className={`${inputClass} ${value === "" && !row.muted ? "border-warning" : ""}`}
                  >
                    <option value="">{t("import.mapping.none")}</option>
                    {options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function mappingOf(job: ImportJob): ImportMapping {
  return {
    products: Object.fromEntries(job.products.map((p) => [p.key, p.productId])),
    staff: Object.fromEntries(job.people.map((p) => [p.key, p.staffId])),
    categories: Object.fromEntries(job.categories.map((c) => [c.key, c.categoryId])),
  };
}

function IssuesList({ job }: { job: ImportJob }) {
  const labelOfKey = new Map<string, string>([
    ...job.products.map((p) => [p.key, p.label] as const),
    ...job.people.map((p) => [p.key, p.label] as const),
    ...job.categories.map((c) => [c.key, c.label] as const),
  ]);
  const where = (i: ImportIssue) =>
    [
      i.key !== undefined ? (labelOfKey.get(i.key) ?? i.key) : undefined,
      i.date ? formatBusinessDate(i.date) : undefined,
      i.detail,
    ]
      .filter(Boolean)
      .join(" · ");
  const errors = job.issues.filter((i) => i.severity === "error");
  const warnings = job.issues.filter((i) => i.severity === "warning");
  const list = (items: ImportIssue[], tone: string) => (
    <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface shadow-card">
      {items.map((i, n) => (
        <li
          key={`${i.code}-${i.key ?? ""}-${n}`}
          className="flex flex-wrap justify-between gap-2 px-4 py-2.5 text-sm"
        >
          <span className={tone}>{labelOf(i.code)}</span>
          <span className="text-text-muted">{where(i)}</span>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="flex flex-col gap-3">
      {errors.length === 0 ? <StatePanel title={t("import.issues.none")} /> : null}
      {errors.length > 0 ? list(errors, "text-error") : null}
      {warnings.length > 0 ? list(warnings, "text-warning") : null}
    </div>
  );
}

// ---------------------------------------------------------------- job view

function JobView({ job }: { job: ImportJob }) {
  const id = useId();
  const { company, permissions } = useCurrentWorkspace();
  const save = useSaveImportMapping(company.id);
  const commit = useCommitImportJob(company.id);
  const discard = useDiscardImportJob(company.id);
  const [draft, setDraft] = useState(() => mappingOf(job));
  const [accept, setAccept] = useState(false);
  const [confirming, setConfirming] = useState<"commit" | "discard" | null>(null);
  const [error, setError] = useState<string | undefined>();

  const ready = job.status === "ready";
  const locked = !ready;
  const dirty = JSON.stringify(draft) !== JSON.stringify(mappingOf(job));
  const hasWarnings = job.issues.some((i) => i.severity === "warning");
  const missingPermission = job.mode === "opening" && !permissions.includes("opening.prepare");

  const setTarget = (group: Group, key: string, target: string | null) =>
    setDraft((d) => ({ ...d, [group]: { ...d[group], [key]: target } }));

  async function run(action: () => Promise<unknown>) {
    setError(undefined);
    try {
      await action();
      setConfirming(null);
    } catch (e) {
      setError(describeError(e, []).form);
    }
  }

  const productOptions = job.options.products.map((p) => ({
    id: p.id,
    label: `${p.sku} · ${p.name}`,
  }));
  const staffOptions = job.options.staff.map((s) => ({
    id: s.id,
    label: s.roleKind ? `${s.name} · ${t(`staff.kind.${s.roleKind}`)}` : s.name,
  }));
  const categoryOptions = job.options.categories.map((c) => ({ id: c.id, label: c.name }));
  const productRows: MappingRow[] = [...job.products]
    .sort((a, b) => Number(b.active) - Number(a.active))
    .map((p) => ({
      key: p.key,
      label: p.label,
      hint: [
        p.cartonSize ? `${t("import.mapping.cartonSize")} ${formatAmount(p.cartonSize)}` : "",
        p.active ? "" : t("import.mapping.inactive"),
      ]
        .filter(Boolean)
        .join(" · "),
      muted: !p.active,
    }));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            {job.sheet} <span className="text-sm font-normal text-text-muted">({job.month})</span>
          </h2>
          <p className="text-sm text-text-muted">
            {t("import.job.file")}: {job.fileName} · {t("import.job.created")}:{" "}
            {dayOf(job.createdAt)}
          </p>
        </div>
        <StatusBadge status={job.status} />
      </header>

      {error && confirming === null ? <StatePanel tone="error" title={error} /> : null}
      {job.status === "committed" ? (
        <StatePanel
          title={t("import.commit.done")}
          {...(job.committedMode ? { hint: t(`import.mode.${job.committedMode}`) } : {})}
          action={
            <ButtonLink
              href={companyHref(
                company.id,
                job.committedMode === "opening" ? "admin/opening" : "reports/month",
              )}
            >
              {job.committedMode === "opening"
                ? t("nav.administration.opening")
                : t("nav.reports.month")}
            </ButtonLink>
          }
        />
      ) : null}
      {ready ? (
        <StatePanel
          tone={job.mode ? "neutral" : "warning"}
          title={job.mode ? t(`import.mode.${job.mode}`) : t("import.mode.none")}
        />
      ) : null}

      <Section title={t("import.section.checks")}>
        <ChecksTable checks={job.checks} />
        {job.notes.length > 0 ? (
          <details className="rounded-xl border border-border bg-surface p-3 text-sm">
            <summary className="cursor-pointer font-medium">
              {t("import.section.notes")} ({formatAmount(String(job.notes.length))})
            </summary>
            <ul className="mt-1 list-disc pl-5 text-text-muted">
              {job.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </Section>

      <Section title={t("import.section.mapping")}>
        {dirty ? <StatePanel tone="warning" title={t("import.mapping.unsaved")} /> : null}
        <MappingTable
          title={t("import.mapping.products")}
          group="products"
          rows={productRows}
          options={productOptions}
          draft={draft}
          locked={locked}
          onChange={setTarget}
        />
        <MappingTable
          title={t("import.mapping.people")}
          group="staff"
          rows={job.people.map((p) => ({ key: p.key, label: p.label }))}
          options={staffOptions}
          draft={draft}
          locked={locked}
          onChange={setTarget}
        />
        <MappingTable
          title={t("import.mapping.categories")}
          group="categories"
          rows={job.categories.map((c) => ({ key: c.key, label: c.label }))}
          options={categoryOptions}
          draft={draft}
          locked={locked}
          onChange={setTarget}
        />
        {ready ? (
          <div>
            <Button
              variant="primary"
              disabled={!dirty || save.isPending}
              onClick={() =>
                void run(() =>
                  save.mutateAsync({
                    jobId: job.id,
                    input: { version: job.version, mapping: draft },
                  }),
                )
              }
            >
              {save.isPending ? t("common.saving") : t("import.mapping.save")}
            </Button>
          </div>
        ) : null}
      </Section>

      {ready ? (
        <Section title={t("import.section.issues")}>
          <IssuesList job={job} />
        </Section>
      ) : null}

      {ready && job.mode === "documents" ? (
        <Section title={t("import.section.documents")}>
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {(["stockEntries", "prices", "dsrDays", "moneyEntries"] as const).map((k) => (
              <StatTile
                key={k}
                label={t(`import.documents.${k}`)}
                value={formatAmount(String(job.documents[k]))}
              />
            ))}
          </dl>
        </Section>
      ) : null}

      {ready && job.openingDifferences.length > 0 ? (
        <Section title={t("import.section.openingDifferences")}>
          <div className={tableClass}>
            <table className="w-full border-collapse text-sm">
              <thead className={headClass}>
                <tr>
                  <th scope="col" className="px-3 py-3 font-medium">
                    {t("common.kind")}
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    {t("import.opening.system")}
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    {t("import.opening.sheet")}
                  </th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {job.openingDifferences.map((d, n) => (
                  <tr key={`${d.kind}-${d.label}-${n}`} className="border-t border-border">
                    <th scope="row" className="px-3 py-2 text-left font-medium">
                      {t(`import.opening.kind.${d.kind}`)}
                      {d.label ? (
                        <div className="text-xs font-normal text-text-subtle">{d.label}</div>
                      ) : null}
                    </th>
                    <td className="px-3 py-2 text-right">{formatAmount(d.system)}</td>
                    <td className="px-3 py-2 text-right text-warning">{formatAmount(d.sheet)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}

      {ready ? (
        <Section title={t("import.section.commit")}>
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-card">
            {hasWarnings ? (
              <label htmlFor={`${id}-accept`} className="flex items-start gap-2 text-sm">
                <input
                  id={`${id}-accept`}
                  type="checkbox"
                  checked={accept}
                  onChange={(event) => setAccept(event.target.checked)}
                  className="mt-1"
                />
                {t("import.commit.accept")}
              </label>
            ) : null}
            {missingPermission ? (
              <p className="text-sm text-warning">{t("import.commit.noPermission")}</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                disabled={
                  !job.canCommit ||
                  !job.mode ||
                  dirty ||
                  missingPermission ||
                  (hasWarnings && !accept)
                }
                onClick={() => {
                  setError(undefined);
                  setConfirming("commit");
                }}
              >
                {t("import.commit.run")}
              </Button>
              <Button
                onClick={() => {
                  setError(undefined);
                  setConfirming("discard");
                }}
              >
                {t("import.discard")}
              </Button>
            </div>
          </div>
        </Section>
      ) : null}

      {confirming === "commit" && job.mode ? (
        <FormDialog
          open
          title={t("import.commit.run")}
          error={error}
          pending={commit.isPending}
          submitLabel={commit.isPending ? t("import.commit.running") : t("import.commit.run")}
          onSubmit={() =>
            void run(() =>
              commit.mutateAsync({
                jobId: job.id,
                input: {
                  version: job.version,
                  mode: job.mode ?? "documents",
                  openingVersion: job.mode === "opening" ? job.openingVersion : null,
                  acceptDifferences: accept,
                },
              }),
            )
          }
          onClose={() => setConfirming(null)}
        >
          <p className="text-sm">
            {job.mode === "documents"
              ? t("import.commit.confirmDocuments")
              : t("import.commit.confirmOpening")}
          </p>
        </FormDialog>
      ) : null}
      {confirming === "discard" ? (
        <FormDialog
          open
          title={t("import.discard")}
          error={error}
          pending={discard.isPending}
          submitLabel={t("import.discard")}
          onSubmit={() =>
            void run(() => discard.mutateAsync({ jobId: job.id, input: { version: job.version } }))
          }
          onClose={() => setConfirming(null)}
        >
          <p className="text-sm">{t("import.discardConfirm")}</p>
        </FormDialog>
      ) : null}
    </div>
  );
}

function JobDetail({ jobId }: { jobId: string }) {
  const { company } = useCurrentWorkspace();
  const job = useImportJob(company.id, jobId);
  if (job.isPending) return <ListSkeleton />;
  if (job.isError) return <QueryError error={job.error} onRetry={() => void job.refetch()} />;
  // A new version (mapping saved, committed, discarded) starts a fresh local copy.
  return <JobView key={`${job.data.id}-${job.data.version}`} job={job.data} />;
}

// ---------------------------------------------------------------- page

function ImportScreen() {
  const { company } = useCurrentWorkspace();
  const jobs = useImportJobs(company.id);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const current = selected ?? jobs.data?.[0]?.id ?? null;

  return (
    <>
      <PageHeader
        title={t("nav.administration.import")}
        description={t("import.description")}
        actions={
          <Button variant="primary" onClick={() => setUploading(true)}>
            {t("import.upload")}
          </Button>
        }
      />
      {uploading ? (
        <UploadDialog
          companyId={company.id}
          onCreated={(jobId) => {
            setSelected(jobId);
            setUploading(false);
          }}
          onClose={() => setUploading(false)}
        />
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_1fr]">
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-text-muted">{t("import.jobs")}</h2>
          {jobs.isPending ? <ListSkeleton /> : null}
          {jobs.isError ? (
            <QueryError error={jobs.error} onRetry={() => void jobs.refetch()} />
          ) : null}
          {jobs.data ? (
            <JobsList jobs={jobs.data} selected={current} onSelect={setSelected} />
          ) : null}
        </section>
        <div className="min-w-0">
          {current ? (
            <JobDetail key={current} jobId={current} />
          ) : (
            <StatePanel title={t("import.job.select")} />
          )}
        </div>
      </div>
    </>
  );
}

export function ImportPage() {
  return (
    <NavGate path={PATH}>
      <ImportScreen />
    </NavGate>
  );
}
