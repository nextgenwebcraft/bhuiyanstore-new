import { describe, expect, it } from "vitest";
import {
  competingPeerDraftTakes,
  draftStockShortages,
  draftStockTakes,
} from "./stock-guard";

describe("draft stock guard (D136)", () => {
  it("nets issued − returned per product and batch", () => {
    const { byProduct, byBatch } = draftStockTakes([
      { productId: "p1", batchKey: "b1", issued: "100", returned: "20" },
      { productId: "p1", batchKey: "b1", issued: "50", returned: "0" },
      { productId: "p1", batchKey: "b2", issued: "10", returned: "10" },
    ]);
    expect(byProduct.get("p1")).toBe("130");
    expect(byBatch.get("p1|b1")?.net).toBe("130");
    expect(byBatch.has("p1|b2")).toBe(false);
  });

  it("flags a draft that overdraws a named batch while product total still looks fine", () => {
    const shortages = draftStockShortages(
      [
        {
          date: "2026-11-17",
          products: [
            {
              productId: "p1",
              stock: "200",
              batches: [
                { key: "b1", quantity: "148", seq: 1 },
                { key: "b2", quantity: "52", seq: 2 },
              ],
            },
          ],
        },
      ],
      [{ productId: "p1", batchKey: "b1", issued: "360", returned: "0" }],
    );
    expect(shortages).toEqual([
      {
        productId: "p1",
        productName: "",
        date: "2026-11-17",
        stock: "-212",
        batchSeq: 1,
      },
    ]);
  });

  it("allows a draft that fits posted batch stock", () => {
    expect(
      draftStockShortages(
        [
          {
            date: "2026-11-17",
            products: [
              {
                productId: "p1",
                stock: "200",
                batches: [{ key: "b1", quantity: "148", seq: 1 }],
              },
            ],
          },
        ],
        [{ productId: "p1", batchKey: "b1", issued: "100", returned: "20" }],
      ),
    ).toEqual([]);
  });

  it("D137: two drafts on the same batch together overdraw even when each alone fits", () => {
    const days = [
      {
        date: "2026-11-17",
        products: [
          {
            productId: "p1",
            stock: "100",
            batches: [{ key: "b1", quantity: "100", seq: 1 }],
          },
        ],
      },
    ];
    const thisSheet = [{ productId: "p1", batchKey: "b1", issued: "60", returned: "0" }];
    const peer = [{ productId: "p1", batchKey: "b1", issued: "50", returned: "0" }];
    expect(draftStockShortages(days, thisSheet)).toEqual([]);
    expect(draftStockShortages(days, peer)).toEqual([]);
    expect(draftStockShortages(days, [...peer, ...thisSheet])).toEqual([
      {
        productId: "p1",
        productName: "",
        date: "2026-11-17",
        stock: "-10",
        batchSeq: 1,
      },
    ]);
  });

  it("D138: peer takes on another product are ignored for this sheet's soft-reserve", () => {
    const thisSheet = [{ productId: "gear", batchKey: "b1", issued: "24", returned: "0" }];
    const peers = [
      { productId: "googly", batchKey: "b1", issued: "500", returned: "0" },
      { productId: "gear", batchKey: "b1", issued: "10", returned: "0" },
      { productId: "gear", batchKey: "b2", issued: "99", returned: "0" },
    ];
    expect(competingPeerDraftTakes(thisSheet, peers)).toEqual([
      { productId: "gear", batchKey: "b1", issued: "10", returned: "0" },
    ]);
  });

  it("D138: unrelated peer oversell does not appear in this sheet's shortage", () => {
    const days = [
      {
        date: "2026-11-16",
        products: [
          {
            productId: "gear",
            stock: "100",
            batches: [{ key: "b1", quantity: "100", seq: 1 }],
          },
          {
            productId: "googly",
            stock: "-286",
            batches: [{ key: "b1", quantity: "-286", seq: 1 }],
          },
        ],
      },
    ];
    const thisSheet = [{ productId: "gear", batchKey: "b1", issued: "24", returned: "0" }];
    const peers = [{ productId: "googly", batchKey: "b1", issued: "48", returned: "0" }];
    const combined = [...competingPeerDraftTakes(thisSheet, peers), ...thisSheet];
    expect(draftStockShortages(days, combined)).toEqual([]);
  });
});
