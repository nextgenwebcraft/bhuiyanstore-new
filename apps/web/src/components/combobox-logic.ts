import { matchesSearch, normalizeSearchText } from "@bsd/i18n";

/** One pickable entry of a Combobox; `searchText` adds hidden terms (phone, code, alias). */
export type ComboboxOption = {
  id: string;
  label: string;
  /** Muted second line (for a shop: mobile · address). */
  secondary?: string;
  /** Right-aligned figure (for a shop: its current due). */
  trailing?: string;
  tone?: "default" | "danger";
  searchText?: readonly string[];
};

/** A row of the open list: a real option, or the trailing "create this name" row. */
export type ComboboxItem =
  { kind: "option"; option: ComboboxOption } | { kind: "create"; text: string };

/**
 * Options matching the query (digit- and case-insensitive through `@bsd/i18n`, every term must
 * match). Matches that start with the query come first; otherwise the given order is kept.
 */
export function filterOptions(
  options: readonly ComboboxOption[],
  query: string,
  limit = 50,
): ComboboxOption[] {
  const needle = normalizeSearchText(query);
  const hits = options.filter((o) =>
    matchesSearch(query, [o.label, o.secondary ?? "", ...(o.searchText ?? [])]),
  );
  if (needle) {
    const starts = hits.filter((o) => normalizeSearchText(o.label).startsWith(needle));
    const rest = hits.filter((o) => !normalizeSearchText(o.label).startsWith(needle));
    return [...starts, ...rest].slice(0, limit);
  }
  return hits.slice(0, limit);
}

/** The option whose label equals the trimmed text exactly (the server matches names the same way). */
export function exactMatch(
  options: readonly ComboboxOption[],
  text: string,
): ComboboxOption | undefined {
  const name = text.trim();
  return name ? options.find((o) => o.label === name) : undefined;
}

/** The list rows for a query; the create row is last and only when no option matches exactly. */
export function buildItems(
  options: readonly ComboboxOption[],
  query: string,
  allowCreate: boolean,
  limit = 50,
): ComboboxItem[] {
  const items: ComboboxItem[] = filterOptions(options, query, limit).map((option) => ({
    kind: "option",
    option,
  }));
  const name = query.trim();
  if (allowCreate && name && !exactMatch(options, name)) items.push({ kind: "create", text: name });
  return items;
}

/**
 * The row highlighted when the list opens: the exact match, else none, so Enter never picks a
 * near match by accident while someone is typing a new name.
 */
export function initialActive(items: readonly ComboboxItem[], query: string): number {
  const name = query.trim();
  if (!name) return -1;
  return items.findIndex((i) => i.kind === "option" && i.option.label === name);
}

/** Arrow-key movement with wrap-around; from "none" (-1) Down goes to the first and Up to the last. */
export function moveActive(current: number, delta: 1 | -1, count: number): number {
  if (count === 0) return -1;
  if (current < 0) return delta === 1 ? 0 : count - 1;
  return (current + delta + count) % count;
}
