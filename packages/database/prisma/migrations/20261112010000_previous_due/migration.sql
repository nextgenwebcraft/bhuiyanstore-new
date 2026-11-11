-- D128: tenant-wide Previous Due (reason + amount). Open amounts reduce master distributable
-- profit before the shareholder split; amount 0 is settled.
CREATE TABLE "previous_due" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "previous_due_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "previous_due_tenant_id_idx" ON "previous_due"("tenant_id");

ALTER TABLE "previous_due" ADD CONSTRAINT "previous_due_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
