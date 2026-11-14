import { describe, expect, it } from "vitest";
import {
  buildItems,
  exactMatch,
  filterOptions,
  initialActive,
  moveActive,
  type ComboboxOption,
} from "./combobox-logic";

const options: ComboboxOption[] = [
  { id: "1", label: "আলফা স্টোর", secondary: "রহিম · বাজার রোড", trailing: "১০০" },
  { id: "2", label: "বিটা ভান্ডার", secondary: "করিম · স্টেশন রোড", searchText: ["01711"] },
  { id: "3", label: "গামা স্টোর ২", secondary: "জামাল · বাজার রোড" },
  { id: "4", label: "Delta Store 10" },
];

describe("filterOptions", () => {
  it("returns everything for an empty query", () => {
    expect(filterOptions(options, "  ")).toHaveLength(4);
  });

  it("matches label, secondary and hidden search text", () => {
    expect(filterOptions(options, "বিটা").map((o) => o.id)).toEqual(["2"]);
    expect(filterOptions(options, "বাজার").map((o) => o.id)).toEqual(["1", "3"]);
    expect(filterOptions(options, "01711").map((o) => o.id)).toEqual(["2"]);
  });

  it("treats Bangla and Latin digits alike and ignores case", () => {
    expect(filterOptions(options, "স্টোর 2").map((o) => o.id)).toEqual(["3"]);
    expect(filterOptions(options, "স্টোর ২").map((o) => o.id)).toEqual(["3"]);
    expect(filterOptions(options, "delta ১০").map((o) => o.id)).toEqual(["4"]);
    expect(filterOptions(options, "DELTA").map((o) => o.id)).toEqual(["4"]);
  });

  it("puts names that start with the query first", () => {
    const list: ComboboxOption[] = [
      { id: "a", label: "পুরনো স্টোর" },
      { id: "b", label: "স্টোর নতুন" },
    ];
    expect(filterOptions(list, "স্টোর").map((o) => o.id)).toEqual(["b", "a"]);
  });

  it("caps the number of rows", () => {
    expect(filterOptions(options, "", 2)).toHaveLength(2);
  });
});

describe("exactMatch and buildItems", () => {
  it("finds an exact trimmed name only", () => {
    expect(exactMatch(options, "  আলফা স্টোর ")?.id).toBe("1");
    expect(exactMatch(options, "আলফা")).toBeUndefined();
    expect(exactMatch(options, "   ")).toBeUndefined();
  });

  it("adds the create row last when there is no exact match", () => {
    const items = buildItems(options, "আলফা", true);
    expect(items.map((i) => i.kind)).toEqual(["option", "create"]);
    expect(items.at(-1)).toEqual({ kind: "create", text: "আলফা" });
  });

  it("offers no create row for an exact match, an empty query or when disabled", () => {
    expect(buildItems(options, "আলফা স্টোর", true).some((i) => i.kind === "create")).toBe(false);
    expect(buildItems(options, "  ", true).some((i) => i.kind === "create")).toBe(false);
    expect(buildItems(options, "নতুন", false)).toEqual([]);
  });

  it("still offers the create row when nothing matches", () => {
    expect(buildItems(options, "কিছুই নেই", true)).toEqual([{ kind: "create", text: "কিছুই নেই" }]);
  });
});

describe("keyboard helpers", () => {
  it("highlights only an exact match when the list opens", () => {
    expect(initialActive(buildItems(options, "আলফা স্টোর", true), "আলফা স্টোর")).toBe(0);
    expect(initialActive(buildItems(options, "আলফা", true), "আলফা")).toBe(-1);
    expect(initialActive(buildItems(options, "", true), "")).toBe(-1);
  });

  it("moves with wrap-around", () => {
    expect(moveActive(-1, 1, 3)).toBe(0);
    expect(moveActive(-1, -1, 3)).toBe(2);
    expect(moveActive(2, 1, 3)).toBe(0);
    expect(moveActive(0, -1, 3)).toBe(2);
    expect(moveActive(0, 1, 0)).toBe(-1);
  });
});
