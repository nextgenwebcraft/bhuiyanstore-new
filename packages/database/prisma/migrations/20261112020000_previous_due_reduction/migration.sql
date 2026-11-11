-- D128: apply Previous Due against a month's profit — reduces due balance and distributable profit.
CREATE TABLE "previous_due_reduction" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "previous_due_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" TEXT NOT NULL,

    CONSTRAINT "previous_due_reduction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "previous_due_reduction_tenant_id_month_idx" ON "previous_due_reduction"("tenant_id", "month");

CREATE INDEX "previous_due_reduction_previous_due_id_idx" ON "previous_due_reduction"("previous_due_id");

ALTER TABLE "previous_due_reduction" ADD CONSTRAINT "previous_due_reduction_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "previous_due_reduction" ADD CONSTRAINT "previous_due_reduction_previous_due_id_fkey" FOREIGN KEY ("previous_due_id") REFERENCES "previous_due"("id") ON DELETE CASCADE ON UPDATE CASCADE;
