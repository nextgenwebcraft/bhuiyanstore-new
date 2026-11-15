-- D34: stock block is always on (product + named batch); remove the optional switch.
ALTER TABLE "company" ALTER COLUMN "block_negative_stock" SET DEFAULT true;
UPDATE "company" SET "block_negative_stock" = true WHERE "block_negative_stock" = false;
