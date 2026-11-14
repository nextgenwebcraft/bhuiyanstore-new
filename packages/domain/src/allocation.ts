import { Decimal, toDecimal, type DecimalInput } from "./decimal";

type Orderable = { id?: string; expiryDate?: string | undefined; receivedDate: string };

/**
 * D05: FEFO (first-expiry-first-out) when expiry is known, otherwise FIFO by receipt date, with a
 * stable ID tie-breaker within the same date (guide section 9.4). The single named owner of this
 * ordering, reused by preview and posting instead of being reimplemented per screen.
 */
export function sortByAllocationPriority<T extends Orderable>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    let order = 0;
    if (a.expiryDate && b.expiryDate) order = a.expiryDate.localeCompare(b.expiryDate);
    else if (a.expiryDate) return -1;
    else if (b.expiryDate) return 1;
    if (order === 0) order = a.receivedDate.localeCompare(b.receivedDate);
    if (order === 0 && a.id !== undefined && b.id !== undefined) order = a.id.localeCompare(b.id);
    return order;
  });
}

export type AllocatableLayer = {
  id: string;
  expiryDate?: string | undefined;
  receivedDate: string;
  /** Saleable quantity only; quarantine and reservations are separate balances (guide 9.4). */
  availableQuantity: DecimalInput;
  unitCost: DecimalInput;
};

export type StockAllocation = { batchId: string; quantity: string; unitCost: string };

export type AllocationResult = {
  allocations: StockAllocation[];
  /** "0" when the requested quantity is fully covered. */
  shortfall: string;
};

/**
 * Allocates a base quantity across cost layers in D05 order. Layers expired on or before
 * `asOfDate` are excluded (guide section 9.4: never consume expired stock); unknown expiry is
 * treated as FIFO-eligible per the D05 default.
 */
export function allocateByPriority(
  layers: readonly AllocatableLayer[],
  quantity: DecimalInput,
  asOfDate?: string,
): AllocationResult {
  let remaining = toDecimal(quantity);
  if (remaining.isNegative()) throw new RangeError("quantity must not be negative");

  const eligible = sortByAllocationPriority(
    layers.filter((layer) => !(asOfDate && layer.expiryDate && layer.expiryDate < asOfDate)),
  );
  const allocations: StockAllocation[] = [];
  for (const layer of eligible) {
    if (remaining.isZero()) break;
    const available = toDecimal(layer.availableQuantity);
    if (available.lte(0)) continue;
    const take = Decimal.min(available, remaining);
    allocations.push({
      batchId: layer.id,
      quantity: take.toString(),
      unitCost: toDecimal(layer.unitCost).toString(),
    });
    remaining = remaining.sub(take);
  }
  return { allocations, shortfall: remaining.toString() };
}
