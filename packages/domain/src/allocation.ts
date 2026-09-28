/**
 * D05: FEFO (first-expiry-first-out) when expiry is known, otherwise FIFO by receipt date. The
 * single named owner of this ordering, reused by any future allocation/dispatch logic instead of
 * being reimplemented per screen.
 */
export function sortByAllocationPriority<
  T extends { expiryDate?: string | undefined; receivedDate: string },
>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.expiryDate && b.expiryDate) return a.expiryDate.localeCompare(b.expiryDate);
    if (a.expiryDate) return -1;
    if (b.expiryDate) return 1;
    return a.receivedDate.localeCompare(b.receivedDate);
  });
}
