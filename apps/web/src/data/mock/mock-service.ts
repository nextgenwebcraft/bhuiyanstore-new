import {
  batchSchema,
  businessDateSchema,
  companyWorkspaceSchema,
  dailySalesSummaryPostRequestSchema,
  dailySalesSummarySchema,
  dashboardSummarySchema,
  goodsReceiptPostRequestSchema,
  goodsReceiptSchema,
  marketDueItemSchema,
  oldDueCollectionPostRequestSchema,
  oldDueCollectionSchema,
  permissionIds,
  productCreateRequestSchema,
  productHistorySchema,
  productSchema,
  staffMemberSchema,
  staffRecordSchema,
  supplierSchema,
  type Batch,
  type StaffRole,
  type StaffRoleKind,
  type CompanyWorkspace,
  type DailySalesSummary,
  type GoodsReceipt,
  type OldDueCollection,
  type PermissionId,
  type Product,
  type WorkspaceModuleId,
} from "@bsd/contracts";
import {
  allocateByPriority,
  allocateOldestFirst,
  allocationCost,
  Decimal,
  priceSplitAmount,
  roundCost,
  roundSettlement,
  saleTotals,
  sumAmounts,
  sumQuantities,
  toBaseQuantity,
  toDecimal,
} from "@bsd/domain";
import type { DistributionService, RequestOptions } from "../ports/distribution-service";
import { ServiceError } from "../ports/service-error";
import type { DemoSeed } from "./seed-schema";

export type MockServiceOptions = {
  /** Simulated network latency, so loading states are visible and cancellation is exercised. */
  latencyMs?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
};

export type MockDistributionService = DistributionService & {
  readonly users: DemoSeed["users"];
  getActorId(): string;
  setActorId(userId: string): void;
  /** Restores the initial fixture state (the "Reset demo" action). */
  reset(): void;
};

type StockBucket = "available" | "reserved" | "quarantine";

/** Append-only stock movement: the single source of every batch balance (guide 9.1, 21.1). */
type StockMovement = {
  sequence: number;
  batchId: string;
  bucket: StockBucket;
  delta: string;
  kind: "opening" | "receipt" | "sale";
  sourceId: string;
};

type CostLayer = Omit<
  Batch,
  "receivedQuantity" | "availableQuantity" | "reservedQuantity" | "quarantineQuantity"
>;

type DueItem = {
  id: string;
  companyId: string;
  dsrId: string;
  businessDate: string;
  sourceSummaryId?: string;
  sourceNumber?: string;
  originalAmount: string;
};

type MockState = {
  companies: DemoSeed["companies"];
  products: Product[];
  suppliers: DemoSeed["suppliers"];
  staff: DemoSeed["staff"];
  roles: DemoSeed["roles"];
  memberships: DemoSeed["memberships"];
  layers: CostLayer[];
  movements: StockMovement[];
  receipts: GoodsReceipt[];
  /** Stored unredacted; cost fields are projected per actor on read. */
  summaries: DailySalesSummary[];
  dueItems: DueItem[];
  collections: OldDueCollection[];
  sequence: number;
  /** Durable idempotency records keyed by actor/company/action/requestKey (guide 13.3). */
  idempotency: Map<string, { payloadHash: string; documentId: string }>;
};

function initialState(seed: DemoSeed): MockState {
  const s = structuredClone(seed);
  let sequence = 0;
  const movements: StockMovement[] = [];
  const layers: CostLayer[] = s.batches.map((b) => {
    const buckets: [StockBucket, string][] = [
      ["available", b.availableQuantity],
      ["reserved", b.reservedQuantity],
      ["quarantine", b.quarantineQuantity],
    ];
    for (const [bucket, quantity] of buckets) {
      if (!toDecimal(quantity).isZero()) {
        movements.push({
          sequence: ++sequence,
          batchId: b.id,
          bucket,
          delta: quantity,
          kind: "opening",
          sourceId: "opening",
        });
      }
    }
    return {
      id: b.id,
      companyId: b.companyId,
      productId: b.productId,
      lotId: b.lotId,
      expiryDate: b.expiryDate,
      receivedDate: b.receivedDate,
      location: b.location,
      origin: "opening",
      unitCost: b.unitCost,
    };
  });
  return {
    companies: s.companies,
    products: s.products,
    suppliers: s.suppliers,
    staff: s.staff,
    roles: s.roles,
    memberships: s.memberships,
    layers,
    movements,
    receipts: [],
    summaries: [],
    dueItems: s.openingMarketDues.map((d) => ({
      id: d.id,
      companyId: d.companyId,
      dsrId: d.dsrId,
      businessDate: d.businessDate,
      originalAmount: d.amount,
    })),
    collections: [],
    sequence,
    idempotency: new Map(),
  };
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ServiceError("REQUEST_ABORTED"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new ServiceError("REQUEST_ABORTED"));
      },
      { once: true },
    );
  });
}

