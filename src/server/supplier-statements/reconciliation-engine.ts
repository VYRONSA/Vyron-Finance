/**
 * SD-3D — the supplier-statement reconciliation engine.
 *
 * PURE and READ-ONLY. It is handed a statement (its validated lines) and the
 * supplier's records as they stand, and returns a classification of every
 * difference. It writes nothing, posts nothing, allocates nothing and never
 * creates a balancing adjustment. The supplier ledger is authoritative:
 * the PRECISIA balance P is the ledger's balance at the statement date.
 *
 *   S  statement closing balance
 *   P  supplier ledger balance at the statement date (document dates)
 *   D  S − P
 *   Explained    differences with an identified cause (or a reviewer's
 *                recorded explanation)
 *   Unexplained  D − Explained — shown as it is, never forced to zero
 *
 * MATCHING, strongest first (SD-3A §6.1). Each PRECISIA record matches at
 * most one line; a tier with more than one candidate is AMBIGUOUS (a
 * potential duplicate), never a choice.
 *   T0 manual link        a reviewer's recorded link (with reason)
 *   T1 exact reference    reference text equal AND a compatible document type
 *   T2 normalised ref.    same key (case/punctuation only — leading zeros
 *                         kept), exactly one candidate, compatible type
 *   P1 payment evidence   exact amount + date within ±7 days + a shared
 *                         reference token
 *   S1/S2                 reference containment / amount + date: SUGGESTIONS
 *                         ONLY — never a match. Amount alone never matches.
 *
 * Every figure is in integer cents.
 */
import { normaliseInvoiceNumber } from "@/server/supplier-invoice-capture/validation";
import type { SignConvention, StatementTransactionType } from "./types";

export const ENGINE_VERSION = "sd3d-1";

const PAYMENT_WINDOW_DAYS = 7;
const SUGGESTION_WINDOW_DAYS = 3;
const TIMING_DAYS = 7;

export type LedgerRefType = "bill" | "credit-note" | "debit-note" | "supplier-payment" | "bank-transaction" | "opening-balance";

/** A record that is IN the supplier ledger (posted). `amount` is signed the
 * ledger's way: + increases what we owe the supplier. */
export type LedgerRecord = {
  refType: LedgerRefType;
  refId: number;
  date: string;
  /** Document number, or a payment's number/reference. */
  number: string;
  /** Free text that may carry a reference (payment reference, bank narrative). */
  evidence: string;
  amount: number;
};

/** A record PRECISIA knows about that is NOT in the ledger. */
export type UnpostedRecord = {
  refType: "unposted-bill" | "capture";
  refId: number;
  number: string | null;
  date: string | null;
  amount: number | null;
  documentType: "Bill" | "Credit Note" | "Debit Note" | null;
  /** captured-draft: went through Supplier Document Capture (a capture in
   * the workflow, or the draft a capture was converted to).
   * imported-not-posted: any other unposted bill (Import Centre, or a
   * Purchasing draft — Xero-migrated or entered by hand). */
  kind: "captured-draft" | "imported-not-posted";
  source: string;
};

export type ReconciliationLine = {
  id: number;
  lineOrder: number;
  pageNumber: number | null;
  date: string | null;
  reference: string | null;
  description: string | null;
  type: StatementTransactionType;
  debit: number | null;
  credit: number | null;
};

export type ResolutionInput = {
  id: number;
  action: "manual-link" | "explained" | "revoke";
  lineId: number | null;
  refType: LedgerRefType | "opening-difference" | null;
  refId: number | null;
  revokesId: number | null;
  reason: string;
};

export type EngineInput = {
  engineVersion: string;
  statement: {
    id: number;
    statementDate: string;
    periodFrom: string | null;
    openingBalance: number;
    closingBalance: number;
    signConvention: SignConvention;
  };
  lines: ReconciliationLine[];
  ledger: LedgerRecord[];
  unposted: UnpostedRecord[];
  resolutions: ResolutionInput[];
};

