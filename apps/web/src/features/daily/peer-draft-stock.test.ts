import { describe, expect, it } from "vitest";
import { peerDraftReservedNet, type PeerDraftTake } from "./dsr-sheet-entry";

describe("peer draft reserved net (D137)", () => {
  const peers: PeerDraftTake[] = [
    { productId: "p1", batchKey: "b1", issued: "48", returned: "0" },
    { productId: "p1", batchKey: "b1", issued: "24", returned: "12" },
    { productId: "p1", batchKey: "b2", issued: "100", returned: "0" },
    { productId: "p2", batchKey: "b1", issued: "10", returned: "20" },
  ];

  it("sums positive issued − returned for the matching product/batch", () => {
    expect(peerDraftReservedNet(peers, "p1", "b1")).toBe("60");
  });

  it("ignores other batches and negative nets", () => {
    expect(peerDraftReservedNet(peers, "p1", "b2")).toBe("100");
    expect(peerDraftReservedNet(peers, "p2", "b1")).toBe("0");
    expect(peerDraftReservedNet(peers, "p9", "b1")).toBe("0");
  });
});
