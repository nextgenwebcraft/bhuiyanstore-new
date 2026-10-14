"use client";

import { workspaceModuleIds, type WorkspaceModuleId } from "@bsd/contracts";
import { contrastRatio, DEFAULT_COMPANY_THEME, MIN_TEXT_CONTRAST } from "@bsd/design-system";
import { t } from "@bsd/i18n";
import { useId, useState } from "react";
import { Field, inputClass } from "@/components/field";
import { FormDialog } from "@/components/form-dialog";
import { describeError, type DescribedError } from "@/data/ports/service-error";
import { useCreateCompany } from "@/data/queries";

/** Super-admin: a new brand workspace with its theme and enabled modules (guide 4.3, D28). */
export function CompanyForm({ onClose }: { onClose: () => void }) {
  const id = useId();
  const createCompany = useCreateCompany();
  const [name, setName] = useState("");
  const [primary, setPrimary] = useState<string>(DEFAULT_COMPANY_THEME.primary);
  const [foreground, setForeground] = useState<string>(DEFAULT_COMPANY_THEME.primaryForeground);
  const [starterData, setStarterData] = useState(true);
  const [modules, setModules] = useState<WorkspaceModuleId[]>([...workspaceModuleIds]);
  const [errors, setErrors] = useState<DescribedError>({ fields: {} });
  const lowContrast = contrastRatio(foreground, primary) < MIN_TEXT_CONTRAST;

  function toggle(module: WorkspaceModuleId) {
    const next = new Set(modules);
    if (next.has(module)) next.delete(module);
    else next.add(module);
    setModules(workspaceModuleIds.filter((m) => next.has(m)));
  }

  async function submit() {
    if (!name.trim()) {
      setErrors({ fields: { name: t("validation.required") } });
      return;
    }
    if (lowContrast) return;
    setErrors({ fields: {} });
    try {
      await createCompany.mutateAsync({
        name: name.trim(),
        theme: { primary, primaryForeground: foreground },
        modules,
        blockNegativeStock: false,
        starterData,
      });
      onClose();
    } catch (error) {
      setErrors(describeError(error, ["name", "theme.primary", "theme.primaryForeground"]));
    }
  }

  return (
    <FormDialog
      open
      title={t("company.form.createTitle")}
      error={errors.form}
      pending={createCompany.isPending}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <Field id={`${id}-name`} label={t("company.name")} error={errors.fields.name}>
        <input
          id={`${id}-name`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={inputClass}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          id={`${id}-primary`}
          label={t("company.primaryColor")}
          error={errors.fields["theme.primary"]}
        >
          <input
            id={`${id}-primary`}
            type="color"
            value={primary}
            onChange={(event) => setPrimary(event.target.value)}
            className="min-h-(--touch-target) w-full rounded-md border border-border bg-surface"
          />
        </Field>
        <Field
          id={`${id}-foreground`}
          label={t("company.primaryForeground")}
          error={errors.fields["theme.primaryForeground"]}
        >
          <input
            id={`${id}-foreground`}
            type="color"
            value={foreground}
            onChange={(event) => setForeground(event.target.value)}
            className="min-h-(--touch-target) w-full rounded-md border border-border bg-surface"
          />
        </Field>
      </div>
      <div
        className="rounded-md px-4 py-3 font-semibold"
        style={{ backgroundColor: primary, color: foreground }}
      >
        {name.trim() || t("company.name")}
      </div>
      {lowContrast ? (
        <p className="text-sm text-error" role="alert">
          {t("company.lowContrast")}
        </p>
      ) : null}
      <label className="flex min-h-(--touch-target) items-start gap-2">
        <input
          type="checkbox"
          checked={starterData}
          onChange={(event) => setStarterData(event.target.checked)}
          className="mt-1"
        />
        <span>
          <span className="block font-medium">{t("company.starterData")}</span>
          <span className="block text-sm text-text-muted">{t("company.starterDataHint")}</span>
        </span>
      </label>
      <fieldset>
        <legend className="mb-1 text-sm font-medium">{t("company.modules")}</legend>
        <p className="mb-2 text-sm text-text-muted">{t("company.modulesHint")}</p>
        <div className="grid gap-1 sm:grid-cols-2">
          {workspaceModuleIds.map((module) => (
            <label key={module} className="flex min-h-(--touch-target) items-center gap-2">
              <input
                type="checkbox"
                checked={modules.includes(module)}
                onChange={() => toggle(module)}
              />
              {t(`nav.${module}`)}
            </label>
          ))}
        </div>
      </fieldset>
    </FormDialog>
  );
}
