import { Decimal, toDecimal, type DecimalInput } from "../decimal";

/**
 * Damage case legs (D17, guide §9.7): one case, independent buyer and company legs, tracked as
 * quantities. Legacy Excel damage amounts are evidence only and never become quantities.
 */

export const damageOrigins = ["buyerExchange", "ownedStock"] as const;
export type DamageOrigin = (typeof damageOrigins)[number];

export const damageEventKinds = [
  /** Replacement given to the buyer. */
  "buyerReplacement",
  /** Damaged goods sent to the company. */
  "companyDispatch",
  "companyAccept",
  "companyReject",
  /** New goods received from the company for accepted damage. */
  "companyReplacement",
  /** Approved disposal of damaged goods still here (unrecoverable). */
  "writeOff",
  /** Money returned by the company for accepted damage (D33); lowers what we owe it. */
  "companyRefund",
] as const;
export type DamageEventKind = (typeof damageEventKinds)[number];

export type DamageLineProgress = {
  received: string;
  buyerReplaced: string;
  buyerPending: string;
  sent: string;
  accepted: string;
  rejected: string;
  awaitingAcceptance: string;
  companyReplaced: string;
  companyRefunded: string;
  companyPending: string;
  writtenOff: string;
  /** Damaged pieces still held by the distributor: received − sent + rejected (back) − written off. */
  stillHere: string;
};

export type DamageEventError =
  | "noBuyerLeg"
  | "overReplacement"
  | "overDispatch"
  | "overAcceptance"
  | "overCompanyReplacement"
  | "overWriteOff";

/** Kinds that settle accepted pieces: goods or money from the company. */
export const companyReturnKinds = ["companyReplacement", "companyRefund"] as const;

const ZERO = new Decimal(0);

/** Progress of one case line from its posted (not reversed) events. */
export function damageLineProgress(
  origin: DamageOrigin,
  received: DecimalInput,
  events: readonly { kind: DamageEventKind; quantity: DecimalInput }[],
): DamageLineProgress {
  const total = (kind: DamageEventKind) =>
    events.filter((e) => e.kind === kind).reduce((s, e) => s.add(toDecimal(e.quantity)), ZERO);
  const r = toDecimal(received);
  const buyerReplaced = total("buyerReplacement");
  const sent = total("companyDispatch");
  const accepted = total("companyAccept");
  const rejected = total("companyReject");
  const companyReplaced = total("companyReplacement");
  const companyRefunded = total("companyRefund");
  const writtenOff = total("writeOff");
  const buyerPending = origin === "buyerExchange" ? r.sub(buyerReplaced) : ZERO;
  return {
    received: r.toString(),
    buyerReplaced: buyerReplaced.toString(),
    buyerPending: buyerPending.toString(),
    sent: sent.toString(),
    accepted: accepted.toString(),
    rejected: rejected.toString(),
    awaitingAcceptance: sent.sub(accepted).sub(rejected).toString(),
    companyReplaced: companyReplaced.toString(),
    companyRefunded: companyRefunded.toString(),
    companyPending: accepted.sub(companyReplaced).sub(companyRefunded).toString(),
    writtenOff: writtenOff.toString(),
    // D53: pieces the company rejected come back to us, so they are here again.
    stillHere: r.sub(sent).add(rejected).sub(writtenOff).toString(),
  };
}

/** Why a new event of `quantity` would over-allocate the line, or null when it fits. */
export function damageEventError(
  origin: DamageOrigin,
  progress: DamageLineProgress,
  kind: DamageEventKind,
  quantity: DecimalInput,
): DamageEventError | null {
  const q = toDecimal(quantity);
  const within = (limit: string) => q.lte(toDecimal(limit));
  switch (kind) {
    case "buyerReplacement":
      if (origin !== "buyerExchange") return "noBuyerLeg";
      return within(progress.buyerPending) ? null : "overReplacement";
    case "companyDispatch":
      return within(progress.stillHere) ? null : "overDispatch";
    case "companyAccept":
    case "companyReject":
      return within(progress.awaitingAcceptance) ? null : "overAcceptance";
    case "companyReplacement":
    case "companyRefund":
      return within(progress.companyPending) ? null : "overCompanyReplacement";
    case "writeOff":
      return within(progress.stillHere) ? null : "overWriteOff";
  }
}

/** A case is settled when nothing is pending on either leg and no damaged piece is still here. */
export function damageCaseSettled(lines: readonly DamageLineProgress[]): boolean {
  return lines.every(
    (l) =>
      toDecimal(l.buyerPending).isZero() &&
      toDecimal(l.awaitingAcceptance).isZero() &&
      toDecimal(l.companyPending).isZero() &&
      toDecimal(l.stillHere).isZero(),
  );
}
