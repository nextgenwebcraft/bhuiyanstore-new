-- D118: receipts may carry free_pieces (paid and free received separately). Carton rate /
-- pieces_per_carton stay order-only. Pieces may be 0 on a receipt that only takes free goods.
ALTER TABLE "stock_entry" DROP CONSTRAINT "stock_entry_pieces_whole_positive";
ALTER TABLE "stock_entry" ADD CONSTRAINT "stock_entry_pieces_whole_positive" CHECK (
    "pieces" = trunc("pieces")
    AND (
        "pieces" > 0
        OR (
            "kind" IN ('order', 'receipt')
            AND "free_pieces" IS NOT NULL
            AND "free_pieces" > 0
        )
    )
);

ALTER TABLE "stock_entry" DROP CONSTRAINT "stock_entry_order_terms";
ALTER TABLE "stock_entry" ADD CONSTRAINT "stock_entry_order_terms" CHECK (
    ("carton_rate" IS NULL OR "kind" = 'order')
    AND ("pieces_per_carton" IS NULL OR "kind" = 'order')
    AND ("free_pieces" IS NULL OR "kind" IN ('order', 'receipt'))
    AND ("free_pieces" IS NULL OR ("free_pieces" >= 0 AND "free_pieces" = trunc("free_pieces")))
    AND ("carton_rate" IS NULL OR "carton_rate" >= 0)
    AND ("pieces_per_carton" IS NULL OR "pieces_per_carton" > 0)
);
