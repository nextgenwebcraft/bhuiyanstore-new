import type {
  Batch,
  CashAccount,
  CashAccountUpsertRequest,
  CompanyUpsertRequest,
  CompanyWorkspace,
  DailySalesSummary,
  DailySalesSummaryPostRequest,
  DashboardSummary,
  ExpenseCategory,
  ExpenseCategoryUpsertRequest,
  GoodsReceipt,
  GoodsReceiptPostRequest,
  MarketDueItem,
  OldDueCollection,
  OldDueCollectionPostRequest,
  Opening,
  OpeningSaveRequest,
  OpeningTransitionRequest,
  OpeningWorkbookSheets,
  PriceChange,
  PriceChangeRequest,
  Product,
  ProductCreateRequest,
  ProductHistory,
  ProductPack,
  ProductPackRequest,
  Role,
  RoleUpsertRequest,
  StaffAssignmentRequest,
  StaffCreateRequest,
  StaffMember,
  StaffRecord,
  StaffRole,
  StaffRoleUpsertRequest,
  StaffUpsertRequest,
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
  /** Requires `inventory.view`. Quantities are derived from posted stock movements. */
  listBatches(companyId: string, options?: RequestOptions): Promise<Batch[]>;
  /** Requires `company.view`. */
  listSuppliers(companyId: string, options?: RequestOptions): Promise<Supplier[]>;
  /** Requires `company.view`. SR and DSR people assigned to this company. */
  listStaff(companyId: string, options?: RequestOptions): Promise<StaffMember[]>;
  /** Requires the purchases module and `purchase.view`. */
  listGoodsReceipts(companyId: string, options?: RequestOptions): Promise<GoodsReceipt[]>;
  /**
   * Posts a receipt atomically, creating one cost layer per line. `purchase` requires
   * `purchase.post`; `supplier_incentive` requires `supplier_incentive.receive` (D16).
   */
  postGoodsReceipt(
    companyId: string,
    input: GoodsReceiptPostRequest,
    options?: RequestOptions,
  ): Promise<GoodsReceipt>;
  /** Requires the sales module and `sale.view`. Cost fields need `inventory.cost_view`. */
  listDailySalesSummaries(
    companyId: string,
    options?: RequestOptions,
  ): Promise<DailySalesSummary[]>;
  /**
   * Requires `sale.post`. One summary per company/DSR/date (D03, DUPLICATE_DOCUMENT); batches are
   * allocated FEFO/FIFO (D05) and an uncovered quantity fails with INSUFFICIENT_STOCK.
   */
  postDailySalesSummary(
    companyId: string,
    input: DailySalesSummaryPostRequest,
    options?: RequestOptions,
  ): Promise<DailySalesSummary>;
  /** Requires the sales module and `sale.view`. */
  listMarketDues(companyId: string, options?: RequestOptions): Promise<MarketDueItem[]>;
  /** Requires the sales module and `sale.view`. */
  listOldDueCollections(companyId: string, options?: RequestOptions): Promise<OldDueCollection[]>;
  /**
   * Requires `collection.post`. Allocates oldest-first to the DSR's open market dues; an amount
   * above the open total fails with AMOUNT_EXCEEDS_DUE.
   */
  postOldDueCollection(
    companyId: string,
    input: OldDueCollectionPostRequest,
    options?: RequestOptions,
  ): Promise<OldDueCollection>;
  /** Requires `company.view`; profit/stock value need their own permissions. */
  /** The daily report for one business date (`YYYY-MM-DD`); requires `company.view`. */
  getDashboardSummary(
    companyId: string,
    date: string,
    options?: RequestOptions,
  ): Promise<DashboardSummary>;

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
