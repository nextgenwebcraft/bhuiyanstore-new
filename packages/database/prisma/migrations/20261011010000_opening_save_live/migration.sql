-- D43: the opening is live once its cutoff date is saved; no approve/activate step.
ALTER TABLE "opening_session"
  DROP COLUMN "status",
  DROP COLUMN "approved_by_id",
  DROP COLUMN "approved_at",
  DROP COLUMN "activated_by_id",
  DROP COLUMN "activated_at";

DELETE FROM "role_permission" WHERE "permission" IN ('opening.approve', 'opening.activate');

-- Opening prices are written at save time and tagged so a later save can replace them.
ALTER TABLE "price_change" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual';

-- Prices an earlier activation wrote from the opening belong to the opening.
UPDATE "price_change" pc
SET "source" = 'opening'
FROM "opening_stock_line" l
JOIN "opening_session" s ON s."id" = l."session_id"
WHERE pc."product_id" = l."product_id"
  AND pc."effective_from" = s."cutoff_date"
  AND pc."price" = CASE pc."kind"
    WHEN 'cost' THEN l."unit_cost"
    WHEN 'sale' THEN l."sale_price"
    WHEN 'order' THEN l."order_price"
  END;
