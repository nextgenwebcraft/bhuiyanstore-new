import type { Batch } from "@bsd/contracts";
import { t, toBengaliDigits } from "@bsd/i18n";

/**
 * Shared batch row rendering (guide section 21.6, R10): reused by the batch drawer (one
 * product's batches) and the batches register (every batch, with a product column). Cost is
 * shown only with inventory.cost_view (D06).
 */
export function BatchTable({
  batches,
  showCost,
  productNameFor,
}: {
  batches: Batch[];
  showCost: boolean;
  /** When provided, a Product column is rendered; omit for a single-product context. */
  productNameFor?: (productId: string) => string;
}) {
  if (batches.length === 0) {
    return <p className="text-text-muted">{t("inventory.batches.empty")}</p>;
  }

  return (
    <>
      {/* Desktop: compact table */}
      <table className="hidden w-full border-collapse overflow-hidden rounded-lg bg-surface text-sm md:table">
        <thead className="bg-surface-muted text-left">
          <tr>
            {productNameFor ? (
              <th scope="col" className="px-4 py-3 font-semibold">
                {t("inventory.column.product")}
              </th>
            ) : null}
            <th scope="col" className="px-4 py-3 font-semibold">
              {t("inventory.column.lot")}
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              {t("inventory.column.expiry")}
            </th>
            <th scope="col" className="px-4 py-3 text-right font-semibold">
              {t("inventory.column.available")}
            </th>
            <th scope="col" className="px-4 py-3 text-right font-semibold">
              {t("inventory.column.reserved")}
            </th>
            <th scope="col" className="px-4 py-3 text-right font-semibold">
              {t("inventory.column.quarantine")}
            </th>
            {showCost ? (
              <th scope="col" className="px-4 py-3 text-right font-semibold">
                {t("inventory.column.cost")}
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {batches.map((batch) => (
            <tr key={batch.id} className="border-t border-border">
              {productNameFor ? (
                <td className="px-4 py-3">{productNameFor(batch.productId)}</td>
              ) : null}
              <td className="px-4 py-3 font-mono">{batch.lotId ?? "—"}</td>
              <td className="px-4 py-3">
                {batch.expiryDate ? toBengaliDigits(batch.expiryDate) : t("inventory.noExpiry")}
              </td>
              <td className="px-4 py-3 text-right">{toBengaliDigits(batch.availableQuantity)}</td>
              <td className="px-4 py-3 text-right">{toBengaliDigits(batch.reservedQuantity)}</td>
              <td className="px-4 py-3 text-right">{toBengaliDigits(batch.quarantineQuantity)}</td>
              {showCost ? (
                <td className="px-4 py-3 text-right">{toBengaliDigits(batch.unitCost)}</td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile: stacked cards instead of a squeezed table (guide section 5.1.1) */}
      <ul className="flex flex-col gap-3 md:hidden">
        {batches.map((batch) => (
          <li key={batch.id} className="rounded-lg border border-border bg-surface p-4">
            {productNameFor ? (
              <div className="mb-2 font-medium">{productNameFor(batch.productId)}</div>
            ) : null}
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-text-muted">{t("inventory.column.lot")}</dt>
              <dd className="font-mono">{batch.lotId ?? "—"}</dd>
              <dt className="text-text-muted">{t("inventory.column.expiry")}</dt>
              <dd>
                {batch.expiryDate ? toBengaliDigits(batch.expiryDate) : t("inventory.noExpiry")}
              </dd>
              <dt className="text-text-muted">{t("inventory.column.available")}</dt>
              <dd>{toBengaliDigits(batch.availableQuantity)}</dd>
              <dt className="text-text-muted">{t("inventory.column.reserved")}</dt>
              <dd>{toBengaliDigits(batch.reservedQuantity)}</dd>
              <dt className="text-text-muted">{t("inventory.column.quarantine")}</dt>
              <dd>{toBengaliDigits(batch.quarantineQuantity)}</dd>
              {showCost ? (
                <>
                  <dt className="text-text-muted">{t("inventory.column.cost")}</dt>
                  <dd>{toBengaliDigits(batch.unitCost)}</dd>
                </>
              ) : null}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}