/**
 * Deterministic in-memory adapter over the JSON seed. It enforces the same membership, module
 * and permission rules the server will, validates every response against its contract, and
 * performs each posting as one all-or-nothing step: every check runs before any state changes.
 * State lives in memory only (online-only product, D15): a page reload restores the seed.
 */
export function createMockService(
  seed: DemoSeed,
  { latencyMs = 150, now = () => new Date() }: MockServiceOptions = {},
): MockDistributionService {
  let state = initialState(seed);
  let actorId = seed.users[0]?.id ?? "";

  function permissionsFor(companyId: string): PermissionId[] | undefined {
    const membership = state.memberships.find(
      (m) => m.userId === actorId && m.companyId === companyId,
    );
    if (!membership) return undefined;
    const granted = new Set<PermissionId>();
    for (const roleId of membership.roleIds) {
      const role = state.roles.find((r) => r.id === roleId);
      const rolePermissions =
        role?.permissions === "all" ? permissionIds : (role?.permissions ?? []);
      rolePermissions.forEach((p) => granted.add(p));
    }
    // Stable canonical order, independent of role composition.
    return permissionIds.filter((p) => granted.has(p));
  }

  function workspace(companyId: string): CompanyWorkspace {
    const company = state.companies.find((c) => c.id === companyId);
    const permissions = permissionsFor(companyId);
    if (!company || !permissions?.includes("company.view")) {
      throw new ServiceError("COMPANY_NOT_FOUND");
    }
    return companyWorkspaceSchema.parse({ company, permissions });
  }

  function can(companyId: string, permission: PermissionId): boolean {
    return workspace(companyId).permissions.includes(permission);
  }

  function requirePermission(companyId: string, permission: PermissionId): void {
    if (!can(companyId, permission)) throw new ServiceError("FORBIDDEN");
  }

  function requireModule(companyId: string, module: WorkspaceModuleId): void {
    if (!workspace(companyId).company.modules.includes(module)) {
      throw new ServiceError("MODULE_UNAVAILABLE");
    }
  }

  /** Case-insensitive, scoped to the company; a duplicate SKU in another company is allowed. */
  function assertUniqueSku(companyId: string, sku: string, excludeProductId?: string): void {
    const normalized = sku.trim().toLowerCase();
    const clash = state.products.some(
      (p) =>
        p.companyId === companyId &&
        p.id !== excludeProductId &&
        p.sku.trim().toLowerCase() === normalized,
    );
    if (clash) throw new ServiceError("VALIDATION_FAILED");
  }

  function activeProduct(companyId: string, productId: string): Product {
    const product = state.products.find(
      (p) => p.id === productId && p.companyId === companyId && p.status === "active",
    );
    if (!product) throw new ServiceError("VALIDATION_FAILED");
    return product;
  }

  function dsrIn(companyId: string, dsrId: string) {
    const dsr = state.staff.find(
      (p) => p.id === dsrId && p.kind === "dsr" && p.companyIds.includes(companyId),
    );
    if (!dsr) throw new ServiceError("VALIDATION_FAILED");
    return dsr;
  }

  function balances(batchId: string): Record<StockBucket | "received", Decimal> {
    const totals = {
      received: new Decimal(0),
      available: new Decimal(0),
      reserved: new Decimal(0),
      quarantine: new Decimal(0),
    };
    for (const m of state.movements) {
      if (m.batchId !== batchId) continue;
      const delta = toDecimal(m.delta);
      totals[m.bucket] = totals[m.bucket].add(delta);
      if (m.kind !== "sale" && delta.gt(0)) totals.received = totals.received.add(delta);
    }
    return totals;
  }

  function batchView(layer: CostLayer): Batch {
    const b = balances(layer.id);
    return {
      ...layer,
      receivedQuantity: b.received.toString(),
      availableQuantity: b.available.toString(),
      reservedQuantity: b.reserved.toString(),
      quarantineQuantity: b.quarantine.toString(),
    };
  }

  function nextNumber(
    prefix: string,
    existing: readonly { companyId: string }[],
    companyId: string,
  ) {
    const count = existing.filter((d) => d.companyId === companyId).length + 1;
    return `${prefix}-${String(count).padStart(4, "0")}`;
  }

  /**
   * Returns the stored outcome for a repeated request key, or runs the command once. The payload
   * hash covers the normalized (parsed) input, so reordered JSON keys don't matter.
   */
  function idempotent<T extends { id: string }>(
    companyId: string,
    action: string,
    requestKey: string,
    payload: unknown,
    find: (id: string) => T | undefined,
    run: () => T,
  ): T {
    const key = [actorId, companyId, action, requestKey].join("|");
    const payloadHash = JSON.stringify(payload);
    const existing = state.idempotency.get(key);
    if (existing) {
      if (existing.payloadHash !== payloadHash) throw new ServiceError("IDEMPOTENCY_CONFLICT");
      const document = find(existing.documentId);
      if (document) return document;
    }
    const document = run();
    state.idempotency.set(key, { payloadHash, documentId: document.id });
    return document;
  }

  function dueView(item: DueItem) {
    const collected = sumAmounts(
      state.collections.flatMap((c) =>
        c.allocations.filter((a) => a.dueItemId === item.id).map((a) => a.amount),
      ),
    );
    const dsrName = state.staff.find((p) => p.id === item.dsrId)?.name ?? item.dsrId;
    return marketDueItemSchema.parse({
      ...item,
      dsrName,
      collectedAmount: collected,
      remainingAmount: roundSettlement(toDecimal(item.originalAmount).sub(toDecimal(collected))),
    });
  }

  /** Server-side redaction: cost and profit never leave the service without permission. */
  function summaryView(companyId: string, summary: DailySalesSummary): DailySalesSummary {
    const costView = can(companyId, "inventory.cost_view");
    const profitView = can(companyId, "report.profit_view");
    return dailySalesSummarySchema.parse({
      ...summary,
      cogs: costView ? summary.cogs : undefined,
      grossProfit: costView && profitView ? summary.grossProfit : undefined,
      lines: summary.lines.map((line) => ({
        ...line,
        cogs: costView ? line.cogs : undefined,
        allocations: line.allocations.map((a) => ({
          ...a,
          unitCost: costView ? a.unitCost : undefined,
          cost: costView ? a.cost : undefined,
        })),
      })),
    });
  }

  return {
    users: seed.users,
    getActorId: () => actorId,
    setActorId(userId) {
      if (!seed.users.some((u) => u.id === userId)) throw new ServiceError("VALIDATION_FAILED");
      actorId = userId;
    },
    reset() {
      state = initialState(seed);
    },

    async listWorkspaces(options?: RequestOptions) {
      await delay(latencyMs, options?.signal);
      return state.companies.flatMap((company) => {
        try {
          return [workspace(company.id)];
        } catch {
          return [];
        }
      });
    },

    async getWorkspace(companyId, options) {
      await delay(latencyMs, options?.signal);
      return workspace(companyId);
    },

    async listProducts(companyId, options) {
      await delay(latencyMs, options?.signal);
      requirePermission(companyId, "product.view");
      return productSchema.array().parse(state.products.filter((p) => p.companyId === companyId));
    },

    async createProduct(companyId, input, options) {
      await delay(latencyMs, options?.signal);
      requirePermission(companyId, "product.create");
      const parsedInput = productCreateRequestSchema.parse(input);
      assertUniqueSku(companyId, parsedInput.sku);
      const product = productSchema.parse({
        ...parsedInput,
        id: crypto.randomUUID(),
        companyId,
      });
      state.products.push(product);
      return product;
    },

    async updateProduct(companyId, productId, input, options) {
      await delay(latencyMs, options?.signal);
      requirePermission(companyId, "product.edit");
      const index = state.products.findIndex(
        (p) => p.id === productId && p.companyId === companyId,
      );
      if (index === -1) throw new ServiceError("VALIDATION_FAILED");
      const parsedInput = productCreateRequestSchema.parse(input);
      assertUniqueSku(companyId, parsedInput.sku, productId);
      const product = productSchema.parse({ ...parsedInput, id: productId, companyId });
      state.products[index] = product;
      return product;
    },

    async listBatches(companyId, options) {
      await delay(latencyMs, options?.signal);
      requirePermission(companyId, "inventory.view");
      return batchSchema
        .array()
        .parse(state.layers.filter((l) => l.companyId === companyId).map(batchView));
    },

    async listSuppliers(companyId, options) {
      await delay(latencyMs, options?.signal);
      requirePermission(companyId, "company.view");
      return supplierSchema.array().parse(state.suppliers.filter((s) => s.companyId === companyId));
    },

    async listStaff(companyId, options) {
      await delay(latencyMs, options?.signal);
      requirePermission(companyId, "company.view");
      // Anti-enumeration: never reveal companies the actor cannot access.
      const visible = (id: string) => permissionsFor(id)?.includes("company.view") ?? false;
      return staffMemberSchema
        .array()
        .parse(
          state.staff
            .filter((p) => p.companyIds.includes(companyId))
            .map((p) => ({ ...p, companyIds: p.companyIds.filter(visible) })),
        );
    },

    async listGoodsReceipts(companyId, options) {
      await delay(latencyMs, options?.signal);
      requireModule(companyId, "purchases");
      requirePermission(companyId, "purchase.view");
      return goodsReceiptSchema
        .array()
        .parse(state.receipts.filter((r) => r.companyId === companyId));
    },

    async postGoodsReceipt(companyId, input, options) {
      await delay(latencyMs, options?.signal);
      requireModule(companyId, "purchases");
      const parsed = goodsReceiptPostRequestSchema.parse(input);
      requirePermission(
        companyId,
        parsed.kind === "purchase" ? "purchase.post" : "supplier_incentive.receive",
      );
      return idempotent(
        companyId,
        "goods_receipt.post",
        parsed.requestKey,
        parsed,
        (id) => state.receipts.find((r) => r.id === id),
        () => {
          const supplier = state.suppliers.find(
            (s) => s.id === parsed.supplierId && s.companyId === companyId,
          );
          if (!supplier) throw new ServiceError("VALIDATION_FAILED");

          const receiptId = crypto.randomUUID();
          const lines = parsed.lines.map((line) => {
            const product = activeProduct(companyId, line.productId);
            const quantity = toBaseQuantity(
              line.cartons,
              line.loosePieces,
              product.piecesPerCarton,
            );
            const unitCost = toDecimal(line.unitCost);
            // A missing valuation is never a silent zero (guide 9.3a, 9.7).
            if (toDecimal(quantity).lte(0) || unitCost.lte(0)) {
              throw new ServiceError("VALIDATION_FAILED");
            }
            if (line.expiryDate && line.expiryDate < parsed.receivedDate) {
              throw new ServiceError("VALIDATION_FAILED");
            }
            return {
              productId: product.id,
              productName: product.name,
              piecesPerCartonSnapshot: product.piecesPerCarton,
              quantity,
              unitCost: roundCost(unitCost),
              lineValue: roundSettlement(unitCost.mul(toDecimal(quantity))),
              batchId: crypto.randomUUID(),
              lotId: line.lotId?.trim() || undefined,
              expiryDate: line.expiryDate,
            };
          });

          const sequence = ++state.sequence;
          const receipt = goodsReceiptSchema.parse({
            id: receiptId,
            companyId,
            number: nextNumber("GRN", state.receipts, companyId),
            kind: parsed.kind,
            supplierId: supplier.id,
            supplierName: supplier.name,
            receivedDate: parsed.receivedDate,
            reference: parsed.reference.trim(),
            postingSequence: sequence,
            postedAt: now().toISOString(),
            lines,
            totalValue: sumAmounts(lines.map((l) => l.lineValue)),
          });

          // All checks passed: append layers and movements together.
          for (const line of lines) {
            state.layers.push({
              id: line.batchId,
              companyId,
              productId: line.productId,
              lotId: line.lotId,
              expiryDate: line.expiryDate,
              receivedDate: parsed.receivedDate,
              location: "godown",
              origin: parsed.kind,
              unitCost: line.unitCost,
            });
            state.movements.push({
              sequence,
              batchId: line.batchId,
              bucket: "available",
              delta: line.quantity,
              kind: "receipt",
              sourceId: receiptId,
            });
          }
          state.receipts.push(receipt);
          return receipt;
        },
      );
    },

    async listDailySalesSummaries(companyId, options) {
      await delay(latencyMs, options?.signal);
      requireModule(companyId, "sales");
      requirePermission(companyId, "sale.view");
      return state.summaries
        .filter((s) => s.companyId === companyId)
        .map((s) => summaryView(companyId, s));
    },

    async postDailySalesSummary(companyId, input, options) {
      await delay(latencyMs, options?.signal);
      requireModule(companyId, "sales");
      requirePermission(companyId, "sale.post");
      const parsed = dailySalesSummaryPostRequestSchema.parse(input);
      const posted = idempotent(
        companyId,
        "daily_sales_summary.post",
        parsed.requestKey,
        parsed,
        (id) => state.summaries.find((s) => s.id === id),
        () => {
          const dsr = dsrIn(companyId, parsed.dsrId);
          if (
            state.summaries.some(
              (s) =>
                s.companyId === companyId &&
                s.dsrId === parsed.dsrId &&
                s.businessDate === parsed.businessDate,
            )
          ) {
            throw new ServiceError("DUPLICATE_DOCUMENT");
          }
          const productIds = parsed.lines.map((l) => l.productId);
          if (new Set(productIds).size !== productIds.length) {
            throw new ServiceError("VALIDATION_FAILED");
          }

          const summaryId = crypto.randomUUID();
          const lines = parsed.lines.map((line) => {
            const product = activeProduct(companyId, line.productId);
            const quantity = sumQuantities(line.priceSplits.map((s) => s.quantity));
            const layers = state.layers
              .filter((l) => l.companyId === companyId && l.productId === product.id)
              .map(batchView);
            const { allocations, shortfall } = allocateByPriority(
              layers,
              quantity,
              parsed.businessDate,
            );
            if (!toDecimal(shortfall).isZero()) throw new ServiceError("INSUFFICIENT_STOCK");
            const priceSplits = line.priceSplits.map((split) => ({
              quantity: split.quantity,
              unitPrice: roundCost(split.unitPrice),
              amount: priceSplitAmount(split),
            }));
            return {
              productId: product.id,
              productName: product.name,
              piecesPerCartonSnapshot: product.piecesPerCarton,
              quantity,
              priceSplits,
              allocations: allocations.map((a) => ({
                batchId: a.batchId,
                lotId: layers.find((l) => l.id === a.batchId)?.lotId,
                quantity: a.quantity,
                unitCost: roundCost(a.unitCost),
                cost: allocationCost([a]),
              })),
              netSales: sumAmounts(priceSplits.map((s) => s.amount)),
              cogs: allocationCost(allocations),
            };
          });

          let totals;
          try {
            totals = saleTotals(
              lines.map((l) => l.netSales),
              lines.map((l) => l.cogs),
              parsed.cashCollected,
            );
          } catch {
            throw new ServiceError("VALIDATION_FAILED");
          }

          const sequence = ++state.sequence;
          const summary = dailySalesSummarySchema.parse({
            id: summaryId,
            companyId,
            number: nextNumber("DS", state.summaries, companyId),
            status: "posted",
            businessDate: parsed.businessDate,
            dsrId: dsr.id,
            dsrName: dsr.name,
            postingSequence: sequence,
            postedAt: now().toISOString(),
            lines,
            ...totals,
          });

          for (const line of lines) {
            for (const a of line.allocations) {
              state.movements.push({
                sequence,
                batchId: a.batchId,
                bucket: "available",
                delta: toDecimal(a.quantity).neg().toString(),
                kind: "sale",
                sourceId: summaryId,
              });
            }
          }
          if (toDecimal(totals.marketDue).gt(0)) {
            state.dueItems.push({
              id: crypto.randomUUID(),
              companyId,
              dsrId: dsr.id,
              businessDate: parsed.businessDate,
              sourceSummaryId: summaryId,
              sourceNumber: summary.number,
              originalAmount: totals.marketDue,
            });
          }
          state.summaries.push(summary);
          return summary;
        },
      );
      return summaryView(companyId, posted);
    },

    async listMarketDues(companyId, options) {
      await delay(latencyMs, options?.signal);
      requireModule(companyId, "sales");
      requirePermission(companyId, "sale.view");
      return state.dueItems.filter((d) => d.companyId === companyId).map(dueView);
    },

    async listOldDueCollections(companyId, options) {
      await delay(latencyMs, options?.signal);
      requireModule(companyId, "sales");
      requirePermission(companyId, "sale.view");
      return oldDueCollectionSchema
        .array()
        .parse(state.collections.filter((c) => c.companyId === companyId));
    },

    async postOldDueCollection(companyId, input, options) {
      await delay(latencyMs, options?.signal);
      requireModule(companyId, "sales");
      requirePermission(companyId, "collection.post");
      const parsed = oldDueCollectionPostRequestSchema.parse(input);
      return idempotent(
        companyId,
        "old_due_collection.post",
        parsed.requestKey,
        parsed,
        (id) => state.collections.find((c) => c.id === id),
        () => {
          const dsr = dsrIn(companyId, parsed.dsrId);
          if (toDecimal(parsed.amount).lte(0)) throw new ServiceError("VALIDATION_FAILED");
          const open = state.dueItems
            .filter((d) => d.companyId === companyId && d.dsrId === dsr.id)
            .map(dueView);
          let allocations;
          try {
            allocations = allocateOldestFirst(open, parsed.amount);
          } catch {
            throw new ServiceError("AMOUNT_EXCEEDS_DUE");
          }
          const collection = oldDueCollectionSchema.parse({
            id: crypto.randomUUID(),
            companyId,
            number: nextNumber("COL", state.collections, companyId),
            dsrId: dsr.id,
            dsrName: dsr.name,
            collectedDate: parsed.collectedDate,
            amount: roundSettlement(parsed.amount),
            postingSequence: ++state.sequence,
            postedAt: now().toISOString(),
            allocations: allocations.map((a) => {
              const item = open.find((d) => d.id === a.dueItemId);
              return {
                dueItemId: a.dueItemId,
                dueDate: item?.businessDate,
                sourceNumber: item?.sourceNumber,
                amount: a.amount,
              };
            }),
          });
          state.collections.push(collection);
          return collection;
        },
      );
    },

    async getDashboardSummary(companyId, date, options) {
      await delay(latencyMs, options?.signal);
      requirePermission(companyId, "company.view");
      const reportDate = businessDateSchema.parse(date);
      const summaries = state.summaries.filter(
        (s) => s.companyId === companyId && s.businessDate === reportDate,
      );
      const companyCollections = state.collections.filter((c) => c.companyId === companyId);
      const collections = companyCollections.filter((c) => c.collectedDate === reportDate);
      const receipts = state.receipts.filter(
        (r) => r.companyId === companyId && r.receivedDate === reportDate,
      );

      // Outstanding as of the end of the date: dues raised by then, less what was collected by then.
      const collectedBy = companyCollections.filter((c) => c.collectedDate <= reportDate);
      const outstanding = state.dueItems
        .filter((d) => d.companyId === companyId && d.businessDate <= reportDate)
        .map((d) => {
          const collected = sumAmounts(
            collectedBy.flatMap((c) =>
              c.allocations.filter((a) => a.dueItemId === d.id).map((a) => a.amount),
            ),
          );
          return toDecimal(d.originalAmount).sub(toDecimal(collected)).toString();
        });

      const dsrIds = [
        ...new Set([...summaries.map((s) => s.dsrId), ...collections.map((c) => c.dsrId)]),
      ];
      const byDsr = dsrIds.map((dsrId) => {
        const own = summaries.filter((s) => s.dsrId === dsrId);
        return {
          dsrId,
          dsrName: state.staff.find((p) => p.id === dsrId)?.name ?? dsrId,
          netSales: sumAmounts(own.map((s) => s.netSales)),
          salesCash: sumAmounts(own.map((s) => s.cashCollected)),
          marketDueCreated: sumAmounts(own.map((s) => s.marketDue)),
          oldDuesCollected: sumAmounts(
            collections.filter((c) => c.dsrId === dsrId).map((c) => c.amount),
          ),
        };
      });

      const salesCash = sumAmounts(summaries.map((s) => s.cashCollected));
      const oldDuesCollected = sumAmounts(collections.map((c) => c.amount));
      const costView = can(companyId, "inventory.cost_view");
      return dashboardSummarySchema.parse({
        date: reportDate,
        netSales: sumAmounts(summaries.map((s) => s.netSales)),
        salesCash,
        oldDuesCollected,
        cashCollected: sumAmounts([salesCash, oldDuesCollected]),
        marketDueCreated: sumAmounts(summaries.map((s) => s.marketDue)),
        marketDueOutstanding: roundSettlement(sumAmounts(outstanding)),
        postedSummaryCount: summaries.length,
        postedReceiptCount: receipts.length,
        byDsr: byDsr.sort((a, b) => a.dsrName.localeCompare(b.dsrName)),
        grossProfit: can(companyId, "report.profit_view")
          ? sumAmounts(summaries.map((s) => s.grossProfit ?? "0"))
          : undefined,
        receivedValue: costView ? sumAmounts(receipts.map((r) => r.totalValue)) : undefined,
        stockValue: costView
          ? sumAmounts(
              state.layers
                .filter((l) => l.companyId === companyId)
                .map((l) => balances(l.id).available.mul(toDecimal(l.unitCost)).toString()),
            )
          : undefined,
      });
    },

    // Masters and configuration run on the real API; the demo only shows its seed data.
    async getProductHistory(companyId, productId, options) {
      await delay(latencyMs, options?.signal);
      requirePermission(companyId, "product.view");
      const product = state.products.find((p) => p.id === productId && p.companyId === companyId);
      if (!product) throw new ServiceError("VALIDATION_FAILED");
      return productHistorySchema.parse({
        packs: [
          {
            id: `${product.id}-base`,
            productId: product.id,
            piecesPerCarton: product.piecesPerCarton,
            effectiveFrom: null,
          },
        ],
        prices: [],
      });
    },
    addProductPack: demoReadOnly,
    setProductPrice: demoReadOnly,
    createCompany: demoReadOnly,
    createSupplier: demoReadOnly,
    updateSupplier: demoReadOnly,

    async listStaffRecords(companyId, options) {
      await delay(latencyMs, options?.signal);
      requirePermission(companyId, "company.view");
      const visible = (id: string) => permissionsFor(id)?.includes("company.view") ?? false;
      return staffRecordSchema.array().parse(
        state.staff
          .filter((p) => p.companyIds.includes(companyId))
          .map((p) => ({
            id: p.id,
            name: p.name,
            employer: p.kind === "sr" ? "supplier" : "distributor",
            status: "active",
            assignments: p.companyIds.filter(visible).map((id) => ({
              id: `${p.id}-${id}`,
              companyId: id,
              roleId: DEMO_ROLES[p.kind].id,
              roleName: DEMO_ROLES[p.kind].name,
              roleKind: p.kind,
              from: "2026-01-01",
              to: null,
            })),
          })),
      );
    },
    listAllStaff: demoReadOnly,
    createStaff: demoReadOnly,
    updateStaff: demoReadOnly,
    addStaffAssignment: demoReadOnly,
    updateStaffAssignment: demoReadOnly,

    async listConfig(list, options) {
      await delay(latencyMs, options?.signal);
      return (list === "staffRoles" ? Object.values(DEMO_ROLES) : []) as never;
    },
    createConfig: demoReadOnly,
    updateConfig: demoReadOnly,
    listRoles: demoReadOnly,
    createRole: demoReadOnly,
    updateRole: demoReadOnly,
    listUsers: demoReadOnly,
    createUser: demoReadOnly,
    updateUser: demoReadOnly,
    resetUserPassword: demoReadOnly,

    getOpening: demoReadOnly,
    saveOpening: demoReadOnly,
    inspectOpeningWorkbook: demoReadOnly,
    importOpeningWorkbook: demoReadOnly,
    downloadOpeningTemplate: demoReadOnly,
    approveOpening: demoReadOnly,
    activateOpening: demoReadOnly,
  };
}

async function demoReadOnly(): Promise<never> {
  throw new ServiceError("MODULE_UNAVAILABLE");
}

const DEMO_ROLES: Record<StaffRoleKind, StaffRole> = {
  dsr: { id: "demo-role-dsr", name: "ডিএসআর", kind: "dsr", active: true },
  sr: { id: "demo-role-sr", name: "এসআর", kind: "sr", active: true },
  general: { id: "demo-role-general", name: "কর্মী", kind: "general", active: true },
};
