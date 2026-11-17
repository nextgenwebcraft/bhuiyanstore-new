const BENGALI_DIGIT_ZERO = 0x09e6;

/**
 * Converts Bengali digits (০-৯) to Latin digits and applies Unicode NFC, so number fields
 * accept either script before decimal validation (guide section 5.1.1).
 */
export function normalizeDigits(input: string): string {
  return input
    .normalize("NFC")
    .replace(/[\u09E6-\u09EF]/g, (digit) => String(digit.charCodeAt(0) - BENGALI_DIGIT_ZERO));
}

/**
 * Digits plus a single decimal point for money fields: Bengali danda / Arabic decimal → `.`,
 * thousand commas stripped. Trailing `.` kept so the caller can treat it as "still typing".
 */
export function normalizeMoneyInput(input: string): string {
  return normalizeDigits(input)
    .replace(/[\u0964\u066B]/g, ".")
    .replace(/,/g, "")
    .trim();
}

/**
 * Parses a taka amount for live diff / save. Accepts `123`, `123.4`, `123.45`, and a trailing
 * `123.` (treated as `123` so পার্থক্য does not disappear while typing the dot).
 */
export function parseAmountInput(input: string): string | null {
  const raw = normalizeMoneyInput(input);
  if (!raw) return null;
  if (/^\d+\.$/.test(raw)) return raw.slice(0, -1);
  if (/^\d+(\.\d{1,2})?$/.test(raw)) return raw;
  return null;
}

/** Converts Latin digits to Bengali digits for display. */
export function toBengaliDigits(input: string): string {
  return input.replace(/[0-9]/g, (digit) =>
    String.fromCharCode(BENGALI_DIGIT_ZERO + Number(digit)),
  );
}
