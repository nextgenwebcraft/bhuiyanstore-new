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

/** Converts Latin digits to Bengali digits for display. */
export function toBengaliDigits(input: string): string {
  return input.replace(/[0-9]/g, (digit) =>
    String.fromCharCode(BENGALI_DIGIT_ZERO + Number(digit)),
  );
}
