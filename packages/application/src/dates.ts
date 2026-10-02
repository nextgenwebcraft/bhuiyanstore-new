/** Business dates are calendar days in Asia/Dhaka (D08), stored as Postgres DATE (UTC midnight). */
const dhakaDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Dhaka",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function todayInDhaka(now = new Date()): string {
  return dhakaDay.format(now);
}

export function toDbDate(businessDate: string): Date {
  return new Date(`${businessDate}T00:00:00.000Z`);
}

export function fromDbDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
