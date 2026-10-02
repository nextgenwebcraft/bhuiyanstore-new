import type {
  CashAccount,
  CashAccountUpsertRequest,
  CompanyUpsertRequest,
  CompanyWorkspace,
  DamageCase,
  DamageCaseCreateRequest,
  DamageEventRequest,
  DashboardSummary,
  DayView,
  DocumentTransitionRequest,
  DsrDay,
  DsrDaySaveRequest,
  ExpenseCategory,
  ExpenseCategoryUpsertRequest,
  MoneyEntry,
  MoneyEntryPostRequest,
  MonthCloseResult,
  MonthView,
  Opening,
  OpeningSaveRequest,
  OpeningTransitionRequest,
  OpeningWorkbookSheets,
  PayrollAction,
  PayrollRun,
  PayrollSaveRequest,
  PayrollTransitionRequest,
  PriceChange,
  PriceChangeRequest,
  Product,
  ProductCreateRequest,
  ProductHistory,
  ProductPack,
  ProductPackRequest,
  Report,
  ReportId,
  ReportRange,
  Role,
  RoleUpsertRequest,
  StaffAccountKind,
  StaffAccounts,
  StaffAssignmentRequest,
  StaffCreateRequest,
  StaffMember,
  StaffRecord,
  StaffRole,
  StaffRoleUpsertRequest,
  StaffStatement,
  StaffUpsertRequest,
  StockEntry,
  StockEntryPostRequest,
  Supplier,
  SupplierUpsertRequest,
  User,
  UserCreateRequest,
  UserPasswordResetRequest,
  UserUpdateRequest,
} from "@bsd/contracts";

export type RequestOptions = { signal?: AbortSignal };

/**
 * Service port shared by the mock adapter (Phase 1) and the HTTP adapter (after client
 * approval). Both return the same contract DTOs (guide section 6.1). The actor comes from the
 * session, never from a parameter. Posting commands are idempotent by `requestKey`: a retry with
 * the same key and payload returns the original outcome; a different payload fails with
 * IDEMPOTENCY_CONFLICT (guide 13.2).
 */
export interface DistributionService {
  /** Companies the current actor is a member of, with their effective permissions. */
  listWorkspaces(options?: RequestOptions): Promise<CompanyWorkspace[]>;
  /** Super-admin only; company names are unique within the tenant. */
  createCompany(input: CompanyUpsertRequest): Promise<CompanyWorkspace>;
  /** Fails with COMPANY_NOT_FOUND for unknown and inaccessible companies alike. */
  getWorkspace(companyId: string, options?: RequestOptions): Promise<CompanyWorkspace>;
  /** Requires `product.view` in the company. */
  listProducts(companyId: string, options?: RequestOptions): Promise<Product[]>;
  /** Requires `product.create`; rejects a SKU already used in the company (VALIDATION_FAILED). */
  createProduct(
    companyId: string,
    input: ProductCreateRequest,
    options?: RequestOptions,
  ): Promise<Product>;
  /** Requires `product.edit`; rejects an unknown product or one from another company. */
  updateProduct(
    companyId: string,
    productId: string,
    input: ProductCreateRequest,
    options?: RequestOptions,
  ): Promise<Product>;
  /** Requires `company.view`. */
  listSuppliers(companyId: string, options?: RequestOptions): Promise<Supplier[]>;
  /** Requires `company.view`. SR and DSR people assigned to this company. */
  listStaff(companyId: string, options?: RequestOptions): Promise<StaffMember[]>;
  /**
   * The daily report for one business date (`YYYY-MM-DD`), from the month engine; requires
   * `company.view`. Profit and stock value need their own permissions.
   */
  getDashboardSummary(
    companyId: string,
    date: string,
    options?: RequestOptions,
  ): Promise<DashboardSummary>;

  // Daily entry (PLAN §9 Phase E). Posted documents are corrected by reversal, never edited.

