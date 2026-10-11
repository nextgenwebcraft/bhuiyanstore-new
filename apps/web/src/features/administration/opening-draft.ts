import {
  openingSectionKinds,
  type Opening,
  type OpeningBalanceKind,
  type OpeningBalanceSectionId,
  type OpeningSectionId,
  type OpeningSectionSaveRequest,
  type Shop,
  type StaffMember,
} from "@bsd/contracts";
import { OPENING_KIND_EFFECTS, toBaseQuantity, toCartonDisplay } from "@bsd/domain";
import { normalizeDigits, t } from "@bsd/i18n";

/** The entered values of the opening screen and how they become a section save (D43). */

export const stockFields = [
  "cartons",
  "loose",
  "unitCost",
  "salePrice",
  "orderPrice",
  "dueFromCompany",
] as const;
export type StockField = (typeof stockFields)[number];
export type StockDraft = Record<StockField, string> & { note: string };
export const blankStock: StockDraft = {
  cartons: "",
  loose: "",
  unitCost: "",
  salePrice: "",
  orderPrice: "",
  dueFromCompany: "",
  note: "",
};

export type BalanceDraft = { amount: string; note: string };
export type Draft = {
  stock: Record<string, StockDraft>;
  balances: Record<string, BalanceDraft>;
};
export type Party = { staffId: string | null; cashAccountId: string | null; shopId: string | null };
export const noParty: Party = { staffId: null, cashAccountId: null, shopId: null };

export const keyOf = (kind: OpeningBalanceKind, party: Party) =>
  `${kind}|${party.shopId ?? party.staffId ?? party.cashAccountId ?? ""}`;

export const isSectionId = (value: string | null): value is OpeningSectionId =>
  value !== null && (["stock", ...Object.keys(openingSectionKinds)] as string[]).includes(value);

export const sizeOf = (line: Opening["stock"][number]) => line.piecesPerCarton ?? "1";

/** Opening pieces are stored as one total; cartons + loose pieces are entry only. */
export function piecesOf(line: Opening["stock"][number], d: StockDraft | undefined): string | null {
  const cartons = normalizeDigits(d?.cartons ?? "").trim();
  const loose = normalizeDigits(d?.loose ?? "").trim();
  if (cartons === "" && loose === "") return null;
  if (!/^\d+$/.test(cartons || "0") || !/^\d+$/.test(loose || "0")) return "invalid";
  return toBaseQuantity(cartons || "0", loose || "0", sizeOf(line));
}

export function draftOf(view: Opening): Draft {
  return {
    stock: Object.fromEntries(
      view.stock.map((l) => {
        const split = l.pieces === null ? null : toCartonDisplay(l.pieces, sizeOf(l));
        return [
          l.productId,
          {
            cartons: split ? split.cartons : "",
            loose: split ? split.loosePieces : "",
            unitCost: l.unitCost ?? "",
            salePrice: l.salePrice ?? "",
            orderPrice: l.orderPrice ?? "",
            dueFromCompany: l.dueFromCompany ?? "",
            note: l.note,
          },
        ];
      }),
    ),
    balances: Object.fromEntries(
      view.balances.map((b) => [keyOf(b.kind, b), { amount: b.amount ?? "", note: b.note }]),
    ),
  };
}

const blankToNull = (value: string) => {
  const v = normalizeDigits(value).trim();
  return v === "" ? null : v;
};

/**
 * The save request for one section; rows the user never touched stay out of it, and a blank
 * amount is sent as blank (it counts as 0 on the server).
 */
export function sectionRequestOf(
  view: Opening,
  draft: Draft,
  section: OpeningSectionId,
): OpeningSectionSaveRequest {
  if (section === "stock") {
    return {
      section,
      version: view.version,
      stock: view.stock.map((l) => {
        const d = draft.stock[l.productId];
        return {
          productId: l.productId,
          pieces: piecesOf(l, d),
          unitCost: blankToNull(d?.unitCost ?? ""),
          salePrice: blankToNull(d?.salePrice ?? ""),
          orderPrice: blankToNull(d?.orderPrice ?? ""),
          dueFromCompany: blankToNull(d?.dueFromCompany ?? ""),
          note: d?.note.trim() ?? "",
        };
      }),
    };
  }
  const kinds: readonly OpeningBalanceKind[] = openingSectionKinds[section];
  const existing = new Set(view.balances.map((b) => keyOf(b.kind, b)));
  return {
    section,
    version: view.version,
    balances: Object.entries(draft.balances)
      .filter(([key, b]) => {
        const kind = key.split("|")[0] as OpeningBalanceKind;
        return (
          kinds.includes(kind) &&
          (existing.has(key) || b.amount.trim() !== "" || b.note.trim() !== "")
        );
      })
      .map(([key, b]) => {
        const [kind = "", partyId = ""] = key.split("|");
        const party = OPENING_KIND_EFFECTS[kind as OpeningBalanceKind].party;
        return {
          kind: kind as OpeningBalanceKind,
          staffId: party === "staff" || party === "optionalStaff" ? partyId || null : null,
          cashAccountId: party === "cashAccount" ? partyId || null : null,
          shopId: party === "shop" ? partyId || null : null,
          amount: blankToNull(b.amount),
          note: b.note.trim(),
        };
      }),
  };
}