export type ItemCategory =
  | "Matched"
  | "Amount Difference"
  | "Missing in PRECISIA"
  | "Missing on Statement"
  | "Potential Duplicate"
  | "Credit Note"
  | "Payment"
  | "Unclassified"
  | "Opening Balance Difference";

export type RefLink = { refType: string; refId: number; amount: number | null; date: string | null; number: string | null; note?: string };

export type ReconciliationItem = {
  order: number;
  lineId: number | null;
  lineOrder: number | null;
  category: ItemCategory;
  subStatus: string;
  matchTier: "manual" | "exact" | "normalised" | "payment-evidence" | null;
  refType: string | null;
  refId: number | null;
  relatedRefs: RefLink[];
  suggestions: (RefLink & { reason: string })[];
  statementAmount: number | null;
  precisiaAmount: number | null;
  amountDifference: number | null;
  /** This item's signed contribution to D. */
  effect: number;
  explained: boolean;
  explainedByResolutionId: number | null;
  message: string;
};

export type EngineResult = {
  engineVersion: string;
  windowFrom: string;
  windowTo: string;
  statementOpening: number;
  statementClosing: number;
  balanceBeforeWindow: number;
  balanceAt: number;
  difference: number;
  explained: number;
  explainedByReviewer: number;
  unexplained: number;
  /** D minus the sum of every item's effect: 0 when every difference is
   * itemised. Anything else is part of Unexplained and is reported. */
  residual: number;
  items: ReconciliationItem[];
  summary: Record<string, { count: number; amount: number }>;
};

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

const cents = (v: number) => Math.round(v * 100);
const rands = (c: number) => Math.round(c) / 100;

