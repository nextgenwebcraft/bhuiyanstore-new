import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { createDatabase } from "@bsd/database";
import { toBaseQuantity, toCartonDisplay, toDecimal, todayBusinessDate } from "@bsd/domain";
import type { CompanyAccess } from "../access";
import { plain } from "../numeric";
import { runLedger } from "../ledger";
import { packOn } from "../products";

/**
 * One-time: move enough posted DSR takes from ব্যাচ ১ → ব্যাচ ২ on five RSO products so ব্যাচ ১
 * ends at 0 and ব্যাচ ২ holds the product total (owner 2026-11-15). Dry run by default;
 * `--apply` writes. Optional `--companyId=…` when more than one non-master company exists.
 *
 *   pnpm db:fix-rso-batch-stock
 *   pnpm db:fix-rso-batch-stock -- --apply
 */
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)), quiet: true });

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const companyArg = args.find((a) => a.startsWith("--companyId="))?.slice("--companyId=".length);

const TARGETS: { name: string; cartons: string; loose: string }[] = [
  { name: "Rso.500ml", cartons: "6", loose: "18" },
  { name: "RSO:1lt", cartons: "0", loose: "4" },
  { name: "RSO:2lt", cartons: "0", loose: "0" },
  { name: "RSO:3lt", cartons: "0", loose: "2" },
  { name: "RSO:5lt", cartons: "1", loose: "0" },
];

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DIRECT_URL or DATABASE_URL is not set");
const db = createDatabase(url);

function accessOf(company: {
  id: string;
  tenantId: string;
  legalEntityId: string;
  name: string;
  themePrimary: string;
  themePrimaryForeground: string;
  themeAccent: string | null;
  logoRef: string | null;
  blockNegativeStock: boolean;
  isMaster: boolean;
  status: string;
  modules: { module: string }[];
}): CompanyAccess {
  return { company, permissions: [], loginRoleKind: null };
}

function fmt(pieces: string, ppc: string): string {
  if (!/^-?\d+$/.test(pieces) || !/^[1-9]\d*$/.test(ppc) || ppc === "1") return pieces;
  const neg = pieces.startsWith("-");
  const { cartons, loosePieces } = toCartonDisplay(neg ? pieces.slice(1) : pieces, ppc);
  return `${neg ? "-" : ""}${cartons}/${loosePieces}`;
}

