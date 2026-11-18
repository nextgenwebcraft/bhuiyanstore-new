import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { createDatabase } from "@bsd/database";
import { toCartonDisplay, toDecimal, todayBusinessDate } from "@bsd/domain";
import type { CompanyAccess } from "../access";
import { plain } from "../numeric";
import { runLedger } from "../ledger";
import { packOn } from "../products";

/**
 * Clear negative named batches by re-keying / splitting / merging posted DSR lines onto the
 * next positive batch of the same product (total product stock unchanged). Dry run by default.
 *
 *   pnpm db:fix-negative-batch-stock -- --companyId=…
 *   pnpm db:fix-negative-batch-stock -- --companyId=… --apply
 */
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)), quiet: true });

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const companyArg = args.find((a) => a.startsWith("--companyId="))?.slice("--companyId=".length);

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

function DecimalMin(a: ReturnType<typeof toDecimal>, b: ReturnType<typeof toDecimal>) {
  return a.lt(b) ? a : b;
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
  if (!run) throw new Error("No live opening / ledger");
  const lastDay = run.output.days.at(-1);
  if (!lastDay) throw new Error("Ledger has no days");

  const linesOut: string[] = [
    apply ? "APPLIED" : "DRY RUN",
    `company: ${company.name} (${company.id})`,
    `asOf: ${today}`,
  ];

  type Move = {
    lineId: string;
    toKey: string;
    toSeq: number;
    movePieces: string;
    mode: "rekey" | "split" | "merge";
  };
  const moves: Move[] = [];

  for (const dayProduct of lastDay.products) {
    const negBatches = dayProduct.batches.filter((b) => toDecimal(b.quantity).lt(0));
    if (negBatches.length === 0) continue;
    const product = await db.product.findUnique({
      where: { id: dayProduct.productId },
      include: { batches: { orderBy: { seq: "asc" } }, packs: true },
    });
    if (!product) continue;
    const pack = packOn(product.packs, today);
    const ppc = String(pack?.piecesPerCarton ?? 1);

    for (const neg of negBatches) {
      const donor = dayProduct.batches.find((b) => b.seq > neg.seq && toDecimal(b.quantity).gt(0));
      const deficit = toDecimal(neg.quantity).neg();
      linesOut.push(
        `${product.name}: total=${fmt(dayProduct.stock, ppc)} ` +
          `neg#${neg.seq}=${fmt(neg.quantity, ppc)} ` +
          `donor=${donor ? `#${donor.seq}=${fmt(donor.quantity, ppc)}` : "none"}`,
      );
      if (!donor) {
        linesOut.push(`  FAIL no later positive batch to cover deficit ${deficit.toString()}`);
        continue;
      }
      if (toDecimal(donor.quantity).lt(deficit)) {
        linesOut.push(`  FAIL donor short: need ${deficit.toString()} have ${donor.quantity}`);
        continue;
      }
      const dbNeg = product.batches.find((b) => b.id === neg.key || b.seq === neg.seq);
      const dbDonor = product.batches.find((b) => b.id === donor.key || b.seq === donor.seq);
      if (!dbNeg || !dbDonor) {
        linesOut.push(`  FAIL stored product_batch rows missing`);
        continue;
      }

      const lines = await db.dsrLine.findMany({
        where: {
          productId: product.id,
          batchKey: dbNeg.id,
          dsrDay: { companyId: company.id, status: "posted" },
        },
        include: { dsrDay: { select: { date: true } } },
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
            batchKey: dbDonor.id,
          },
        });
        if (moveQty.eq(net) && !sibling) {
          moves.push({
            lineId: line.id,
            toKey: dbDonor.id,
            toSeq: dbDonor.seq,
            movePieces: moveQty.toString(),
            mode: "rekey",
          });
          linesOut.push(
            `  rekey ${line.id} net=${moveQty.toString()} → #${dbDonor.seq} (${String(line.dsrDay.date).slice(0, 10)})`,
          );
        } else if (moveQty.eq(net) && sibling) {
          moves.push({
            lineId: line.id,
            toKey: dbDonor.id,
            toSeq: dbDonor.seq,
            movePieces: moveQty.toString(),
            mode: "merge",
          });
          linesOut.push(
            `  merge ${line.id} → ${sibling.id} net=${moveQty.toString()} (${String(line.dsrDay.date).slice(0, 10)})`,
          );
        } else {
          if (!returned.isZero()) {
            linesOut.push(`  SKIP split ${line.id}: has returns (net=${net.toString()})`);
            continue;
          }
          moves.push({
            lineId: line.id,
            toKey: dbDonor.id,
            toSeq: dbDonor.seq,
            movePieces: moveQty.toString(),
            mode: "split",
          });
          linesOut.push(
            `  split ${line.id}: move ${moveQty.toString()} of ${issued.toString()} → #${dbDonor.seq}`,
          );
        }
        left = left.sub(moveQty);
      }
      if (left.gt(0)) {
        linesOut.push(`  FAIL still short ${left.toString()} pcs after scanning lines`);
      }
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
              issued: toDecimal(plain(sibling.issued)).add(plain(line.issued)).toString(),
              returned: toDecimal(plain(sibling.returned)).add(plain(line.returned)).toString(),
              damaged: toDecimal(plain(sibling.damaged)).add(plain(line.damaged)).toString(),
              commission: toDecimal(plain(sibling.commission))
                .add(plain(line.commission))
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
    for (const p of afterDay?.products ?? []) {
      const neg = p.batches.filter((b) => b.quantity.startsWith("-"));
      if (neg.length === 0 && !p.stock.startsWith("-")) continue;
      linesOut.push(`  still neg product ${p.productId} stock=${p.stock}`);
    }
    const still = (afterDay?.products ?? []).some(
      (p) => p.batches.some((b) => b.quantity.startsWith("-")) || p.stock.startsWith("-"),
    );
    if (!still) linesOut.push("  OK no negative batches remain");
  } else if (!apply) {
    linesOut.push(`Planned moves: ${moves.length}. Re-run with --apply to write.`);
  } else {
    linesOut.push("Nothing to apply.");
  }

  process.stdout.write(`${linesOut.join("\n")}\n`);
} finally {
  await db.$disconnect();
}