function days(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

function owed(line: ReconciliationLine, convention: SignConvention): number {
  const debit = cents(line.debit ?? 0);
  const credit = cents(line.credit ?? 0);
  return convention === "debit-increases-owed" ? debit - credit : credit - debit;
}

/** Tokens that can evidence a payment reference: alphanumeric runs and digit
 * runs of four or more characters. */
function tokens(text: string): Set<string> {
  const out = new Set<string>();
  const upper = text.toUpperCase();
  for (const t of upper.match(/[A-Z0-9]{4,}/g) ?? []) out.add(t);
  for (const t of upper.match(/[0-9]{4,}/g) ?? []) out.add(t);
  return out;
}

function shareToken(a: string, b: string): boolean {
  const left = tokens(a);
  for (const t of tokens(b)) if (left.has(t)) return true;
  return false;
}

function digits(text: string | null): string {
  return (text ?? "").replace(/\D/g, "");
}

function link(r: LedgerRecord, note?: string): RefLink {
  return { refType: r.refType, refId: r.refId, amount: rands(cents(r.amount)), date: r.date, number: r.number || null, ...(note ? { note } : {}) };
}

type LineKind = "document" | "credit-note" | "payment" | "unclassified" | "unknown-credit";

function lineKind(line: ReconciliationLine, owedCents: number): LineKind {
  switch (line.type) {
    case "invoice":
    case "debit-note":
      return "document";
    case "credit-note":
      return "credit-note";
    case "payment":
      return "payment";
    case "unknown":
      // The type is not printed and was not decided by a reviewer. A charge
      // can only be a document; a credit could be a credit note OR a
      // payment, so both are tried — the sign never decides which.
      return owedCents >= 0 ? "document" : "unknown-credit";
    default:
      return "unclassified";
  }
}

function documentRefTypes(kind: "document" | "credit-note"): LedgerRefType[] {
  return kind === "credit-note" ? ["credit-note"] : ["bill", "debit-note"];
}

function vatHint(statementCents: number, precisiaCents: number): string | null {
  const diff = Math.abs(statementCents - precisiaCents);
  for (const base of [statementCents, precisiaCents]) {
    const vat = Math.round((Math.abs(base) * 15) / 115);
    if (diff !== 0 && Math.abs(diff - vat) <= 1) return "The difference equals the VAT (15/115) on one of the amounts.";
  }
  return null;
}

// ---------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------

export function reconcileStatement(input: EngineInput): EngineResult {
  const { statement } = input;
  const convention = statement.signConvention;
  const asAt = statement.statementDate;
  const lines = [...input.lines].sort((a, b) => a.lineOrder - b.lineOrder);

  const lineDates = lines.map((l) => l.date).filter((d): d is string => !!d).sort();
  const windowFrom = statement.periodFrom ?? lineDates[0] ?? asAt;

  // The supplier ledger as at the statement date (later records are not part
  // of P; they are only consulted for payment timing).
  const ledgerAtDate = input.ledger.filter((r) => r.date <= asAt);
  const inWindow = (r: LedgerRecord) => r.date >= windowFrom && r.date <= asAt;
  const balanceAt = ledgerAtDate.reduce((s, r) => s + cents(r.amount), 0);
  const balanceBeforeWindow = ledgerAtDate.filter((r) => r.date < windowFrom).reduce((s, r) => s + cents(r.amount), 0);
  const opening = cents(statement.openingBalance);
  const closing = cents(statement.closingBalance);
  const difference = closing - balanceAt;

  // Reviewer decisions in force.
  const revoked = new Set(input.resolutions.filter((r) => r.action === "revoke" && r.revokesId !== null).map((r) => r.revokesId!));
  const active = input.resolutions.filter((r) => r.action !== "revoke" && !revoked.has(r.id));

  const key = (r: { refType: string; refId: number }) => `${r.refType}:${r.refId}`;
  const consumed = new Set<string>();
  const items: ReconciliationItem[] = [];

  const push = (item: Omit<ReconciliationItem, "order" | "explainedByResolutionId">) =>
    items.push({ ...item, order: 0, explainedByResolutionId: null });

  // Effect of a line matched to a record: the record leaves D only if it is
  // inside the window (before it, it is already in the opening balance).
  const pairEffect = (lineCents: number, r: LedgerRecord) => lineCents - (inWindow(r) ? cents(r.amount) : 0);
  const timingNote = (r: LedgerRecord) =>
    inWindow(r) ? "" : " PRECISIA dates it before the statement period, so it is already in the opening balance.";

  // ---- T0 manual links ------------------------------------------------
  const manualByLine = new Map<number, { record: LedgerRecord | null; resolution: ResolutionInput }>();
  for (const r of active.filter((x) => x.action === "manual-link")) {
    if (r.lineId === null || r.refType === null || r.refType === "opening-difference" || r.refId === null) continue;
    const record = ledgerAtDate.find((x) => x.refType === r.refType && x.refId === r.refId && !consumed.has(key(x))) ?? null;
    if (record) consumed.add(key(record));
    manualByLine.set(r.lineId, { record, resolution: r });
  }

  // ---- statement lines -------------------------------------------------
  const seenLine = new Map<string, ReconciliationLine>();
  for (const line of lines) {
    const amount = owed(line, convention);
    const statementAmount = rands(amount);
    const kind = lineKind(line, amount);
    const ref = (line.reference ?? "").trim();

    // A line printed twice on the statement.
    const repeatKey = [line.date ?? "", ref, amount].join("|");
    const first = seenLine.get(repeatKey);
    if (first && ref) {
      push({
        lineId: line.id, lineOrder: line.lineOrder, category: "Potential Duplicate", subStatus: "statement-repeat", matchTier: null,
        refType: null, refId: null, relatedRefs: [], suggestions: [], statementAmount, precisiaAmount: null, amountDifference: null,
        effect: amount, explained: false,
        message: `Line ${line.lineOrder} repeats line ${first.lineOrder} on the statement (same date, reference and amount). Not matched; check whether the supplier charged it twice.`,
      });
      continue;
    }
    seenLine.set(repeatKey, line);

    // T0
    const manual = manualByLine.get(line.id);
    if (manual) {
      if (!manual.record) {
        push({
          lineId: line.id, lineOrder: line.lineOrder, category: "Unclassified", subStatus: "manual-link-unavailable", matchTier: null,
          refType: null, refId: null, relatedRefs: [], suggestions: [], statementAmount, precisiaAmount: null, amountDifference: null,
          effect: amount, explained: false,
          message: `A reviewer linked line ${line.lineOrder} to a record that is not in the supplier ledger at the statement date (or is already matched).`,
        });
        continue;
      }
      pushPair(line, amount, manual.record, "manual", kind);
      continue;
    }

    if (kind === "unclassified") {
      push({
        lineId: line.id, lineOrder: line.lineOrder, category: "Unclassified", subStatus: line.type, matchTier: null,
        refType: null, refId: null, relatedRefs: [], suggestions: suggestionsFor(line, amount, ["bill", "debit-note", "credit-note", "supplier-payment", "bank-transaction"]),
        statementAmount, precisiaAmount: null, amountDifference: null, effect: amount, explained: false,
        message: `Line ${line.lineOrder} is ${line.type === "other" ? "not an invoice, credit note or payment" : `${line.type}`}; it is not matched automatically.`,
      });
      continue;
    }

    // Document matching (T1, T2).
    if (kind === "document" || kind === "credit-note" || kind === "unknown-credit") {
      const docKind = kind === "unknown-credit" ? "credit-note" : kind;
      const result = matchDocument(line, ref, documentRefTypes(docKind));
      if (result.kind === "match") {
        pushPair(line, amount, result.record, result.tier, docKind);
        continue;
      }
      if (result.kind === "ambiguous") {
        for (const r of result.candidates) consumed.add(key(r));
        const candidateEffect = result.candidates.filter(inWindow).reduce((s, r) => s + cents(r.amount), 0);
        push({
          lineId: line.id, lineOrder: line.lineOrder, category: "Potential Duplicate", subStatus: "multiple-precisia", matchTier: null,
          refType: null, refId: null, relatedRefs: result.candidates.map((r) => link(r)), suggestions: [], statementAmount,
          precisiaAmount: null, amountDifference: null, effect: amount - candidateEffect, explained: false,
          message: `Line ${line.lineOrder} (${ref}) matches ${result.candidates.length} PRECISIA records ${result.tier === "exact" ? "exactly" : "by normalised reference"}. None is chosen automatically.`,
        });
        continue;
      }
      if (kind !== "unknown-credit") {
        pushMissing(line, amount, docKind);
        continue;
      }
    }

    // Payment matching (P1) — payment lines, and unknown credits with no
    // matching credit note.
    const pay = matchPayment(line, amount);
    if (pay.kind === "match") {
      pushPair(line, amount, pay.record, "payment-evidence", "payment");
      continue;
    }
    if (pay.kind === "double") {
      for (const r of pay.candidates) consumed.add(key(r));
      const candidateEffect = pay.candidates.filter(inWindow).reduce((s, r) => s + cents(r.amount), 0);
      push({
        lineId: line.id, lineOrder: line.lineOrder, category: "Potential Duplicate", subStatus: "double-recorded-payment", matchTier: null,
        refType: null, refId: null, relatedRefs: pay.candidates.map((r) => link(r)), suggestions: [], statementAmount, precisiaAmount: null,
        amountDifference: null, effect: amount - candidateEffect, explained: false,
        message: `The payment on line ${line.lineOrder} is in PRECISIA twice — as a supplier payment AND as a bank transaction. Flagged only: nothing is netted, allocated or changed.`,
      });
      continue;
    }
    if (pay.kind === "ambiguous") {
      for (const r of pay.candidates) consumed.add(key(r));
      const candidateEffect = pay.candidates.filter(inWindow).reduce((s, r) => s + cents(r.amount), 0);
      push({
        lineId: line.id, lineOrder: line.lineOrder, category: "Potential Duplicate", subStatus: "multiple-precisia", matchTier: null,
        refType: null, refId: null, relatedRefs: pay.candidates.map((r) => link(r)), suggestions: [], statementAmount, precisiaAmount: null,
        amountDifference: null, effect: amount - candidateEffect, explained: false,
        message: `The payment on line ${line.lineOrder} could be any of ${pay.candidates.length} PRECISIA payments. None is chosen automatically.`,
      });
      continue;
    }
    if (pay.kind === "timing") {
      push({
        lineId: line.id, lineOrder: line.lineOrder, category: "Payment", subStatus: "timing", matchTier: null,
        refType: pay.record.refType, refId: pay.record.refId, relatedRefs: [link(pay.record)], suggestions: [], statementAmount,
        precisiaAmount: rands(cents(pay.record.amount)), amountDifference: null, effect: amount, explained: true,
        message: `The payment on line ${line.lineOrder} is recorded in PRECISIA on ${pay.record.date}, after the statement date — a timing difference.`,
      });
      continue;
    }
    const suggestions = suggestionsFor(line, amount, ["supplier-payment", "bank-transaction"]);
    if (kind === "unknown-credit") {
      push({
        lineId: line.id, lineOrder: line.lineOrder, category: "Unclassified", subStatus: "unknown-credit", matchTier: null,
        refType: null, refId: null, relatedRefs: [], suggestions: [...suggestions, ...suggestionsFor(line, amount, ["credit-note"])],
        statementAmount, precisiaAmount: null, amountDifference: null, effect: amount, explained: false,
        message: `Line ${line.lineOrder} is a credit of unknown type (credit note or payment) with no match in PRECISIA. Set its type, or link it.`,
      });
    } else {
      push({
        lineId: line.id, lineOrder: line.lineOrder, category: "Payment", subStatus: suggestions.length > 0 ? "suggested" : "unmatched", matchTier: null,
        refType: null, refId: null, relatedRefs: [], suggestions, statementAmount, precisiaAmount: null, amountDifference: null,
        effect: amount, explained: true,
        message: suggestions.length > 0
          ? `The payment on line ${line.lineOrder} is not recorded in PRECISIA with matching reference evidence. ${suggestions.length} possible payment(s) by amount and date are SUGGESTED for review — not matched.`
          : `The payment on line ${line.lineOrder} is not recorded in PRECISIA.`,
      });
    }
  }

  // ---- PRECISIA records with no statement line ---------------------------
  const unmatched = ledgerAtDate.filter((r) => inWindow(r) && !consumed.has(key(r)));
  // A payment recorded twice (supplier payment AND bank transaction): flag.
  const payments = unmatched.filter((r) => r.refType === "supplier-payment");
  const bank = unmatched.filter((r) => r.refType === "bank-transaction");
  for (const p of payments) {
    const twin = bank.find((b) => !consumed.has(key(b)) && cents(b.amount) === cents(p.amount) && Math.abs(days(b.date, p.date)) <= SUGGESTION_WINDOW_DAYS);
    if (!twin) continue;
    consumed.add(key(p));
    consumed.add(key(twin));
    push({
      lineId: null, lineOrder: null, category: "Potential Duplicate", subStatus: "double-recorded-payment", matchTier: null,
      refType: null, refId: null, relatedRefs: [link(p), link(twin)], suggestions: [], statementAmount: null,
      precisiaAmount: rands(cents(p.amount) + cents(twin.amount)), amountDifference: null, effect: -(cents(p.amount) + cents(twin.amount)), explained: false,
      message: `A payment of ${rands(Math.abs(cents(p.amount)))} appears in PRECISIA both as a supplier payment and as a bank transaction, and on neither side of the statement. Flagged only: nothing is netted or changed.`,
    });
  }
  for (const r of unmatched) {
    if (consumed.has(key(r))) continue;
    const timing = days(asAt, r.date) <= TIMING_DAYS;
    let category: ItemCategory = "Missing on Statement";
    let subStatus: string;
    if (r.refType === "credit-note") {
      category = "Credit Note";
      subStatus = "missing-on-statement";
    } else if (r.refType === "supplier-payment" || r.refType === "bank-transaction") {
      subStatus = timing ? "payment-timing" : "payment";
    } else if (r.refType === "opening-balance") {
      subStatus = "opening-balance-entry";
    } else {
      subStatus = timing ? "timing" : "in-period";
    }
    push({
      lineId: null, lineOrder: null, category, subStatus, matchTier: null, refType: r.refType, refId: r.refId, relatedRefs: [link(r)],
      suggestions: [], statementAmount: null, precisiaAmount: rands(cents(r.amount)), amountDifference: null, effect: -cents(r.amount), explained: true,
      message: `${describeRecord(r)} is in PRECISIA but not on the statement${timing ? " (dated within a week of the statement date — possibly timing)" : ""}.`,
    });
  }

  // ---- opening balance -----------------------------------------------------
  const openingDifference = opening - balanceBeforeWindow;
  if (openingDifference !== 0) {
    items.unshift({
      order: 0, lineId: null, lineOrder: null, category: "Opening Balance Difference", subStatus: "opening", matchTier: null,
      refType: null, refId: null, relatedRefs: [], suggestions: [], statementAmount: rands(opening), precisiaAmount: rands(balanceBeforeWindow),
      amountDifference: rands(openingDifference), effect: openingDifference, explained: false, explainedByResolutionId: null,
      message: `The statement opens at ${rands(opening).toFixed(2)}; PRECISIA's balance before ${windowFrom} is ${rands(balanceBeforeWindow).toFixed(2)}.`,
    });
  }

  // ---- reviewer explanations ----------------------------------------------
  for (const r of active.filter((x) => x.action === "explained")) {
    for (const item of items) {
      const hit =
        (r.lineId !== null && item.lineId === r.lineId) ||
        (r.refType === "opening-difference" && item.category === "Opening Balance Difference") ||
        (r.refType !== null && r.refType !== "opening-difference" && r.refId !== null &&
          ((item.refType === r.refType && item.refId === r.refId) || item.relatedRefs.some((x) => x.refType === r.refType && x.refId === r.refId)));
      if (hit && item.explainedByResolutionId === null) {
        item.explained = true;
        item.explainedByResolutionId = r.id;
      }
    }
  }

  // ---- totals ---------------------------------------------------------------
  items.forEach((item, i) => (item.order = i + 1));
  const sumEffects = items.reduce((s, i) => s + i.effect, 0);
  const explained = items.filter((i) => i.explained).reduce((s, i) => s + i.effect, 0);
  const explainedByReviewer = items.filter((i) => i.explainedByResolutionId !== null).reduce((s, i) => s + i.effect, 0);
  const unexplained = difference - explained;
  const summary: EngineResult["summary"] = {};
  for (const item of items) {
    const s = (summary[item.category] ??= { count: 0, amount: 0 });
    s.count += 1;
    s.amount = rands(cents(s.amount) + item.effect);
  }

  return {
    engineVersion: input.engineVersion,
    windowFrom,
    windowTo: asAt,
    statementOpening: rands(opening),
    statementClosing: rands(closing),
    balanceBeforeWindow: rands(balanceBeforeWindow),
    balanceAt: rands(balanceAt),
    difference: rands(difference),
    explained: rands(explained),
    explainedByReviewer: rands(explainedByReviewer),
    unexplained: rands(unexplained),
    residual: rands(difference - sumEffects),
    items: items.map((i) => ({ ...i, effect: rands(i.effect) })),
    summary,
  };

  // -----------------------------------------------------------------------
  // (function declarations, hoisted)
  // -----------------------------------------------------------------------

  function describeRecord(r: LedgerRecord): string {
    const label: Record<LedgerRefType, string> = {
      bill: "Bill", "credit-note": "Credit note", "debit-note": "Debit note", "supplier-payment": "Supplier payment",
      "bank-transaction": "Bank payment", "opening-balance": "Opening balance entry",
    };
    return `${label[r.refType]} ${r.number || `#${r.refId}`} (${r.date}, ${rands(cents(r.amount)).toFixed(2)})`;
  }

  function matchDocument(
    line: ReconciliationLine,
    ref: string,
    types: LedgerRefType[],
  ): { kind: "match"; record: LedgerRecord; tier: "exact" | "normalised" } | { kind: "ambiguous"; candidates: LedgerRecord[]; tier: "exact" | "normalised" } | { kind: "none" } {
    if (!ref) return { kind: "none" };
    const pool = ledgerAtDate.filter((r) => types.includes(r.refType) && !consumed.has(key(r)));
    const exact = pool.filter((r) => r.number.trim() === ref);
    if (exact.length === 1) return { kind: "match", record: exact[0], tier: "exact" };
    if (exact.length > 1) return { kind: "ambiguous", candidates: exact, tier: "exact" };
    const norm = normaliseInvoiceNumber(ref);
    if (!norm) return { kind: "none" };
    const normalised = pool.filter((r) => normaliseInvoiceNumber(r.number) === norm);
    if (normalised.length === 1) return { kind: "match", record: normalised[0], tier: "normalised" };
    if (normalised.length > 1) return { kind: "ambiguous", candidates: normalised, tier: "normalised" };
    void line;
    return { kind: "none" };
  }

  function matchPayment(
    line: ReconciliationLine,
    amount: number,
  ):
    | { kind: "match"; record: LedgerRecord }
    | { kind: "double" | "ambiguous"; candidates: LedgerRecord[] }
    | { kind: "timing"; record: LedgerRecord }
    | { kind: "none" } {
    if (!line.date || amount === 0) return { kind: "none" };
    const text = `${line.reference ?? ""} ${line.description ?? ""}`;
    const qualifies = (r: LedgerRecord) =>
      (r.refType === "supplier-payment" || r.refType === "bank-transaction") &&
      !consumed.has(key(r)) &&
      cents(r.amount) === amount &&
      Math.abs(days(r.date, line.date!)) <= PAYMENT_WINDOW_DAYS &&
      shareToken(text, `${r.number} ${r.evidence}`);
    const candidates = ledgerAtDate.filter(qualifies);
    if (candidates.length === 1) return { kind: "match", record: candidates[0] };
    if (candidates.length === 2 && candidates.some((c) => c.refType === "supplier-payment") && candidates.some((c) => c.refType === "bank-transaction")) {
      return { kind: "double", candidates };
    }
    if (candidates.length > 1) return { kind: "ambiguous", candidates };
    const later = input.ledger.filter((r) => r.date > asAt && qualifies(r));
    if (later.length === 1) return { kind: "timing", record: later[0] };
    return { kind: "none" };
  }

  function suggestionsFor(line: ReconciliationLine, amount: number, types: LedgerRefType[]): (RefLink & { reason: string })[] {
    const out: (RefLink & { reason: string })[] = [];
    const pool = ledgerAtDate.filter((r) => types.includes(r.refType) && !consumed.has(key(r)));
    const lineDigits = digits(line.reference);
    for (const r of pool) {
      const recordDigits = digits(r.number);
      if (lineDigits.length >= 4 && recordDigits.length >= 4 && lineDigits !== recordDigits &&
          (lineDigits.endsWith(recordDigits) || recordDigits.endsWith(lineDigits) || lineDigits.includes(recordDigits) || recordDigits.includes(lineDigits))) {
        out.push({ ...link(r), reason: "Reference digits contained in one another (suggestion only)." });
        continue;
      }
      if (line.date && cents(r.amount) === amount && amount !== 0 && Math.abs(days(r.date, line.date)) <= SUGGESTION_WINDOW_DAYS) {
        out.push({ ...link(r), reason: "Same amount within three days, but no reference evidence (suggestion only)." });
      }
    }
    return out.slice(0, 5);
  }

  function pushPair(line: ReconciliationLine, amount: number, record: LedgerRecord, tier: "manual" | "exact" | "normalised" | "payment-evidence", kind: string) {
    consumed.add(key(record));
    const precisia = cents(record.amount);
    const equal = precisia === amount;
    const statementAmount = rands(amount);
    const base = {
      lineId: line.id, lineOrder: line.lineOrder, matchTier: tier, refType: record.refType, refId: record.refId,
      relatedRefs: [link(record)], suggestions: [], statementAmount, precisiaAmount: rands(precisia),
      amountDifference: equal ? 0 : rands(amount - precisia), effect: pairEffect(amount, record), explained: true,
    };
    const how = tier === "manual" ? "by a reviewer's link" : tier === "payment-evidence" ? "by amount, date and reference evidence" : tier === "exact" ? "by exact reference" : "by normalised reference";
    if (record.refType === "credit-note" || kind === "credit-note") {
      push({ ...base, category: "Credit Note", subStatus: equal ? "matched" : "amount-difference",
        message: `Credit note on line ${line.lineOrder} matched ${how}${equal ? "" : `, but the amounts differ by ${rands(Math.abs(amount - precisia)).toFixed(2)}`}.${timingNote(record)}` });
    } else if (record.refType === "supplier-payment" || record.refType === "bank-transaction") {
      push({ ...base, category: "Payment", subStatus: equal ? "matched" : "amount-difference",
        message: `Payment on line ${line.lineOrder} matched ${how}.${timingNote(record)}` });
    } else if (equal) {
      push({ ...base, category: "Matched", subStatus: tier, message: `Line ${line.lineOrder} matched ${describeRecord(record)} ${how}.${timingNote(record)}` });
    } else {
      const hint = vatHint(amount, precisia);
      push({ ...base, category: "Amount Difference", subStatus: hint ? "vat-hint" : "difference",
        message: `Line ${line.lineOrder} matched ${describeRecord(record)} ${how}, but the statement shows ${statementAmount.toFixed(2)}.${hint ? ` ${hint}` : ""}${timingNote(record)}` });
    }
  }

  function pushMissing(line: ReconciliationLine, amount: number, docKind: "document" | "credit-note") {
    const ref = (line.reference ?? "").trim();
    const norm = normaliseInvoiceNumber(ref);
    const wantCredit = docKind === "credit-note";
    const known = norm
      ? input.unposted.filter((u) => u.number && normaliseInvoiceNumber(u.number) === norm &&
          (u.documentType === null || (u.documentType === "Credit Note") === wantCredit))
      : [];
    const captured = known.filter((u) => u.kind === "captured-draft");
    const chosen = captured.length > 0 ? captured : known;
    const subStatus = chosen.length === 0 ? "not-captured" : captured.length > 0 ? "captured-draft" : "imported-not-posted";
    const relatedRefs: RefLink[] = chosen.map((u) => ({ refType: u.refType, refId: u.refId, amount: u.amount, date: u.date, number: u.number, note: u.source }));
    const what = wantCredit ? "credit note" : "document";
    const message =
      subStatus === "not-captured"
        ? `The ${what} on line ${line.lineOrder}${ref ? ` (${ref})` : ""} is not in PRECISIA at all.`
        : subStatus === "captured-draft"
          ? `The ${what} on line ${line.lineOrder} (${ref}) has been captured but is not posted (${chosen.map((u) => u.source).join("; ")}).`
          : `The ${what} on line ${line.lineOrder} (${ref}) is in PRECISIA but was never posted (${chosen.map((u) => u.source).join("; ")}).`;
    push({
      lineId: line.id, lineOrder: line.lineOrder, category: wantCredit ? "Credit Note" : "Missing in PRECISIA", subStatus, matchTier: null,
      refType: chosen.length === 1 ? chosen[0].refType : null, refId: chosen.length === 1 ? chosen[0].refId : null, relatedRefs,
      suggestions: suggestionsFor(line, amount, documentRefTypes(docKind)), statementAmount: rands(amount), precisiaAmount: null,
      amountDifference: null, effect: amount, explained: true, message,
    });
  }
}

/** Deterministic JSON (sorted keys) — the fingerprinted form of the input. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}