  /** The engine's day block (PLAN §6); cost and profit are null without their permissions. */
  getDayView(companyId: string, date: string, options?: RequestOptions): Promise<DayView>;
  /** Requires `purchase.view`: the date's godown entries, reversed ones included. */
  listStockEntries(
    companyId: string,
    date: string,
    options?: RequestOptions,
  ): Promise<StockEntry[]>;
  /** Orders, receipts and damage of one date plus price changes from that date. */
  postStockEntries(companyId: string, input: StockEntryPostRequest): Promise<StockEntry[]>;
  /** Requires `purchase.reverse`. */
  reverseStockEntry(companyId: string, entryId: string): Promise<StockEntry>;
  /** Requires `sale.view`: every DSR sheet of the date. */
  listDsrDays(companyId: string, date: string, options?: RequestOptions): Promise<DsrDay[]>;
  /** Requires `sale.create`: creates (version 0) or replaces the DSR's draft for the date. */
  saveDsrDay(companyId: string, input: DsrDaySaveRequest): Promise<DsrDay>;
  /** Requires `sale.post`. */
  postDsrDay(companyId: string, dayId: string, input: DocumentTransitionRequest): Promise<DsrDay>;
  /** Requires `sale.reverse`. */
  reverseDsrDay(
    companyId: string,
    dayId: string,
    input: DocumentTransitionRequest,
  ): Promise<DsrDay>;
  /** Requires `sale.create`; drafts only. */
  discardDsrDay(companyId: string, dayId: string, input: DocumentTransitionRequest): Promise<void>;
  /** Market due kinds need `sale.view`, the others `finance.view`; only visible kinds return. */
  listMoneyEntries(
    companyId: string,
    query: { from: string; to?: string; staffId?: string },
    options?: RequestOptions,
  ): Promise<MoneyEntry[]>;
  /** The permission depends on the entry type (D27). */
  postMoneyEntry(companyId: string, input: MoneyEntryPostRequest): Promise<MoneyEntry>;
  /** Requires `payment.reverse`. */
  reverseMoneyEntry(companyId: string, entryId: string): Promise<MoneyEntry>;

  // Month view, reports and closing (PLAN §9 Phase F). The demo mock has none.

  /** Requires `report.view`: the engine's month (`YYYY-MM`) with its close state. */
  getMonthView(companyId: string, month: string, options?: RequestOptions): Promise<MonthView>;
  /** Requires `period.close`. */
  closeMonth(companyId: string, month: string): Promise<MonthCloseResult>;
  /** Requires `period.close`; only the latest closed month. */
  reopenMonth(companyId: string, month: string): Promise<MonthCloseResult>;
  /** Requires `report.view` (profit also `report.profit_view`, staff balances `finance.view`). */
  getReport(
    companyId: string,
    report: ReportId,
    range: ReportRange,
    options?: RequestOptions,
  ): Promise<Report>;
  /** Requires `report.export`. */
  downloadReport(
    companyId: string,
    report: ReportId,
    range: ReportRange,
    format: "csv" | "xlsx",
  ): Promise<{ fileName: string; file: Blob }>;

  // Staff/SR accounts, payroll and damage cases (PLAN §9 Phase G). The demo mock has none.

  /** Distributor accounts need `finance.view`; SR accounts `finance.view` or `sr_loan.view`. */
  getStaffAccounts(
    companyId: string,
    query: { kind: StaffAccountKind; date?: string },
    options?: RequestOptions,
  ): Promise<StaffAccounts>;
  /** One person's ledger lines over the range, with opening and closing balances. */
  getStaffStatement(
    companyId: string,
    staffId: string,
    range: ReportRange,
    options?: RequestOptions,
  ): Promise<StaffStatement>;
  /** Also requires `report.export`. */
  downloadStaffStatement(
    companyId: string,
    staffId: string,
    range: ReportRange,
    format: "csv" | "xlsx",
  ): Promise<{ fileName: string; file: Blob }>;
  /** Requires `compensation.view`: the month's live run, or a proposal when there is none. */
  getPayrollRun(companyId: string, month: string, options?: RequestOptions): Promise<PayrollRun>;
  /** Requires `compensation.manage`; creates (version 0) or replaces the draft. */
  savePayrollRun(companyId: string, month: string, input: PayrollSaveRequest): Promise<PayrollRun>;
  /** approve | pay | reverse | discard, each with its own permissions. */
  payrollCommand(
    companyId: string,
    month: string,
    action: PayrollAction,
    input: PayrollTransitionRequest,
  ): Promise<PayrollRun>;
  /** Any of `damage.report`, `damage.claim_settle`, `damage.approve`. */
  listDamageCases(
    companyId: string,
    query: { status?: "open" },
    options?: RequestOptions,
  ): Promise<DamageCase[]>;
  /** Requires `damage.report`. */
  createDamageCase(companyId: string, input: DamageCaseCreateRequest): Promise<DamageCase>;
  /** The permission depends on the leg (guide §12.2). */
  postDamageEvent(
    companyId: string,
    caseId: string,
    input: DamageEventRequest,
  ): Promise<DamageCase>;
  reverseDamageEvent(companyId: string, eventId: string): Promise<DamageCase>;
  /** Requires `damage.report`; only while no leg is posted. */
  cancelDamageCase(companyId: string, caseId: string): Promise<DamageCase>;

  // Masters and configuration (PLAN §9 Phase C). The demo mock answers reads only.

