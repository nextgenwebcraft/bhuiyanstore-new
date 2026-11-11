import { bootstrapSuperAdmin, type Actor } from "@bsd/auth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadCompanyAccess } from "./access";
import { listRoles } from "./administration";
import { cashAccounts, staffRoles } from "./configuration";
import { createCompany, listWorkspaces } from "./companies";
import type { AppContext } from "./context";
import {
  approveDsrHandover,
  correctMoneyEntry,
  postDsrDay,
  postMoneyEntry,
  saveDsrDay,
  submitDsrHandover,
} from "./daily";
import { AppError } from "./errors";
import { createStaffLogin, resetStaffLoginPassword, updateStaffLogin } from "./field";
import { LOGIN_ROLE_NAMES } from "./fixed-roles";
import { createProduct } from "./products";
import { ensureMasterCompany } from "./master";
import { createStaff, getStaffRecord } from "./staff";
import { contextFor, resetTestSchema, saveWholeOpening, testDatabase } from "./test-support";

process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-integration-test-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

/**
 * D112 fixed Manager/DSR roles + D113 staff login from আমাদের স্টাফ (company access, handover).
 */

const { db, schema } = testDatabase();
const theme = { primary: "#0F766E", primaryForeground: "#FFFFFF" };
const DAY = "2026-11-01";

let admin: Actor;
let ctx: AppContext;
let company = "";
let other = "";
const id = { alpha: "", mamun: "", jamal: "", cash: "" };

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

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((e) => e instanceof AppError && e.code === code);
}

