-- D112: fixed login roles (manager/dsr) + DSR day handover approval.

ALTER TABLE "role" ADD COLUMN "kind" TEXT;

CREATE UNIQUE INDEX "role_tenant_id_kind_key" ON "role"("tenant_id", "kind");

ALTER TABLE "role" ADD CONSTRAINT "role_kind_check"
  CHECK ("kind" IS NULL OR "kind" IN ('manager', 'dsr'));

-- At most one super-admin per tenant (NULL tenant_id rows ignored).
CREATE UNIQUE INDEX "user_one_super_admin_per_tenant"
  ON "user" ("tenant_id")
  WHERE "is_super_admin" = true AND "tenant_id" IS NOT NULL;

ALTER TABLE "dsr_day" ADD COLUMN "handover_status" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "dsr_day" ADD COLUMN "handover_submitted_at" TIMESTAMP(3);
ALTER TABLE "dsr_day" ADD COLUMN "handover_submitted_by_id" TEXT;
ALTER TABLE "dsr_day" ADD COLUMN "handover_approved_at" TIMESTAMP(3);
ALTER TABLE "dsr_day" ADD COLUMN "handover_approved_by_id" TEXT;

ALTER TABLE "dsr_day" ADD CONSTRAINT "dsr_day_handover_status_check"
  CHECK ("handover_status" IN ('none', 'pending', 'approved'));

CREATE INDEX "dsr_day_company_id_handover_status_idx"
  ON "dsr_day"("company_id", "handover_status");
