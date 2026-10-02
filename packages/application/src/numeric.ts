export type DecimalLike = { toFixed(): string };

/** NUMERIC as a plain decimal string ("100.000000" → "100", "23.480000" → "23.48"). */
export function plain(value: DecimalLike): string;
export function plain(value: DecimalLike | null): string | null;
export function plain(value: DecimalLike | null): string | null {
  if (value === null) return null;
  return value
    .toFixed()
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}