beforeAll(async () => {
  await resetTestSchema(db, schema);
  const boot = await bootstrapSuperAdmin(db, {
    tenantName: "Test Distributor",
    adminEmail: "admin@example.test",
    adminName: "Admin",
    adminPassword: "one-time-Password-123",
  });
  admin = {
    userId: boot.adminId,
    tenantId: boot.tenantId,
    isSuperAdmin: true,
  };
  ctx = contextFor(db, admin);
  company = (
    await createCompany(ctx, {
      name: "Drinko Fixed",
      theme,
      modules: ["sales"],
      starterData: false,
    })
  ).company.id;
  other = (
    await createCompany(ctx, {
      name: "Snacks Fixed",
      theme,
      modules: ["sales"],
      starterData: false,
    })
  ).company.id;
  id.alpha = (
    await createProduct(ctx, company, {
      sku: "A250",
      name: "Alpha 250ml",
      aliases: [],
      baseUnit: "piece",
      piecesPerCarton: "24",
      status: "active",
    })
  ).id;
  const roles = await staffRoles.list(ctx);
  const dsrRole = must(roles.find((r) => r.kind === "dsr")).id;
  const general = must(roles.find((r) => r.kind === "general")).id;
  id.mamun = (
    await createStaff(ctx, company, {
      name: "Mamun",
      employer: "distributor",
      status: "active",
      companyId: company,
      assignment: { roleId: dsrRole, from: "2026-01-01", to: null, monthlySalary: null },
    })
  ).id;
  id.jamal = (
    await createStaff(ctx, company, {
      name: "Jamal",
      employer: "distributor",
      status: "active",
      companyId: company,
      assignment: { roleId: general, from: "2026-01-01", to: null, monthlySalary: null },
    })
  ).id;
  id.cash = (await cashAccounts.create(ctx, { name: "Cash", kind: "cash", active: true })).id;
  await saveWholeOpening(ctx, company, {
    cutoffDate: DAY,
    stock: [
      {
        productId: id.alpha,
        pieces: "100",
        unitCost: "10",
        salePrice: "12",
        dueFromCompany: "0",
        note: "",
      },
    ],
    balances: [
      {
        kind: "cash",
        staffId: null,
        cashAccountId: id.cash,
        shopId: null,
        amount: "5000",
        note: "",
      },
    ],
  });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("D112: fixed Manager and DSR login roles", () => {
  it("seeds only Manager and DSR on listRoles", async () => {
    const roles = await listRoles(ctx);
    expect(roles.map((r) => r.kind).sort()).toEqual(["dsr", "manager", "tsm"]);
    expect(roles.map((r) => r.name).sort()).toEqual(
      [LOGIN_ROLE_NAMES.dsr, LOGIN_ROLE_NAMES.manager].sort(),
    );
  });
});

describe("D113: staff login credentials and company access", () => {
  it("creates a DSR login for selected companies and reports login fields", async () => {
    const linked = await createStaffLogin(ctx, company, id.mamun, {
      email: "mamun@example.test",
      password: "one-time-Password-1",
      roleKind: "dsr",
      companyIds: [company, other],
    });
    expect(linked).toMatchObject({
      loginEmail: "mamun@example.test",
      loginRoleKind: "dsr",
      loginActive: true,
    });
    expect(linked.loginCompanyIds).toEqual([company, other].sort());
    await expectField(
      createStaffLogin(ctx, company, id.mamun, {
        email: "mamun2@example.test",
        password: "one-time-Password-1",
        roleKind: "dsr",
        companyIds: [company],
      }),
      "email",
      "validation.field.duplicateLogin",
    );
    const mamunUser = must(await db.user.findFirst({ where: { email: "mamun@example.test" } }));
    const mamunCtx = contextFor(db, {
      userId: mamunUser.id,
      tenantId: admin.tenantId,
      isSuperAdmin: false,
    });
    const spaces = await listWorkspaces(mamunCtx);
    expect(spaces.map((w) => w.company.id).sort()).toEqual([company, other].sort());
    expect((await loadCompanyAccess(mamunCtx, company)).loginRoleKind).toBe("dsr");
  });

  it("updates role and companies, resets password, and can deactivate", async () => {
    await createStaffLogin(ctx, company, id.jamal, {
      email: "jamal@example.test",
      password: "one-time-Password-1",
      roleKind: "dsr",
      companyIds: [other],
    });
    const after = await updateStaffLogin(ctx, company, id.jamal, {
      roleKind: "manager",
      companyIds: [company],
      active: true,
    });
    expect(after).toMatchObject({
      loginEmail: "jamal@example.test",
      loginRoleKind: "manager",
      loginCompanyIds: [company],
      loginActive: true,
    });

    await resetStaffLoginPassword(ctx, company, id.jamal, {
      password: "one-time-Password-9",
    });
    const jamalAfterReset = must(await db.user.findFirst({ where: { email: "jamal@example.test" } }));
    expect(await db.session.count({ where: { userId: jamalAfterReset.id } })).toBe(0);

    const deactivated = await updateStaffLogin(ctx, company, id.jamal, {
      roleKind: "manager",
      companyIds: [company],
      active: false,
    });
    expect(deactivated.loginActive).toBe(false);
    expect((await getStaffRecord(ctx, company, id.jamal)).loginActive).toBe(false);
  });

  it("refuses a master-company membership", async () => {
    const master = await ensureMasterCompany(db, admin.tenantId);
    const fresh = (
      await createStaff(ctx, master, {
        name: "NoMaster",
        employer: "distributor",
        status: "active",
        companyId: company,
        assignment: {
          roleId: must((await staffRoles.list(ctx)).find((r) => r.kind === "dsr")).id,
          from: "2026-01-01",
          to: null,
          monthlySalary: null,
        },
      })
    ).id;
    await expectField(
      createStaffLogin(ctx, master, fresh, {
        email: "nomaster@example.test",
        password: "one-time-Password-1",
        roleKind: "dsr",
        companyIds: [master],
      }),
      "companyIds",
      "validation.membership.company",
    );
  });
});

describe("D112: DSR cannot post; Manager handover submit then Super Admin approve", () => {
  it("lets Manager enter সামারি and post, refuses edit after post, allows হাতে জমা → pending", async () => {
    const mamunUser = must(await db.user.findFirst({ where: { email: "mamun@example.test" } }));
    const jamalUser = must(await db.user.findFirst({ where: { email: "jamal@example.test" } }));
    const dsrCtx = contextFor(db, {
      userId: mamunUser.id,
      tenantId: admin.tenantId,
      isSuperAdmin: false,
    });
    await updateStaffLogin(ctx, company, id.jamal, {
      roleKind: "manager",
      companyIds: [company],
      active: true,
    });
    const managerCtx = contextFor(db, {
      userId: jamalUser.id,
      tenantId: admin.tenantId,
      isSuperAdmin: false,
    });

    // DSR may not set issued (সামারি).
    await expectField(
      saveDsrDay(dsrCtx, company, {
        date: DAY,
        staffId: id.mamun,
        version: 0,
        marketDueNew: "0",
        marketDueCollected: "0",
        cashHandedOver: null,
        lines: [
          { productId: id.alpha, dsrStaffId: id.mamun, issued: "24", returned: "0", damaged: "0" },
        ],
      }),
      "lines.0.issued",
      "validation.daily.dsrCannotEditIssued",
    );

    // Manager drafts সামারি (and may post); after post must not edit the sheet.
    const draft = await saveDsrDay(managerCtx, company, {
      date: DAY,
      staffId: id.mamun,
      version: 0,
      marketDueNew: "0",
      marketDueCollected: "0",
      cashHandedOver: null,
      lines: [
        { productId: id.alpha, dsrStaffId: id.mamun, issued: "24", returned: "0", damaged: "0" },
      ],
    });
    await expectCode(postDsrDay(dsrCtx, company, draft.id, { version: draft.version }), "FORBIDDEN");
    const posted = await postDsrDay(managerCtx, company, draft.id, { version: draft.version });
    expect(posted.status).toBe("posted");
    expect(posted.handoverStatus).toBe("none");

    await expectCode(
      saveDsrDay(managerCtx, company, {
        date: DAY,
        staffId: id.mamun,
        version: posted.version,
        marketDueNew: "0",
        marketDueCollected: "0",
        cashHandedOver: null,
        lines: [
          { productId: id.alpha, dsrStaffId: id.mamun, issued: "48", returned: "0", damaged: "0" },
        ],
      }),
      "FORBIDDEN",
    );

    const pending = await submitDsrHandover(managerCtx, company, posted.id, {
      version: posted.version,
      cashHandedOver: "200",
    });
    expect(pending.handoverStatus).toBe("pending");
    expect(pending.cashHandedOver).toBe("200");

    await expectField(
      saveDsrDay(managerCtx, company, {
        date: DAY,
        staffId: id.mamun,
        version: pending.version,
        marketDueNew: "0",
        marketDueCollected: "0",
        cashHandedOver: "200",
        lines: [
          { productId: id.alpha, dsrStaffId: id.mamun, issued: "24", returned: "0", damaged: "0" },
        ],
      }),
      "handoverStatus",
      "validation.daily.handoverLocked",
    );
    await expectCode(
      approveDsrHandover(managerCtx, company, pending.id, { version: pending.version }),
      "FORBIDDEN",
    );

    const approved = await approveDsrHandover(ctx, company, pending.id, {
      version: pending.version,
    });
    expect(approved.handoverStatus).toBe("approved");
  });
});

describe("D114: daily money correct by role and handover", () => {
  it("lets Manager correct before handover, locks after; DSR forbidden; Super Admin after", async () => {
    const moneyDay = "2026-11-02";
    const mamunUser = must(await db.user.findFirst({ where: { email: "mamun@example.test" } }));
    const jamalUser = must(await db.user.findFirst({ where: { email: "jamal@example.test" } }));
    const dsrCtx = contextFor(db, {
      userId: mamunUser.id,
      tenantId: admin.tenantId,
      isSuperAdmin: false,
    });
    const managerCtx = contextFor(db, {
      userId: jamalUser.id,
      tenantId: admin.tenantId,
      isSuperAdmin: false,
    });

    const draft = await saveDsrDay(ctx, company, {
      date: moneyDay,
      staffId: id.mamun,
      version: 0,
      marketDueNew: "0",
      marketDueCollected: "0",
      cashHandedOver: null,
      lines: [
        { productId: id.alpha, dsrStaffId: id.mamun, issued: "24", returned: "0", damaged: "0" },
      ],
    });
    const posted = await postDsrDay(ctx, company, draft.id, { version: draft.version });

    const entry = await postMoneyEntry(managerCtx, company, {
      date: moneyDay,
      kind: "staffAdvance",
      amount: "50",
      staffId: id.mamun,
    });
    const corrected = await correctMoneyEntry(managerCtx, company, entry.id, {
      date: moneyDay,
      kind: "staffAdvance",
      amount: "75",
      staffId: id.mamun,
    });
    expect(corrected.amount).toBe("75");
    expect(corrected.id).not.toBe(entry.id);

    await expectCode(
      correctMoneyEntry(dsrCtx, company, corrected.id, {
        date: moneyDay,
        kind: "staffAdvance",
        amount: "80",
        staffId: id.mamun,
      }),
      "FORBIDDEN",
    );

    await submitDsrHandover(managerCtx, company, posted.id, {
      version: posted.version,
      cashHandedOver: "100",
    });

    await expectField(
      correctMoneyEntry(managerCtx, company, corrected.id, {
        date: moneyDay,
        kind: "staffAdvance",
        amount: "90",
        staffId: id.mamun,
      }),
      "handoverStatus",
      "validation.daily.handoverLocked",
    );
    await expectField(
      postMoneyEntry(managerCtx, company, {
        date: moneyDay,
        kind: "staffAdvance",
        amount: "10",
        staffId: id.mamun,
      }),
      "handoverStatus",
      "validation.daily.handoverLocked",
    );

    const adminCorrected = await correctMoneyEntry(ctx, company, corrected.id, {
      date: moneyDay,
      kind: "staffAdvance",
      amount: "90",
      staffId: id.mamun,
    });
    expect(adminCorrected.amount).toBe("90");
  });
});
