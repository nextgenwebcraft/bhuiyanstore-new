-- D104 (owner 2026-10-29): no separate অর্ডার মূল্য at opening; ক্রয়মূল্য (unit cost) now seeds
-- both the product's cost price and its starting order price (dueFromCompany valuation, the
-- excess-receipt rate, and the price a first order defaults to). The live order/receipt screen's
-- own কার্টন রেট / order price (D57) is unchanged.
ALTER TABLE "opening_stock_line" DROP COLUMN "order_price";