export const isSectionDirty = (view: Opening, draft: Draft, section: OpeningSectionId) =>
  JSON.stringify(sectionRequestOf(view, draft, section)) !==
  JSON.stringify(sectionRequestOf(view, draftOf(view), section));

// ---------------------------------------------------------------- balance rows

export type BalanceRow = {
  kind: OpeningBalanceKind;
  party: Party;
  label: string;
  group?: string | undefined;
};

export const kindLabel = (kind: OpeningBalanceKind) => t(`opening.kind.${kind}`);

/** SR kinds are for SRs only and the rest never for an SR (D18, D02). */
function staffKinds(member: StaffMember): OpeningBalanceKind[] {
  return openingSectionKinds.staff.filter(
    (kind) => (OPENING_KIND_EFFECTS[kind].personKind === "sr") === (member.kind === "sr"),
  );
}

/** Lines already saved for people no longer listed still show, so nothing hides. */
function withExisting(
  rows: BalanceRow[],
  view: Opening,
  kinds: readonly OpeningBalanceKind[],
  label: (p: Party) => string,
): BalanceRow[] {
  const shown = new Set(rows.map((r) => keyOf(r.kind, r.party)));
  const extra = view.balances
    .filter((b) => kinds.includes(b.kind) && !shown.has(keyOf(b.kind, b)))
    .map((b) => {
      const party: Party = { staffId: b.staffId, cashAccountId: b.cashAccountId, shopId: b.shopId };
      return { kind: b.kind, party, label: kindLabel(b.kind), group: label(party) };
    });
  return [...rows, ...extra];
}

/** One row per party, labelled by the party; used where each party has a single kind. */
const flatten = (rows: BalanceRow[]) =>
  rows.map((r) => (r.group ? { ...r, label: r.group, group: undefined } : r));

export type BalanceParties = {
  members: readonly StaffMember[];
  shops: readonly Shop[];
  cashAccounts: readonly { id: string; name: string }[];
  nameOf: (party: Party) => string;
};

/** The rows of a money section: who can carry a balance of its kinds. */
export function balanceRowsOf(
  section: OpeningBalanceSectionId,
  view: Opening,
  { members, shops, cashAccounts, nameOf }: BalanceParties,
): BalanceRow[] {
  const kinds = openingSectionKinds[section];
  if (section === "marketDue") {
    return flatten(
      withExisting(
        [
          { kind: "market_due", party: noParty, label: t("opening.legacy") },
          ...members
            .filter((m) => m.kind === "dsr")
            .map((m) => ({
              kind: "market_due" as const,
              party: { ...noParty, staffId: m.id },
              label: m.name,
            })),
        ],
        view,
        kinds,
        nameOf,
      ),
    );
  }
  if (section === "shopDue") {
    return flatten(
      withExisting(
        shops
          .filter((s) => s.status === "active")
          .map((s) => ({
            kind: "shop_due" as const,
            party: { ...noParty, shopId: s.id },
            label: s.name,
          })),
        view,
        kinds,
        nameOf,
      ),
    );
  }
  if (section === "staff") {
    return withExisting(
      members.flatMap((m) =>
        staffKinds(m).map((kind) => ({
          kind,
          party: { ...noParty, staffId: m.id },
          label: kindLabel(kind),
          group: m.name,
        })),
      ),
      view,
      kinds,
      nameOf,
    );
  }
  if (section === "company") {
    return [
      { kind: "company_payable", party: noParty, label: kindLabel("company_payable") },
      { kind: "company_advance", party: noParty, label: kindLabel("company_advance") },
    ];
  }
  return flatten(
    withExisting(
      cashAccounts.map((a) => ({
        kind: "cash" as const,
        party: { ...noParty, cashAccountId: a.id },
        label: a.name,
      })),
      view,
      kinds,
      nameOf,
    ),
  );
}
