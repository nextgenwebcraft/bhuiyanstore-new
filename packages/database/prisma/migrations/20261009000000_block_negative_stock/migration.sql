-- D34: per-company switch that refuses postings taking a product's stock below zero.
ALTER TABLE "company" ADD COLUMN "block_negative_stock" BOOLEAN NOT NULL DEFAULT false;
