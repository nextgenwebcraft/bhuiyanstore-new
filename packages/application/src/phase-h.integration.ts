import { bootstrapSuperAdmin, type Actor } from "@bsd/auth";
import type { ImportJob, PermissionId } from "@bsd/contracts";
import { syntheticWorkbook } from "@bsd/importer/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRole, createUser } from "./administration";
import { createCompany } from "./companies";
import { expenseCategories, staffRoles } from "./configuration";
import type { AppContext } from "./context";
import { getDayView, listMoneyEntries, listStockEntries } from "./daily";
import { AppError } from "./errors";
import {
  commitImportJob,
  createImportJob,
  discardImportJob,
  getImportJob,
  inspectImportWorkbook,
  listImportJobs,
  saveImportMapping,
} from "./imports";
import { getMonthView } from "./month";
import { activateOpening, approveOpening, getOpening, saveOpening } from "./opening";
import { createProduct } from "./products";
import { createStaff } from "./staff";
import { contextFor, resetTestSchema, testDatabase } from "./test-support";

process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-integration-test-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

const { db, schema } = testDatabase();

let admin: Actor;
let ctx: AppContext;
let workbook: Uint8Array;
const live = { company: "", alpha: "", beta: "", mamun: "", rohim: "", office: "" };
const fresh = { company: "", alpha: "", beta: "", mamun: "", rohim: "", karim: "" };

function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected a value");
  return value;
}

async function expectField(promise: Promise<unknown>, path: string, code: string) {
  await expect(promise).rejects.toSatisfy(
    (e) =>
      e instanceof AppError &&
      e.code === "VALIDATION_FAILED" &&
      e.fieldErrors?.[0]?.path === path &&
      e.fieldErrors?.[0]?.code === code,
  );
}

async function expectForbidden(promise: Promise<unknown>) {
  await expect(promise).rejects.toSatisfy((e) => e instanceof AppError && e.code === "FORBIDDEN");
}

let userCount = 0;
async function userWith(company: string, permissions: PermissionId[]): Promise<AppContext> {
  userCount += 1;
  const role = await createRole(ctx, { name: `Phase H role ${userCount}`, permissions });
  const user = await createUser(ctx, {
    name: `User ${userCount}`,
    email: `h.user${userCount}@example.test`,
    password: "temporary-Password-1",
    memberships: [{ companyId: company, roleIds: [role.id] }],
  });
  return contextFor(db, {
    userId: user.id,
    tenantId: admin.tenantId,
    isSuperAdmin: false,
    mustChangePassword: false,
  });
}

const codes = (job: ImportJob) => job.issues.map((i) => i.code);
const upload = (company: string) =>
  createImportJob(ctx, company, { data: workbook, fileName: "book.xlsx", sheet: "Sep 2026" });

beforeAll(async () => {
  await resetTestSchema(db, schema);
  const boot = await bootstrapSuperAdmin(db, {
    tenantName: "Test Distributor",
    adminEmail: "admin@example.test",
    adminName: "Admin",
    adminPassword: "one-time-Password-123",
  });
  await db.user.update({ where: { id: boot.adminId }, data: { mustChangePassword: false } });
  admin = {
    userId: boot.adminId,
    tenantId: boot.tenantId,
    isSuperAdmin: true,
    mustChangePassword: false,
  };
  ctx = contextFor(db, admin);
  workbook = new Uint8Array(
    await syntheticWorkbook({ sheet: "Sep 2026", previous: "Aug 2026" }).xlsx.writeBuffer(),
  );

  const roles = await staffRoles.list(ctx);
  const role = (kind: string) => must(roles.find((r) => r.kind === kind)).id;
  const theme = { primary: "#0F766E", primaryForeground: "#FFFFFF" };
  const setup = async (name: string) => {
    const company = (await createCompany(ctx, { name, theme, modules: ["sales"] })).company.id;
    const product = async (sku: string, productName: string, piecesPerCarton: string) =>
      (
        await createProduct(ctx, company, {
          sku,
          name: productName,
          aliases: [],
          baseUnit: "piece",
          piecesPerCarton,
          status: "active",
        })
      ).id;
    const person = async (personName: string, kind: string, employer: "distributor" | "supplier") =>
      (
        await createStaff(ctx, company, {
          name: personName,
          employer,
          status: "active",
          assignment: { roleId: role(kind), from: "2026-01-01", to: null },
        })
      ).id;
    return {
      company,
      alpha: await product("A250", "Alpha 250ml", "24"),
      beta: await product("B1", "Beta 1lt", "1"),
      mamun: await person(`Mamun ${name}`, "dsr", "distributor"),
      rohim: await person(`Rohim ${name}`, "general", "distributor"),
      person,
    };
  };

  const a = await setup("Drinko");
  Object.assign(live, { company: a.company, alpha: a.alpha, beta: a.beta });
  live.mamun = a.mamun;
  live.rohim = a.rohim;
  live.office = (await expenseCategories.create(ctx, { name: "Office", active: true })).id;
  const empty = await getOpening(ctx, live.company);
  const stock = (
    productId: string,
    pieces: string,
    prices: [string, string, string],
    due: string,
  ) => ({
    productId,
    pieces,
    orderPrice: prices[0],
    unitCost: prices[1],
    salePrice: prices[2],
    dueFromCompany: due,
    note: "",
  });
  const saved = await saveOpening(ctx, live.company, {
    version: empty.version,
    cutoffDate: "2026-09-01",
    stock: [
      stock(live.alpha, "100", ["10", "9.5", "11"], "5"),
      stock(live.beta, "0", ["20", "19", "22.5"], "0"),
    ],
    balances: [{ kind: "market_due", staffId: null, cashAccountId: null, amount: "20", note: "" }],
  });
  const approved = await approveOpening(ctx, live.company, { version: saved.version });
  await activateOpening(ctx, live.company, { version: approved.version });

  const b = await setup("Fresh");
  Object.assign(fresh, { company: b.company, alpha: b.alpha, beta: b.beta });
  fresh.mamun = b.mamun;
  fresh.rohim = b.rohim;
  fresh.karim = await b.person("Karim Fresh", "sr", "supplier");
});

