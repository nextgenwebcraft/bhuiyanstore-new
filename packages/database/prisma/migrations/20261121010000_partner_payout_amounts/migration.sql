-- D143: partner payouts store the paid amount (snapshot) and its per-company parts.
-- `amount` is NOT NULL with no default on purpose: legacy D94 rows carried no amount, and
-- guessing one would rewrite history. Production had zero shareholder_payout rows on 2026-11-21;
-- if any exist where this runs, the migration fails loudly instead of inventing a figure.
ALTER TABLE "shareholder_payout" ADD COLUMN "amount" DECIMAL(14,2) NOT NULL;
ALTER TABLE "shareholder_payout" ADD COLUMN "note" TEXT;

CREATE INDEX "shareholder_payout_month_idx" ON "shareholder_payout"("month");

CREATE TABLE "shareholder_payout_line" (
    "id" TEXT NOT NULL,
    "payout_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "invest" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "shareholder_payout_line_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shareholder_payout_line_payout_id_company_id_key" ON "shareholder_payout_line"("payout_id", "company_id");

ALTER TABLE "shareholder_payout_line" ADD CONSTRAINT "shareholder_payout_line_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "shareholder_payout"("id") ON DELETE CASCADE ON UPDATE CASCADE;
