"use client";

import type { Product, ProductCreateRequest } from "@bsd/contracts";
import { normalizeDigits, t } from "@bsd/i18n";
import { forwardRef, useId, useImperativeHandle, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/button";
import { StatePanel } from "@/components/state-panel";
import { describeError } from "@/data/ports/service-error";
import { useCreateProduct, useUpdateProduct } from "@/data/queries";
import { useRegisterDraftGuard } from "@/features/shell/draft-guard";

export type ProductFormHandle = {
  openCreate: () => void;
  openEdit: (product: Product) => void;
};

type FieldErrors = { sku?: string; name?: string; piecesPerCarton?: string };

/**
 * Shared create/edit dialog (guide section 21.6, R11: one shared field set, not a copy per
 * screen). Native `<dialog>` per T13; no primitive component library yet.
 */
export const ProductForm = forwardRef<ProductFormHandle, { companyId: string }>(
  function ProductForm({ companyId }, ref) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const fieldId = useId();
    const [isOpen, setIsOpen] = useState(false);
    const [mode, setMode] = useState<"create" | "edit">("create");
    const [productId, setProductId] = useState<string | null>(null);
    const [sku, setSku] = useState("");
    const [name, setName] = useState("");
    const [aliases, setAliases] = useState("");
    const [piecesPerCarton, setPiecesPerCarton] = useState("");
    const [status, setStatus] = useState<Product["status"]>("active");
    const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
    const [serverError, setServerError] = useState<string | null>(null);

    const createProduct = useCreateProduct(companyId);
    const updateProduct = useUpdateProduct(companyId);
    const pending = createProduct.isPending || updateProduct.isPending;

    useImperativeHandle(ref, () => ({
      openCreate() {
        setMode("create");
        setProductId(null);
        setSku("");
        setName("");
        setAliases("");
        setPiecesPerCarton("");
        setStatus("active");
        setFieldErrors({});
        setServerError(null);
        setIsOpen(true);
        dialogRef.current?.showModal();
      },
      openEdit(product) {
        setMode("edit");
        setProductId(product.id);
        setSku(product.sku);
        setName(product.name);
        setAliases(product.aliases.join(", "));
        setPiecesPerCarton(product.piecesPerCarton);
        setStatus(product.status);
        setFieldErrors({});
        setServerError(null);
        setIsOpen(true);
        dialogRef.current?.showModal();
      },
    }));

    function close() {
      dialogRef.current?.close();
    }

    /** Validates and submits; returns whether it's now safe to navigate away. */
    async function submit(): Promise<boolean> {
      const normalizedPieces = normalizeDigits(piecesPerCarton.trim());
      const errors: FieldErrors = {};
      if (!sku.trim()) errors.sku = t("product.validation.required");
      if (!name.trim()) errors.name = t("product.validation.required");
      if (!/^[1-9]\d*$/.test(normalizedPieces)) {
        errors.piecesPerCarton = t("product.validation.piecesPerCarton");
      }
      setFieldErrors(errors);
      if (Object.keys(errors).length > 0) return false;

      setServerError(null);
      const input: ProductCreateRequest = {
        sku: sku.trim(),
        name: name.trim(),
        aliases: aliases
          .split(",")
          .map((alias) => alias.trim())
          .filter((alias) => alias.length > 0),
        baseUnit: "piece",
        piecesPerCarton: normalizedPieces,
        status,
      };

      try {
        if (mode === "create") {
          await createProduct.mutateAsync(input);
        } else {
          if (!productId) return false;
          await updateProduct.mutateAsync({ productId, input });
        }
        close();
        return true;
      } catch (error) {
        const described = describeError(error, ["sku", "name", "piecesPerCarton"]);
        setFieldErrors(described.fields);
        setServerError(described.form ?? null);
        return false;
      }
    }

    useRegisterDraftGuard(isOpen ? { save: submit, discard: close } : null);

    function handleSubmit(event: FormEvent) {
      event.preventDefault();
      void submit();
    }

    return (
      <dialog
        ref={dialogRef}
        onClose={() => setIsOpen(false)}
        aria-label={t(mode === "create" ? "product.form.createTitle" : "product.form.editTitle")}
        className="m-auto w-full max-w-md rounded-2xl border border-border bg-surface p-0 text-text shadow-raised"
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-4">
          <h2 className="text-lg font-semibold">
            {t(mode === "create" ? "product.form.createTitle" : "product.form.editTitle")}
          </h2>

          {serverError ? <StatePanel tone="error" title={serverError} /> : null}

          <div>
            <label htmlFor={`${fieldId}-sku`} className="mb-1 block text-sm font-medium">
              {t("product.sku")}
            </label>
            <input
              id={`${fieldId}-sku`}
              value={sku}
              onChange={(event) => setSku(event.target.value)}
              className="min-h-(--touch-target) w-full rounded-md border border-border bg-surface px-3"
            />
            {fieldErrors.sku ? <p className="mt-1 text-sm text-error">{fieldErrors.sku}</p> : null}
          </div>

          <div>
            <label htmlFor={`${fieldId}-name`} className="mb-1 block text-sm font-medium">
              {t("product.name")}
            </label>
            <input
              id={`${fieldId}-name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="min-h-(--touch-target) w-full rounded-md border border-border bg-surface px-3"
            />
            {fieldErrors.name ? (
              <p className="mt-1 text-sm text-error">{fieldErrors.name}</p>
            ) : null}
          </div>

          <div>
            <label htmlFor={`${fieldId}-aliases`} className="mb-1 block text-sm font-medium">
              {t("product.aliases")}
            </label>
            <input
              id={`${fieldId}-aliases`}
              value={aliases}
              onChange={(event) => setAliases(event.target.value)}
              placeholder={t("product.aliasesHint")}
              className="min-h-(--touch-target) w-full rounded-md border border-border bg-surface px-3"
            />
          </div>

          <div>
            <label htmlFor={`${fieldId}-ppc`} className="mb-1 block text-sm font-medium">
              {t("product.piecesPerCarton")}
            </label>
            <input
              id={`${fieldId}-ppc`}
              inputMode="numeric"
              value={piecesPerCarton}
              onChange={(event) => setPiecesPerCarton(event.target.value)}
              className="min-h-(--touch-target) w-full rounded-md border border-border bg-surface px-3"
            />
            {fieldErrors.piecesPerCarton ? (
              <p className="mt-1 text-sm text-error">{fieldErrors.piecesPerCarton}</p>
            ) : null}
          </div>

          <div>
            <label htmlFor={`${fieldId}-status`} className="mb-1 block text-sm font-medium">
              {t("product.status")}
            </label>
            <select
              id={`${fieldId}-status`}
              value={status}
              onChange={(event) => setStatus(event.target.value as Product["status"])}
              className="min-h-(--touch-target) w-full rounded-md border border-border bg-surface px-3"
            >
              <option value="active">{t("product.status.active")}</option>
              <option value="archived">{t("product.status.archived")}</option>
            </select>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close}>
              {t("product.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? t("product.saving") : t("product.save")}
            </Button>
          </div>
        </form>
      </dialog>
    );
  },
);
