import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "@bsd/database";
import { getDayView } from "../daily";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
config({ path: resolve(root, ".env"), quiet: true });
const db = createDatabase(process.env.DIRECT_URL ?? "");
const admin = await db.user.findFirstOrThrow({ where: { isSuperAdmin: true, active: true } });
const ctx = {
  db,
  actor: {
    userId: admin.id,
    tenantId: admin.tenantId ?? "",
    isSuperAdmin: true,
    mustChangePassword: false,
  },
  requestId: "auto-check",
};
const companies = await db.company.findMany({
  where: { status: "active", isMaster: false },
  select: { id: true, name: true },
});
for (const c of companies) {
  for (const date of ["2026-10-02", "2026-10-22"]) {
    const view = await getDayView(ctx, c.id, date);
    const auto = view.products.flatMap((p) =>
      p.batches
        .filter((b) => b.key.startsWith("auto:"))
        .map((b) => `${p.productName} ${b.key} q=${b.quantity} cost=${b.costPrice}`),
    );
    const drinko = view.products.find((p) => p.productName.includes("250"));
    console.log(c.name, date, "auto:", auto.length ? auto : "none");
    if (drinko) {
      console.log(
        "  ",
        drinko.productName,
        drinko.batches.map((b) => `${b.key.slice(0, 8)}#${b.seq} q=${b.quantity} cost=${b.costPrice}`),
      );
    }
  }
}
await db.$disconnect();