afterAll(async () => {
  await db.$disconnect();
});

describe("Phase H: Excel month import into documents", () => {
  let job: ImportJob;

  it("lists month sheets, then reads one: compared with Excel and mapped by name", async () => {
    expect(await inspectImportWorkbook(ctx, live.company, workbook)).toEqual({
      sheets: ["Sep 2026", "Aug 2026"],
    });
    job = await upload(live.company);
    expect(job).toMatchObject({ status: "ready", month: "2026-09", mode: "documents" });
    expect(job.unexplained).toBe(0);
    expect(job.checks.every((c) => c.matched === c.compared)).toBe(true);
    expect(job.checks.find((c) => c.check === "Daily cash left (Total Amount)")?.matched).toBe(2);
    expect(job.products.map((p) => [p.label, p.productId, p.active])).toEqual([
      ["Alpha 250ml", live.alpha, true],
      ["Beta 1lt", live.beta, true],
    ]);
    expect(job.people.map((p) => [p.label, p.staffId])).toEqual([
      ["Mamun", null],
      ["SR Rohim", null],
    ]);
    expect(job.categories).toEqual([
      { key: "operating", label: "Operating Cost", categoryId: null },
    ]);
    expect(codes(job)).toEqual(
      expect.arrayContaining([
        "import.issue.personUnmapped",
        "import.issue.categoryUnmapped",
        "import.issue.openingDiffers",
      ]),
    );
    expect(job.openingDifferences).toEqual([
      { kind: "marketDue", label: "", system: "20", sheet: "25" },
    ]);
    expect(job.canCommit).toBe(false);
    expect((await listImportJobs(ctx, live.company)).map((j) => j.id)).toEqual([job.id]);
  });

  it("saves the owner's mapping at the version reviewed", async () => {
    const mapping = {
      products: { p7: live.alpha, p9: live.beta },
      staff: { mamun: live.mamun, "sr rohim": live.rohim },
      categories: { operating: live.office },
    };
    await expectField(
      saveImportMapping(ctx, live.company, job.id, {
        version: job.version,
        mapping: { ...mapping, staff: { mamun: live.company } },
      }),
      "mapping.staff.mamun",
      "validation.import.unknownTarget",
    );
    job = await saveImportMapping(ctx, live.company, job.id, { version: job.version, mapping });
    await expectField(
      saveImportMapping(ctx, live.company, job.id, { version: job.version - 1, mapping }),
      "version",
      "validation.import.stale",
    );
    expect(job.issues).toEqual([
      { code: "import.issue.openingDiffers", severity: "warning", detail: "1" },
    ]);
    expect(job.documents).toEqual({ stockEntries: 1, prices: 7, dsrDays: 2, moneyEntries: 5 });
    expect(job.canCommit).toBe(true);
  });

  it("needs the posting permissions and an explicit acceptance of the differences", async () => {
    const closer = await userWith(live.company, ["period.close"]);
    await expectForbidden(
      commitImportJob(closer, live.company, job.id, {
        version: job.version,
        mode: "documents",
        acceptDifferences: true,
      }),
    );
    await expectForbidden(
      getImportJob(await userWith(live.company, ["report.view"]), live.company, job.id),
    );
    await expectField(
      commitImportJob(ctx, live.company, job.id, { version: job.version, mode: "documents" }),
      "acceptDifferences",
      "validation.import.acceptDifferences",
    );
    await expectField(
      commitImportJob(ctx, live.company, job.id, {
        version: job.version,
        mode: "opening",
        openingVersion: 0,
        acceptDifferences: true,
      }),
      "mode",
      "validation.import.mode",
    );
  });

  it("posts the month as documents, reproduces the sheet and closes the month", async () => {
    job = await commitImportJob(ctx, live.company, job.id, {
      version: job.version,
      mode: "documents",
      acceptDifferences: true,
    });
    expect(job).toMatchObject({
      status: "committed",
      committedMode: "documents",
      canCommit: false,
    });

    const day1 = await getDayView(ctx, live.company, "2026-09-01");
    expect(day1.money).toMatchObject({ sales: "528", cashLeft: "438" });
    const day2 = await getDayView(ctx, live.company, "2026-09-02");
    expect(day2.money).toMatchObject({ sales: "270", cashLeft: "250", expenses: "30" });
    expect(day2.products.find((p) => p.productId === live.alpha)?.salePrice).toBe("12");

    const month = await getMonthView(ctx, live.company, "2026-09");
    expect(month.status).toBe("closed");
    expect(month.totals.salesTotal).toBe("798");
    expect(month.marketDue.closing).toBe("70");
    const closing = Object.fromEntries(month.products.map((p) => [p.productId, p.closingStock]));
    expect(closing).toEqual({ [live.alpha]: "100", [live.beta]: "-12" });
    expect(month.staff.find((s) => s.staffId === live.rohim)?.owesUs).toBe("30");

    const stock = await listStockEntries(ctx, live.company, "2026-09-01");
    expect(stock.map((s) => [s.kind, s.pieces])).toEqual([["receipt", "48"]]);
    const stockRows = await ctx.db.stockEntry.findMany({ where: { companyId: live.company } });
    expect(stockRows.map((r) => r.reference)).toEqual([`import:${job.id}`]);
    const money = await listMoneyEntries(ctx, live.company, {
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(money).toHaveLength(5);
    const moneyRows = await ctx.db.moneyEntry.findMany({ where: { companyId: live.company } });
    expect(moneyRows.every((m) => m.reference === `import:${job.id}`)).toBe(true);
  });

  it("refuses a second commit and a closed month", async () => {
    await expectField(
      commitImportJob(ctx, live.company, job.id, {
        version: job.version,
        mode: "documents",
        acceptDifferences: true,
      }),
      "",
      "validation.import.notReady",
    );
    const again = await upload(live.company);
    expect(codes(again)).toContain("validation.month.alreadyClosed");
    expect(again.canCommit).toBe(false);
    const discarded = await discardImportJob(ctx, live.company, again.id, {
      version: again.version,
    });
    expect(discarded.status).toBe("discarded");
  });
});

describe("Phase H: a month before go-live becomes the draft opening", () => {
  let job: ImportJob;

  it("offers the opening mode while no opening is active", async () => {
    job = await upload(fresh.company);
    expect(job).toMatchObject({ mode: "opening", openingVersion: 0 });
    expect(job.products.map((p) => p.productId)).toEqual([fresh.alpha, fresh.beta]);
  });

  it("refuses a staff money column mapped to an SR (D18, pending P07)", async () => {
    job = await saveImportMapping(ctx, fresh.company, job.id, {
      version: job.version,
      mapping: {
        products: { p7: fresh.alpha, p9: fresh.beta },
        staff: { mamun: fresh.mamun, "sr rohim": fresh.karim },
        categories: { operating: live.office },
      },
    });
    expect(job.issues).toEqual([
      { code: "import.issue.srColumn", severity: "error", key: "sr rohim" },
    ]);
    job = await saveImportMapping(ctx, fresh.company, job.id, {
      version: job.version,
      mapping: {
        products: { p7: fresh.alpha, p9: fresh.beta },
        staff: { mamun: fresh.mamun, "sr rohim": fresh.rohim },
        categories: { operating: live.office },
      },
    });
    expect(job.issues).toEqual([]);
  });

  it("writes the sheet's closing into the draft opening with the next month as go-live", async () => {
    await expectField(
      commitImportJob(ctx, fresh.company, job.id, { version: job.version, mode: "opening" }),
      "openingVersion",
      "validation.required",
    );
    job = await commitImportJob(ctx, fresh.company, job.id, {
      version: job.version,
      mode: "opening",
      openingVersion: 0,
    });
    expect(job).toMatchObject({ status: "committed", committedMode: "opening" });

    const opening = await getOpening(ctx, fresh.company);
    expect(opening).toMatchObject({ status: "draft", cutoffDate: "2026-10-01" });
    expect(opening.source).toMatchObject({ sheet: "Sep 2026", fileName: "book.xlsx" });
    const alpha = must(opening.stock.find((l) => l.productId === fresh.alpha));
    expect(alpha).toMatchObject({
      pieces: "100",
      salePrice: "12",
      unitCost: "9.5",
      dueFromCompany: "-43",
    });
    expect(alpha.source?.dueFromCompany).toBe("-43");
    const beta = must(opening.stock.find((l) => l.productId === fresh.beta));
    expect(beta.pieces).toBeNull();
    expect(beta.source?.pieces).toBe("-12");
    const balance = (kind: string, staffId: string | null) =>
      opening.balances.find((b) => b.kind === kind && b.staffId === staffId)?.amount;
    expect(balance("market_due", null)).toBe("75.00");
    expect(balance("shortage", fresh.rohim)).toBe("30.00");
    expect(balance("company_payable", null)).toBe("480.00");
  });
});
