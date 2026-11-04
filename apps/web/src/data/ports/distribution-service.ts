import type {
  CompanyCreateRequest,
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
  FieldDay,
  FieldDayEndRequest,
  FieldShopCreateRequest,
  FieldVisit,
  FieldVisitDeleteRequest,
  FieldVisitSaveRequest,
  Opening,
  OpeningCutoffRequest,
  OpeningSectionSaveRequest,
  OrderTarget,
  OrderTargetList,
  OrderTargetUpdateRequest,
  OrderTargetUpsertRequest,
  StaffLoginCreateRequest,
  StaffLoginPasswordResetRequest,
  StaffLoginUpdateRequest,
  MasterMonth,
  MasterSummary,
  CompanyHishabYear,
  MasterHishabYear,
  InvestmentsRequest,
  ShareholderCreateRequest,
  ShareholderList,
  ShareholderPayoutRequest,
  ShareholderRecord,
  ShareholderUpdateRequest,
  HistoryDsrPage,
  HistoryMoneyKindGroup,
  HistoryMoneyPage,
  HistoryPageQuery,
  HistoryStatusFilter,
  HistoryStockDateSummaries,
  HistoryStockKindGroup,
  HistoryStockPage,
  MoneyEntry,
  MoneyEntryPostRequest,
  MonthCloseResult,
  MonthView,
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
  Shop,
  ShopStatement,
  ShopUpsertRequest,
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
  createCompany(input: CompanyCreateRequest): Promise<CompanyWorkspace>;
  /** Full replace; requires `company.manage`. Turning the stock block on needs no negative stock. */
  updateCompany(companyId: string, input: CompanyUpsertRequest): Promise<CompanyWorkspace>;
  /** Super-admin only; hard delete of a company with no activity at all (D90), else refused. */
  deleteCompany(companyId: string): Promise<void>;
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
  /** Requires `product.edit`; hard delete, refused (VALIDATION_FAILED) when anything refers to the product. */
  deleteProduct(companyId: string, productId: string): Promise<void>;
  /** Requires `product.edit`; rejects an unknown product or one from another company. */
  updateProduct(
    companyId: string,
    productId: string,
    input: ProductCreateRequest,
    options?: RequestOptions,
  ): Promise<Product>;
  /** Requires `company.view`. SR and DSR people assigned to this company. */
  listStaff(companyId: string, options?: RequestOptions): Promise<StaffMember[]>;
  /**
   * The dashboard report summed over a date range (`YYYY-MM-DD`, `to` stops at today), from the
   * month engine; requires `company.view`. Profit and stock value need their own permissions.
   */
  getDashboardSummary(
    companyId: string,
    range: ReportRange,
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
  /** D112: Manager submits day-end cash; requires `sale.handover_submit`. */
  submitDsrHandover(
    companyId: string,
    dayId: string,
    input: import("@bsd/contracts").DsrHandoverSubmitRequest,
  ): Promise<DsrDay>;
  /** D112: Super Admin approves pending handover. */
  approveDsrHandover(
    companyId: string,
    dayId: string,
    input: import("@bsd/contracts").DsrHandoverApproveRequest,
  ): Promise<DsrDay>;
  /**
   * D71: decides a DSR's pending field report; approving corrects the sheet (`sale.create`, and
   * `sale.post` + `sale.reverse` for a posted one).
   */
  decideFieldReport(
    companyId: string,
    reportId: string,
    action: "approve" | "reject",
    input: DocumentTransitionRequest,
  ): Promise<void>;
  /** Market due kinds need `sale.view`, the others `finance.view`; only visible kinds return. */
  listMoneyEntries(
    companyId: string,
    query: { from: string; to?: string; staffId?: string; shopId?: string },
    options?: RequestOptions,
  ): Promise<MoneyEntry[]>;
  /** The permission depends on the entry type (D27). */
  postMoneyEntry(companyId: string, input: MoneyEntryPostRequest): Promise<MoneyEntry>;
  /**
   * D114: reverse + re-enter a posted money row. Super Admin always; Manager until হাতে জমা;
   * DSR never. Needs the kind's post permission (not `payment.reverse`).
   */
  correctMoneyEntry(
    companyId: string,
    entryId: string,
    input: MoneyEntryPostRequest,
  ): Promise<MoneyEntry>;
  /** Requires `payment.reverse`. */
  reverseMoneyEntry(companyId: string, entryId: string): Promise<MoneyEntry>;

  /** History hub: paginated stock entries by kind group (latest first). */
  listHistoryStockEntries(
    companyId: string,
    group: HistoryStockKindGroup,
    query: HistoryPageQuery,
    options?: RequestOptions,
  ): Promise<HistoryStockPage>;
  /** History hub: date cards for orders/stock (totals per date). */
  listHistoryStockDateSummaries(
    companyId: string,
    group: HistoryStockKindGroup,
    query: { status?: HistoryStatusFilter },
    options?: RequestOptions,
  ): Promise<HistoryStockDateSummaries>;
  /** History hub: paginated money entries by kind group (latest first). */
  listHistoryMoneyEntries(
    companyId: string,
    group: HistoryMoneyKindGroup,
    query: HistoryPageQuery,
    options?: RequestOptions,
  ): Promise<HistoryMoneyPage>;
  /** History hub: paginated DSR sheets (latest first). */
  listHistoryDsrDays(
    companyId: string,
    query: HistoryPageQuery,
    options?: RequestOptions,
  ): Promise<HistoryDsrPage>;

  /** D111: order-amount targets with progress. Requires `company.view`. */
  listOrderTargets(
    companyId: string,
    query?: { dashboardOnly?: boolean },
    options?: RequestOptions,
  ): Promise<OrderTargetList>;
  /** Requires `company.manage`. */
  createOrderTarget(companyId: string, input: OrderTargetUpsertRequest): Promise<OrderTarget>;
  /** Requires `company.manage`. */
  updateOrderTarget(
    companyId: string,
    targetId: string,
    input: OrderTargetUpdateRequest,
  ): Promise<OrderTarget>;
  /** Soft-archive. Requires `company.manage`. */
  archiveOrderTarget(companyId: string, targetId: string): Promise<OrderTarget>;

  // Month view, reports and closing (PLAN §9 Phase F). The demo mock has none.

  /** Requires `report.view`: the engine's month (`YYYY-MM`) with its close state. */
  getMonthView(companyId: string, month: string, options?: RequestOptions): Promise<MonthView>;
  /** Requires `period.close`. */
  closeMonth(companyId: string, month: string): Promise<MonthCloseResult>;
  /** Requires `period.close`; only the latest closed month. */
  reopenMonth(companyId: string, month: string): Promise<MonthCloseResult>;

  // Master panel (D66), super-admin only; `companyId` is the master company.

  /** The tenant's master company, created on first open. */
  getMasterWorkspace(options?: RequestOptions): Promise<CompanyWorkspace>;
  /** Every company's summary, their total and the business's profit and loss. */
  getMasterSummary(
    companyId: string,
    range: ReportRange,
    options?: RequestOptions,
  ): Promise<MasterSummary>;
  /** Each company's and the master's close state for the month. */
  getMasterMonth(companyId: string, month: string, options?: RequestOptions): Promise<MasterMonth>;
  /** Closes (or reopens) the month for every company and the master together. */
  masterMonthCommand(
    companyId: string,
    month: string,
    action: "close" | "reopen",
  ): Promise<MasterMonth>;
  /** Company Hishab Reports: one company's year, profit/khoroch/দান/invest per month. */
  getCompanyHishabYear(
    companyId: string,
    targetCompanyId: string,
    year: string,
    shareholderId?: string,
    options?: RequestOptions,
  ): Promise<CompanyHishabYear>;
  /** The master panel: every company's total side by side, one year. */
  getMasterHishabYear(
    companyId: string,
    year: string,
    shareholderId?: string,
    options?: RequestOptions,
  ): Promise<MasterHishabYear>;
  /** The শেয়ারহোল্ডার module: every shareholder and their invest per company, for a month. */
  listShareholders(
    companyId: string,
    month?: string,
    options?: RequestOptions,
  ): Promise<ShareholderList>;
  createShareholder(companyId: string, input: ShareholderCreateRequest): Promise<ShareholderRecord>;
  updateShareholder(
    companyId: string,
    shareholderId: string,
    input: ShareholderUpdateRequest,
  ): Promise<ShareholderRecord>;
  /** Saves every invest entry an edit touches, for one shareholder, in one atomic request. */
  saveInvestments(
    companyId: string,
    shareholderId: string,
    input: InvestmentsRequest,
  ): Promise<ShareholderRecord>;
  /** D94: marks or unmarks one shareholder's one month as paid on the master panel. */
  setShareholderPayout(companyId: string, input: ShareholderPayoutRequest): Promise<void>;
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
    query: { status?: "open"; from?: string; to?: string },
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
  /** Requires `company.view`; assignments in companies the actor cannot see are left out. */
  listStaffRecords(companyId: string, options?: RequestOptions): Promise<StaffRecord[]>;
  /** Super-admin only: every person of the tenant, to assign someone to a second brand (D09). */
  listAllStaff(options?: RequestOptions): Promise<StaffRecord[]>;
  /** Requires `staff.manage`. SRs must be supplier-employed, DSRs distributor-employed. */
  createStaff(companyId: string, input: StaffCreateRequest): Promise<StaffRecord>;
  updateStaff(companyId: string, staffId: string, input: StaffUpsertRequest): Promise<StaffRecord>;
  /** Requires `staff.manage`; hard delete, refused when the person was ever used. */
  deleteStaff(companyId: string, staffId: string): Promise<void>;
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
  /** Requires `company.view`; `due` (today's open বাকি) needs `sale.view`. */
  listShops(companyId: string, options?: RequestOptions): Promise<Shop[]>;
  /** Requires `shop.manage`; shop names are unique in the company. */
  createShop(companyId: string, input: ShopUpsertRequest): Promise<Shop>;
  updateShop(companyId: string, shopId: string, input: ShopUpsertRequest): Promise<Shop>;
  /** Requires `shop.manage`; hard delete, refused when the shop was ever used. */
  deleteShop(companyId: string, shopId: string): Promise<void>;
  /** Requires `sale.view`: one shop's due entries with a running balance. */
  getShopStatement(
    companyId: string,
    shopId: string,
    range: { from?: string; to?: string },
    options?: RequestOptions,
  ): Promise<ShopStatement>;
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

  // DSR field panel (D40). The demo mock has none.

  /** Requires `field.entry`: the signed-in DSR's own day (samari in hand, visits, shops). */
  getFieldDay(companyId: string, date: string, options?: RequestOptions): Promise<FieldDay>;
  /** Requires `sale.view`: one DSR's field day for the office day-end. */
  getDsrFieldDay(
    companyId: string,
    staffId: string,
    date: string,
    options?: RequestOptions,
  ): Promise<FieldDay>;
  /** Creates (no `visitId`) or replaces an own open visit; the price comes from the server. */
  saveFieldVisit(
    companyId: string,
    visitId: string | undefined,
    input: FieldVisitSaveRequest,
  ): Promise<FieldVisit>;
  deleteFieldVisit(
    companyId: string,
    visitId: string,
    input: FieldVisitDeleteRequest,
  ): Promise<void>;
  /** Requires `field.entry`: firot and damage into the draft office sheet; returns the day. */
  saveFieldDayEnd(companyId: string, input: FieldDayEndRequest): Promise<FieldDay>;
  /** Requires `field.shop_create`. */
  createFieldShop(
    companyId: string,
    input: FieldShopCreateRequest,
  ): Promise<FieldDay["shops"][number]>;
  /** Super-admin: Manager/DSR login linked to staff (D113). */
  createStaffLogin(
    companyId: string,
    staffId: string,
    input: StaffLoginCreateRequest,
  ): Promise<StaffRecord>;
  updateStaffLogin(
    companyId: string,
    staffId: string,
    input: StaffLoginUpdateRequest,
  ): Promise<StaffRecord>;
  resetStaffLoginPassword(
    companyId: string,
    staffId: string,
    input: StaffLoginPasswordResetRequest,
  ): Promise<StaffRecord>;

  // Opening balance (Phase I go-live). Requires `opening.prepare`.

  /** The company's opening snapshot (stock, dues, balances). */
  getOpening(companyId: string, options?: RequestOptions): Promise<Opening>;
  /** Set or change the cutoff date; all section data is preserved. */
  saveOpeningCutoff(companyId: string, input: OpeningCutoffRequest): Promise<Opening>;
  /** Upsert one section of the opening snapshot. */
  saveOpeningSection(companyId: string, input: OpeningSectionSaveRequest): Promise<Opening>;
}

export type ConfigLists = {
  staffRoles: { item: StaffRole; input: StaffRoleUpsertRequest };
  expenseCategories: { item: ExpenseCategory; input: ExpenseCategoryUpsertRequest };
};

export type ConfigListId = keyof ConfigLists;
