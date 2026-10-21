import type { DayInput, MoneyEntryInput, ProductDayInput } from "@bsd/domain";
import type { SheetReadResult } from "@bsd/importer";

/**
 * A made-up month for the demo seed when no workbook is given (no real data): eight drinks, three
 * DSRs and two managers over two busy days. `buildSeedPlan` reads it like a parsed month sheet.
 */
const PRODUCTS = [
  { id: "p1", name: "ড্রিংকো কোলা ২৫০ মিলি", carton: "24", order: "18", cost: "18", sale: "20" },
  { id: "p2", name: "ড্রিংকো কোলা ৫০০ মিলি", carton: "24", order: "32", cost: "32", sale: "35" },
  { id: "p3", name: "ড্রিংকো কোলা ১ লিটার", carton: "12", order: "55", cost: "55", sale: "60" },
  { id: "p4", name: "ড্রিংকো অরেঞ্জ ২৫০ মিলি", carton: "24", order: "18", cost: "18", sale: "20" },
  { id: "p5", name: "ড্রিংকো লেমন ৫০০ মিলি", carton: "24", order: "31", cost: "31", sale: "35" },
  { id: "p6", name: "ড্রিংকো এনার্জি ২৫০ মিলি", carton: "24", order: "36", cost: "36", sale: "40" },
  { id: "p7", name: "ড্রিংকো পানি ৫০০ মিলি", carton: "24", order: "12", cost: "12", sale: "15" },
  { id: "p8", name: "ড্রিংকো পানি ১.৫ লিটার", carton: "12", order: "22", cost: "22", sale: "25" },
] as const;

const DSRS = [
  { key: "d1", label: "মামুন" },
  { key: "d2", label: "রহিম" },
  { key: "d3", label: "করিম" },
];
const MANAGERS = [
  { key: "m1", label: "জামাল (ম্যানেজার)" },
  { key: "m2", label: "সুমন (হেল্পার)" },
];
const CATEGORIES = [
  { key: "c1", label: "অফিস খরচ" },
  { key: "c2", label: "পরিবহন খরচ" },
];

/** Opening stock in pieces: a few cartons each. */
const OPENING_STOCK: Record<string, string> = {
  p1: "480",
  p2: "360",
  p3: "144",
  p4: "240",
  p5: "240",
  p6: "192",
  p7: "480",
  p8: "180",
};

function day(date: string, n: number): DayInput {
  const products: Record<string, ProductDayInput> = {};
  for (const p of PRODUCTS) {
    const size = Number(p.carton);
    products[p.id] = {
      ordered: String(size * (n === 0 ? 10 : 6)),
      received: String(size * (n === 0 ? 8 : 6)),
      ...(p.id === "p1" ? { incentiveReceived: "24" } : {}),
    };
  }
  const dsrLines = DSRS.flatMap((d, i) =>
    PRODUCTS.filter((_, j) => (j + i + n) % 3 !== 2).map((p) => {
      const size = Number(p.carton);
      const issued = size * (2 + ((i + n) % 2));
      return {
        staffId: d.key,
        productId: p.id,
        issued: String(issued),
        returned: String(Math.floor(size / 3)),
      };
    }),
  );
  const money: MoneyEntryInput[] = [
    { kind: "expense", amount: n === 0 ? "1200" : "800", category: "c1" },
    { kind: "expense", amount: n === 0 ? "1500" : "1100", category: "c2" },
    { kind: "staffCostPaid", amount: "300", staffId: "d1", category: "c2" },
    { kind: "marketDueNew", amount: n === 0 ? "3500" : "2000" },
    { kind: "marketDueCollected", amount: n === 0 ? "1500" : "2500" },
    { kind: "supplierDeposit", amount: n === 0 ? "60000" : "40000" },
    { kind: "companyIncentive", amount: "2500" },
    { kind: "srIncentive", amount: "500" },
  ];
  return { date, products, dsrLines, money };
}

export function demoSheet(): SheetReadResult {
  return {
    sheet: "Demo",
    month: "2026-09",
    input: {
      products: PRODUCTS.map((p) => ({ id: p.id, piecesPerCarton: p.carton })),
      opening: {
        products: Object.fromEntries(
          PRODUCTS.map((p) => [
            p.id,
            {
              stock: OPENING_STOCK[p.id] ?? "0",
              dueFromCompany: p.id === "p2" ? "48" : "0",
              orderPrice: p.order,
              costPrice: p.cost,
              salePrice: p.sale,
            },
          ]),
        ),
        marketDue: { d1: "12000", d2: "8500", d3: "6000" },
        staff: {
          d1: { advance: "2000" },
          d2: { shortage: "500" },
          m1: { advance: "3000" },
        },
        companyPayable: "85000",
      },
      days: [day("2026-09-29", 0), day("2026-09-30", 1)],
    },
    expectations: [],
    products: PRODUCTS.map((p, i) => ({
      id: p.id,
      name: p.name,
      row: 7 + i,
      cartonSize: p.carton,
    })),
    persons: DSRS.map((d) => d.label),
    moneyColumns: [],
    people: [...DSRS, ...MANAGERS],
    categories: CATEGORIES,
    notes: [],
  };
}