  /** Requires `product.view`: carton sizes and per-piece prices by effective date. */
  getProductHistory(
    companyId: string,
    productId: string,
    options?: RequestOptions,
  ): Promise<ProductHistory>;
  /** Requires `product.edit`; the same date replaces the earlier entry. */
  addProductPack(
    companyId: string,
    productId: string,
    input: ProductPackRequest,
  ): Promise<ProductPack>;
  /** Requires `product.edit`; the same kind and date replaces the earlier entry. */
  setProductPrice(
    companyId: string,
    productId: string,
    input: PriceChangeRequest,
  ): Promise<PriceChange>;
  /** Requires `supplier.manage`; names are unique per company. */
  createSupplier(companyId: string, input: SupplierUpsertRequest): Promise<Supplier>;
  updateSupplier(
    companyId: string,
    supplierId: string,
    input: SupplierUpsertRequest,
  ): Promise<Supplier>;
  /** Requires `company.view`; assignments in companies the actor cannot see are left out. */
  listStaffRecords(companyId: string, options?: RequestOptions): Promise<StaffRecord[]>;
  /** Super-admin only: every person of the tenant, to assign someone to a second brand (D09). */
  listAllStaff(options?: RequestOptions): Promise<StaffRecord[]>;
  /** Requires `staff.manage`. SRs must be supplier-employed, DSRs distributor-employed. */
  createStaff(companyId: string, input: StaffCreateRequest): Promise<StaffRecord>;
  updateStaff(companyId: string, staffId: string, input: StaffUpsertRequest): Promise<StaffRecord>;
  /** Requires `staff.manage`; periods of one person in one company never overlap. */
  addStaffAssignment(
    companyId: string,
    staffId: string,
    input: StaffAssignmentRequest,
  ): Promise<StaffRecord>;
  updateStaffAssignment(
    companyId: string,
    staffId: string,
    assignmentId: string,
    input: StaffAssignmentRequest,
  ): Promise<StaffRecord>;
  /** Tenant lists: every signed-in user reads them; only the super-admin changes them. */
  listConfig<K extends ConfigListId>(
    list: K,
    options?: RequestOptions,
  ): Promise<ConfigLists[K]["item"][]>;
  createConfig<K extends ConfigListId>(
    list: K,
    input: ConfigLists[K]["input"],
  ): Promise<ConfigLists[K]["item"]>;
  updateConfig<K extends ConfigListId>(
    list: K,
    id: string,
    input: ConfigLists[K]["input"],
  ): Promise<ConfigLists[K]["item"]>;
  /** Super-admin only. */
  listRoles(options?: RequestOptions): Promise<Role[]>;
  createRole(input: RoleUpsertRequest): Promise<Role>;
  updateRole(roleId: string, input: RoleUpsertRequest): Promise<Role>;
  listUsers(options?: RequestOptions): Promise<User[]>;
  createUser(input: UserCreateRequest): Promise<User>;
  updateUser(userId: string, input: UserUpdateRequest): Promise<User>;
  /** Sets a one-time password and signs the user out everywhere. */
  resetUserPassword(userId: string, input: UserPasswordResetRequest): Promise<User>;

  // Opening balances (PLAN §9 Phase D). Requires `opening.prepare` unless noted.

  /** The company's opening snapshot with its readiness issues and totals. */
  getOpening(companyId: string, options?: RequestOptions): Promise<Opening>;
  /** Full replace of the entered values at `version`; any change returns it to draft. */
  saveOpening(companyId: string, input: OpeningSaveRequest): Promise<Opening>;
  /** Lists an uploaded workbook's month sheets, or recognises the standard template. */
  inspectOpeningWorkbook(companyId: string, file: Blob): Promise<OpeningWorkbookSheets>;
  /** Imports a month sheet's closing (`sheet`) or a filled template (`sheet: null`). */
  importOpeningWorkbook(
    companyId: string,
    input: { file: Blob; fileName: string; sheet: string | null; version: number },
  ): Promise<Opening>;
  /** The standard template pre-filled with the company's products, people and accounts. */
  downloadOpeningTemplate(companyId: string): Promise<{ fileName: string; file: Blob }>;
  /** Requires `opening.approve`; refused while readiness errors remain. */
  approveOpening(companyId: string, input: OpeningTransitionRequest): Promise<Opening>;
  /** Requires `opening.activate`; locks the snapshot and sets catalog prices at the cutoff. */
  activateOpening(companyId: string, input: OpeningTransitionRequest): Promise<Opening>;
}

export type ConfigLists = {
  staffRoles: { item: StaffRole; input: StaffRoleUpsertRequest };
  expenseCategories: { item: ExpenseCategory; input: ExpenseCategoryUpsertRequest };
  cashAccounts: { item: CashAccount; input: CashAccountUpsertRequest };
};

export type ConfigListId = keyof ConfigLists;
