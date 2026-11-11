-- TSM login role + pending stock orders (await Manager/Super Admin approve).
ALTER TABLE "role" DROP CONSTRAINT IF EXISTS "role_kind_check";
ALTER TABLE "role" ADD CONSTRAINT "role_kind_check"
  CHECK ("kind" IS NULL OR "kind" IN ('manager', 'dsr', 'tsm'));

ALTER TABLE "stock_entry" DROP CONSTRAINT IF EXISTS "stock_entry_status";
ALTER TABLE "stock_entry" ADD CONSTRAINT "stock_entry_status"
  CHECK ("status" IN ('pending', 'posted', 'reversed'));
