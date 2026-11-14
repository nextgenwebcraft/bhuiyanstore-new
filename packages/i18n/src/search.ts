import { normalizeDigits } from "./digits";

/**
 * Canonical form for client-side search matching (guide section 5.1.1): Unicode NFC,
 * Bengali digits as Latin, case-folded, whitespace collapsed.
 */
export function normalizeSearchText(input: string): string {
  return normalizeDigits(input).toLocaleLowerCase("en").replace(/\s+/g, " ").trim();
}

/** True when every whitespace-separated term of the query occurs in one of the candidates. */
export function matchesSearch(query: string, candidates: readonly string[]): boolean {
  const terms = normalizeSearchText(query).split(" ").filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = candidates.map(normalizeSearchText).join(" ");
  return terms.every((term) => haystack.includes(term));
}
