/**
 * Postgres DATE (UTC midnight) conversion. Business-date arithmetic (today, month helpers) is
 * owned by `@bsd/domain` dates (D08).
 */
export function toDbDate(businessDate: string): Date {
  return new Date(`${businessDate}T00:00:00.000Z`);
}

export function fromDbDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
