import type { Actor } from "@bsd/auth";
import { createDatabase, type Database } from "@bsd/database";
import {
  openingBalanceSections,
  sectionOfBalanceKind,
  type Opening,
  type OpeningBalanceLine,
  type OpeningSectionSaveRequest,
} from "@bsd/contracts";
import type { AppContext } from "./context";
import { getOpening, saveOpeningCutoff, saveOpeningSection } from "./opening";

/** Test-only helpers for `*.integration.ts`; never imported by production code. */
export function testDatabase(): { db: Database; schema: string } {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  const schema = new URL(url).searchParams.get("schema");
  if (!schema || schema === "public" || !/^[a-z_][a-z0-9_]*$/.test(schema)) {
    throw new Error("TEST_DATABASE_URL must select a dedicated schema");
  }
  return { db: createDatabase(url), schema };
}

const TABLES = [
  "audit_event",
  "idempotency_record",
  "month_close",
  "field_visit_line",
  "field_visit",
  "field_day_report_line",
  "field_day_report",
  "damage_event",
  "damage_case_line",
  "damage_case",
  "money_entry",
  "payroll_line",
  "payroll_run",
  "dsr_price_split",
  "dsr_line",
  "dsr_day",
  "stock_entry",
  "product_batch",
  "opening_balance_line",
  "opening_stock_line",
  "opening_session",
  "price_change",
  "product_pack",
  "product",
  "supplier",
  "staff_assignment",
  "staff",
  "staff_role",
  "expense_category",
  "cash_account",
  "membership_role",
  "membership",
  "role_permission",
  "role",
  "company_module",
  "company",
  "legal_entity",
  "session",
  "account",
  "verification",
  "user",
  "tenant",
];

/** Empties the test schema only; the schema name is always qualified. */
export async function resetTestSchema(db: Database, schema: string): Promise<void> {
  const list = TABLES.map((t) => `"${schema}"."${t}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE ${list} CASCADE`);
}

export function contextFor(db: Database, actor: Actor): AppContext {
  return { db, actor, requestId: "test-request" };
}

/** The whole opening in one object; tests save it section by section, as the owner would. */
export type WholeOpening = {
  /** Ignored: the helper reads the current version itself. */
  version?: number;
  cutoffDate: string;
  stock: Extract<OpeningSectionSaveRequest, { section: "stock" }>["stock"];
  balances: (Omit<OpeningBalanceLine, "shopId"> & { shopId?: string | null })[];
};

/** Saves the cutoff, the stock and every balance section of a company's opening. */
export async function saveWholeOpening(
  ctx: AppContext,
  companyId: string,
  opening: WholeOpening,
): Promise<Opening> {
  let view = await saveOpeningCutoff(ctx, companyId, {
    version: (await getOpening(ctx, companyId)).version,
    cutoffDate: opening.cutoffDate,
  });
  view = await saveOpeningSection(ctx, companyId, {
    section: "stock",
    version: view.version,
    stock: opening.stock,
  });
  for (const section of openingBalanceSections) {
    view = await saveOpeningSection(ctx, companyId, {
      section,
      version: view.version,
      balances: opening.balances.filter((b) => sectionOfBalanceKind(b.kind) === section),
    });
  }
  return view;
}
