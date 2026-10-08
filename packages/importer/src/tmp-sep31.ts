import { computeMonth } from "@bsd/domain";
import ExcelJS from "exceljs";
import { readMonthSheet } from "./month-sheet";

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile("../../docs/Drinko 2026 Oct.xlsx");
  const sep = readMonthSheet(wb, "Sep 2026", { extraBlocks: "lastDay" });
  const oct = readMonthSheet(wb, "Oct 2026");
  const out = computeMonth(sep.input);
  let diffs = 0;
  for (const p of sep.products) {
    const a = out.closing.products[p.id];
    const b = oct.input.opening.products[p.id];
    for (const f of ["stock", "dueFromCompany"] as const) {
      if (String(a?.[f] ?? "0") !== String(b?.[f] ?? "0")) {
        diffs++;
        console.log("diff", p.name, f, a?.[f], b?.[f]);
      }
    }
  }
  console.log("stock/due differences Sep close vs Oct opening:", diffs);
  console.log("Sep notes:", sep.notes.filter((n) => n.includes("after day")).join(" | "));
  const aug = readMonthSheet(wb, "Aug 2026");
  const augOut = computeMonth(aug.input);
  let d2 = 0;
  for (const p of aug.products) {
    const a = augOut.closing.products[p.id];
    const b = sep.input.opening.products[p.id];
    if (String(a?.stock ?? "0") !== String(b?.stock ?? "0")) {
      d2++;
      console.log("aug→sep diff", p.name, a?.stock, b?.stock);
    }
  }
  console.log(
    "Aug close vs Sep opening stock differences:",
    d2,
    "aug notes:",
    aug.notes.join(" | "),
  );
}

void main();
