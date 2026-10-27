-- D94 (owner 2026-10-28): mark a shareholder's month as paid on the master panel; a missing row
-- means not paid. Existence only, no amount (the amount is always the computed শেয়ারহোল্ডারের
-- প্রফিট for that month).
CREATE TABLE "shareholder_payout" (
    "id" TEXT NOT NULL,
    "shareholder_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_by_id" TEXT NOT NULL,

    CONSTRAINT "shareholder_payout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shareholder_payout_shareholder_id_month_key" ON "shareholder_payout"("shareholder_id", "month");

ALTER TABLE "shareholder_payout" ADD CONSTRAINT "shareholder_payout_shareholder_id_fkey" FOREIGN KEY ("shareholder_id") REFERENCES "shareholder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