try {
  const companies = await db.company.findMany({
    where: {
      isMaster: false,
      status: "active",
      ...(companyArg ? { id: companyArg } : {}),
    },
    include: { modules: true },
    orderBy: { createdAt: "asc" },
  });
  if (companies.length === 0) throw new Error("No active company found");
  if (companies.length > 1 && !companyArg) {
    throw new Error(
      `Several companies: ${companies.map((c) => `${c.name}=${c.id}`).join(", ")}. Pass --companyId=…`,
    );
  }
  const company = companies[0];
  if (!company) throw new Error("No active company found");
  const access = accessOf(company);
  const today = todayBusinessDate();
  const run = await runLedger(db, access, today);
  if (!run) throw new Error("No live opening / ledger for this company");

  const lastDay = run.output.days.at(-1);
  if (!lastDay) throw new Error("Ledger has no days");

  const linesOut: string[] = [
    apply ? "APPLIED" : "DRY RUN",
    `company: ${company.name} (${company.id})`,
    `asOf: ${today}`,
  ];

  type Move = {
    lineId: string;
    fromKey: string;
    toKey: string;
    toSeq: number;
    movePieces: string;
    mode: "rekey" | "split" | "merge";
  };
  const moves: Move[] = [];

  for (const target of TARGETS) {
    const product = await db.product.findFirst({
      where: {
        companyId: company.id,
        OR: [
          { name: { equals: target.name, mode: "insensitive" } },
          { sku: { equals: target.name, mode: "insensitive" } },
        ],
      },
      include: { batches: { orderBy: { seq: "asc" } }, packs: true },
    });
    if (!product) {
      linesOut.push(`MISS ${target.name}: product not found`);
      continue;
    }
    const dayProduct = lastDay.products.find((p) => p.productId === product.id);
    if (!dayProduct) {
      linesOut.push(`MISS ${product.name}: not in day view`);
      continue;
    }
    const pack = packOn(product.packs, today);
    if (!pack) {
      linesOut.push(`MISS ${product.name}: no carton size`);
      continue;
    }
    const ppc = String(pack.piecesPerCarton);
    const want = toBaseQuantity(target.cartons, target.loose, ppc);
    const batches = dayProduct.batches;
    const b1 = batches.find((b) => b.seq === 1) ?? batches[0];
    const b2 = batches.find((b) => b.seq === 2) ?? batches[batches.length - 1];
    if (!b1 || !b2 || b1.key === b2.key) {
      linesOut.push(
        `${product.name}: need two batches (have ${batches.map((b) => `#${b.seq}=${fmt(b.quantity, ppc)}`).join(", ")})`,
      );
      continue;
    }
    const total = dayProduct.stock;
    const deficit = toDecimal(b1.quantity).lt(0) ? toDecimal(b1.quantity).neg() : toDecimal("0");
    linesOut.push(
      `${product.name}: stock=${fmt(total, ppc)} wantBatch2=${fmt(want, ppc)} ` +
        `b1=${fmt(b1.quantity, ppc)} b2=${fmt(b2.quantity, ppc)} deficit=${deficit.toString()}`,
    );
    if (!toDecimal(total).eq(toDecimal(want))) {
      linesOut.push(
        `  WARN product total ${fmt(total, ppc)} ≠ listed target ${fmt(want, ppc)} — will still clear b1 deficit onto b2`,
      );
    }
    if (deficit.isZero()) {
      linesOut.push(`  OK no deficit on batch 1`);
      continue;
    }

    const dbBatch1 = product.batches.find((b) => b.id === b1.key || b.seq === b1.seq);
    const dbBatch2 = product.batches.find((b) => b.id === b2.key || b.seq === b2.seq);
    if (!dbBatch1 || !dbBatch2) {
      linesOut.push(`  FAIL stored product_batch rows missing for engine keys`);
      continue;
    }

    const lines = await db.dsrLine.findMany({
      where: {
        productId: product.id,
        batchKey: dbBatch1.id,
        dsrDay: { companyId: company.id, status: "posted" },
      },
      include: { dsrDay: { select: { date: true, status: true } } },
      orderBy: [{ dsrDay: { date: "desc" } }, { id: "asc" }],
    });

    let left = deficit;
    for (const line of lines) {
      if (left.lte(0)) break;
      const issued = toDecimal(plain(line.issued));
      const returned = toDecimal(plain(line.returned));
      const net = issued.sub(returned);
      if (net.lte(0)) continue;
      const moveQty = DecimalMin(net, left);
      const sibling = await db.dsrLine.findFirst({
        where: {
          dsrDayId: line.dsrDayId,
          dsrStaffId: line.dsrStaffId,
          productId: line.productId,
          batchKey: dbBatch2.id,
        },
      });
      if (moveQty.eq(net) && !sibling) {
        moves.push({
          lineId: line.id,
          fromKey: dbBatch1.id,
          toKey: dbBatch2.id,
          toSeq: dbBatch2.seq,
          movePieces: moveQty.toString(),
          mode: "rekey",
        });
        linesOut.push(
          `  rekey line ${line.id} net=${moveQty.toString()} → batch ${dbBatch2.seq} (${String(line.dsrDay.date).slice(0, 10)})`,
        );
      } else if (moveQty.eq(net) && sibling) {
        moves.push({
          lineId: line.id,
          fromKey: dbBatch1.id,
          toKey: dbBatch2.id,
          toSeq: dbBatch2.seq,
          movePieces: moveQty.toString(),
          mode: "merge",
        });
        linesOut.push(
          `  merge line ${line.id} into ${sibling.id} net=${moveQty.toString()} (${String(line.dsrDay.date).slice(0, 10)})`,
        );
      } else {
        // Partial: only when returned is zero so issued can shrink cleanly.
        if (!returned.isZero()) {
          linesOut.push(
            `  SKIP split line ${line.id}: has returns; move whole lines only (net=${net.toString()})`,
          );
          continue;
        }
        moves.push({
          lineId: line.id,
          fromKey: dbBatch1.id,
          toKey: dbBatch2.id,
          toSeq: dbBatch2.seq,
          movePieces: moveQty.toString(),
          mode: "split",
        });
        linesOut.push(
          `  split line ${line.id}: move ${moveQty.toString()} of ${issued.toString()} → batch ${dbBatch2.seq}`,
        );
      }
      left = left.sub(moveQty);
    }
    if (left.gt(0)) {
      linesOut.push(
        `  FAIL still short ${left.toString()} pcs to clear batch 1 (not enough positive net on batch 1 lines)`,
      );
    }
  }

  if (apply && moves.length > 0) {
    await db.$transaction(async (tx) => {
      for (const m of moves) {
        const line = await tx.dsrLine.findUniqueOrThrow({ where: { id: m.lineId } });
        const sibling = await tx.dsrLine.findFirst({
          where: {
            dsrDayId: line.dsrDayId,
            dsrStaffId: line.dsrStaffId,
            productId: line.productId,
            batchKey: m.toKey,
            id: { not: line.id },
          },
        });
        if (m.mode === "rekey") {
          await tx.dsrLine.update({
            where: { id: line.id },
            data: { batchKey: m.toKey, batchSeq: m.toSeq },
          });
        } else if (m.mode === "merge") {
          if (!sibling) throw new Error(`merge missing sibling for ${line.id}`);
          await tx.dsrLine.update({
            where: { id: sibling.id },
            data: {
              issued: toDecimal(plain(sibling.issued))
                .add(toDecimal(plain(line.issued)))
                .toString(),
              returned: toDecimal(plain(sibling.returned))
                .add(toDecimal(plain(line.returned)))
                .toString(),
              damaged: toDecimal(plain(sibling.damaged))
                .add(toDecimal(plain(line.damaged)))
                .toString(),
              commission: toDecimal(plain(sibling.commission))
                .add(toDecimal(plain(line.commission)))
                .toString(),
            },
          });
          await tx.dsrPriceSplit.deleteMany({ where: { lineId: line.id } });
          await tx.dsrLine.delete({ where: { id: line.id } });
        } else {
          const move = toDecimal(m.movePieces);
          await tx.dsrLine.update({
            where: { id: line.id },
            data: { issued: toDecimal(plain(line.issued)).sub(move).toString() },
          });
          if (sibling) {
            await tx.dsrLine.update({
              where: { id: sibling.id },
              data: { issued: toDecimal(plain(sibling.issued)).add(move).toString() },
            });
          } else {
            await tx.dsrLine.create({
              data: {
                dsrDayId: line.dsrDayId,
                dsrStaffId: line.dsrStaffId,
                productId: line.productId,
                piecesPerCarton: line.piecesPerCarton,
                issued: move.toString(),
                returned: "0",
                damaged: "0",
                commission: "0",
                batchKey: m.toKey,
                batchSeq: m.toSeq,
                costPrice: line.costPrice,
                salePrice: line.salePrice,
                damageRate: null,
              },
            });
          }
        }
      }
    });

    const after = await runLedger(db, access, today);
    const afterDay = after?.output.days.at(-1);
    linesOut.push("After apply:");
    for (const target of TARGETS) {
      const product = await db.product.findFirst({
        where: {
          companyId: company.id,
          OR: [
            { name: { equals: target.name, mode: "insensitive" } },
            { sku: { equals: target.name, mode: "insensitive" } },
          ],
        },
        include: { packs: true },
      });
      if (!product || !afterDay) continue;
      const row = afterDay.products.find((p) => p.productId === product.id);
      if (!row) continue;
      const pack = packOn(product.packs, today);
      if (!pack) continue;
      const ppc = String(pack.piecesPerCarton);
      const want = toBaseQuantity(target.cartons, target.loose, ppc);
      const b2 = row.batches.find((b) => b.seq === 2) ?? row.batches.at(-1);
      const neg = row.batches.filter((b) => b.quantity.startsWith("-"));
      linesOut.push(
        `  ${product.name}: stock=${fmt(row.stock, ppc)} batch2=${b2 ? fmt(b2.quantity, ppc) : "—"} ` +
          `want=${fmt(want, ppc)} negativeBatches=${neg.length}`,
      );
    }

    const closes = await db.monthClose.findMany({ where: { companyId: company.id } });
    if (closes.length > 0) {
      linesOut.push(
        `NOTE: ${closes.length} month_close row(s) exist — reopen/reclose if closing batch snapshots must match.`,
      );
    }
  } else if (!apply) {
    linesOut.push(`Planned moves: ${moves.length}. Re-run with --apply to write.`);
  } else {
    linesOut.push("Nothing to apply.");
  }

  process.stdout.write(`${linesOut.join("\n")}\n`);
} finally {
  await db.$disconnect();
}

function DecimalMin(a: ReturnType<typeof toDecimal>, b: ReturnType<typeof toDecimal>) {
  return a.lt(b) ? a : b;
}
