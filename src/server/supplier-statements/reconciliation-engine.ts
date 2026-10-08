/**
 * SD-3G — the supplier-statement DOCUMENT reconciliation engine.
 *
 * The question it answers (owner, after production UAT): "Which supplier
 * documents appearing on this statement do we have in PRECISIA, and do the
 * amounts and references agree?" — NOT "can the supplier's balance be
 * reconciled including payments?".
 *
 * THE POPULATION is supplier invoices, debit notes and credit notes:
 *   statement side   every non-payment transaction line;
 *   PRECISIA side    the supplier's bills, debit notes and credit notes in the
 *                    statement window — posted AND unposted (an unposted bill
 *                    is "in PRECISIA" but always flagged "not posted").
 * PAYMENTS ARE OUT OF SCOPE. A payment line gets exactly one item, "Out of
 * Scope — payment": never matched, never a suggestion, never Missing,
 * Amount Difference, Potential Duplicate or Unclassified, and no effect on any
 * figure. It stays on the statement, unchanged. PRECISIA supplier payments,
 * bank transactions and opening balances are not read at all.
 *
 * FIGURES (integer cents internally):
 *   Documents on Statement   S  sum of the in-scope lines (credit notes negative)
 *   Documents in PRECISIA    P  sum of the in-window documents (credit notes negative)
 *   Document Difference      D  S − P
 *   Explained / Unexplained  D = Explained + Unexplained, to the cent; every
 *                            item carries its effect on D, and the residual
 *                            D − Σ effects is always reported (it is 0).
 *
 * MATCHING, strongest first. Each PRECISIA document matches at most one line;
 * more than one candidate is AMBIGUOUS (a potential duplicate), never a choice.
 * Amount alone never matches.
 *   T0 manual link     a reviewer's recorded link (with reason)
 *   T1 exact           reference text equal, compatible document type
 *   T2 normalised      equal ignoring case and punctuation (leading zeros KEPT)
 *   T3 zero-padded     both digits-only and equal once leading zeros are
 *                      removed — ONLY for references printed at the
 *                      statement's own consistent zero-padding width
 *                      (owner decision: e.g. statement 000000002251125 ↔
 *                      PRECISIA 02251125). Stored text is never changed.
 *   Suggestions        reference containment / amount + date: suggestions only.
 *
 * Pure and read-only: it writes, posts and allocates nothing.
 */
import { normaliseInvoiceNumber } from "@/server/supplier-invoice-capture/validation";
import type { SignConvention, StatementTransactionType } from "./types";

export const ENGINE_VERSION = "sd3g-1";
export const RECONCILIATION_BASIS = "supplier-statement-documents";

const SUGGESTION_WINDOW_DAYS = 3;
const TIMING_DAYS = 7;
/** Shortest reference treated as zero-padded (a padding scheme, not a short number). */
const MIN_PADDED_LENGTH = 6;

export type DocumentRefType = "bill" | "credit-note" | "debit-note";
export type DocumentKind = "invoice" | "debit-note" | "credit-note" | "unknown";

/** A supplier document PRECISIA holds. `amount` is signed the ledger's way:
 * + increases what we owe (bills, debit notes), − for credit notes. */
export type DocumentRecord = {
  refType: DocumentRefType;
  refId: number;
  date: string;
  number: string;
  amount: number;
  /** false: imported or drafted but never posted (no journal). Counted as
   * "in PRECISIA", always flagged. */
  posted: boolean;
  source: string;
};

/** A supplier document still in Supplier Documents capture (not yet a bill).
 * Not part of P; only used to say WHY a statement document is missing. */
export type CaptureRecord = {
  refType: "capture";
  refId: number;
  number: string | null;
  date: string | null;
  amount: number | null;
  documentType: "Bill" | "Credit Note" | "Debit Note" | null;
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
  refType: string | null;
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
    signConvention: SignConvention;
  };
  lines: ReconciliationLine[];
  documents: DocumentRecord[];
  captures: CaptureRecord[];
  resolutions: ResolutionInput[];
};

export type ItemCategory =
  | "Matched"
  | "Amount Difference"
  | "Missing in PRECISIA"
  | "Missing on Statement"
  | "Potential Duplicate"
  | "Unclassified"
  | "Out of Scope";

export type MatchTier = "manual" | "exact" | "normalised" | "zero-padded";

export type RefLink = {
  refType: string;
  refId: number;
  amount: number | null;
  date: string | null;
  number: string | null;
  posted?: boolean;
  note?: string;
};

export type ReconciliationItem = {
  order: number;
  lineId: number | null;
  lineOrder: number | null;
  category: ItemCategory;
  subStatus: string;
  /** What the document is (from the statement line, or the PRECISIA record). */
  documentKind: DocumentKind | null;
  matchTier: MatchTier | null;
  refType: string | null;
  refId: number | null;
  relatedRefs: RefLink[];
  suggestions: (RefLink & { reason: string })[];
  statementAmount: number | null;
  precisiaAmount: number | null;
  amountDifference: number | null;
  /** This item's signed contribution to the Document Difference. */
  effect: number;
  explained: boolean;
  explainedByResolutionId: number | null;
  message: string;
};

export type EngineResult = {
  engineVersion: string;
  basis: typeof RECONCILIATION_BASIS;
  windowFrom: string;
  windowTo: string;
  /** S — Documents on Statement. */
  documentsOnStatement: number;
  /** P — Documents in PRECISIA (posted and not posted) in the window. */
  documentsInPrecisia: number;
  /** The part of P that is not posted. */
  documentsNotPosted: { count: number; amount: number };
  /** D = S − P. */
  difference: number;
  explained: number;
  explainedByReviewer: number;
  unexplained: number;
  /** D minus the sum of every item's effect (0 when everything is itemised). */
  residual: number;
  outOfScopePayments: number;
  items: ReconciliationItem[];
  summary: Record<string, { count: number; amount: number }>;
  /** Counts per document kind and category (matched invoices, missing credit notes, …). */
  byKind: Record<string, Record<string, number>>;
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

function digits(text: string | null): string {
  return (text ?? "").replace(/\D/g, "");
}

function stripZeros(text: string): string {
  return text.replace(/^0+(?=\d)/, "");
}

function link(r: DocumentRecord, note?: string): RefLink {
  return { refType: r.refType, refId: r.refId, amount: rands(cents(r.amount)), date: r.date, number: r.number || null, posted: r.posted, ...(note ? { note } : {}) };
}

function recordKind(r: DocumentRecord): DocumentKind {
  return r.refType === "credit-note" ? "credit-note" : r.refType === "debit-note" ? "debit-note" : "invoice";
}

type LineKind = "payment" | "charge" | "credit-note" | "unknown-credit" | "unclassified";

function lineKind(line: ReconciliationLine, owedCents: number): LineKind {
  switch (line.type) {
    case "payment":
      return "payment";
    case "invoice":
    case "debit-note":
      return "charge";
    case "credit-note":
      return "credit-note";
    case "unknown":
      // The type is not printed and no reviewer has set it. A charge can only
      // be a document; a credit could be a credit note OR a payment — it is
      // tried as a credit note, and otherwise left for a reviewer to type.
      return owedCents >= 0 ? "charge" : "unknown-credit";
    default:
      return "unclassified";
  }
}

function documentKindOf(line: ReconciliationLine, kind: LineKind): DocumentKind | null {
  if (line.type === "invoice") return "invoice";
  if (line.type === "debit-note") return "debit-note";
  if (line.type === "credit-note") return "credit-note";
  if (kind === "charge" || kind === "unknown-credit") return "unknown";
  return null;
}

function refTypesFor(kind: "charge" | "credit-note"): DocumentRefType[] {
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

/** The statement's own zero-padding width: the length shared by most of its
 * digits-only references that start with 0 (at least two of them). Null when
 * the statement does not pad its references consistently. */
export function paddingWidth(references: (string | null)[]): number | null {
  const counts = new Map<number, number>();
  for (const raw of references) {
    const ref = (raw ?? "").trim();
    if (ref.length < MIN_PADDED_LENGTH || !/^0\d+$/.test(ref)) continue;
    counts.set(ref.length, (counts.get(ref.length) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  let tie = false;
  for (const [length, count] of counts) {
    if (count > bestCount) {
      best = length;
      bestCount = count;
      tie = false;
    } else if (count === bestCount) {
      tie = true;
    }
  }
  return best !== null && bestCount >= 2 && !tie ? best : null;
}

// ---------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------

export function reconcileStatement(input: EngineInput): EngineResult {
  const { statement } = input;
  const convention = statement.signConvention;
  const asAt = statement.statementDate;
  const lines = [...input.lines].sort((a, b) => a.lineOrder - b.lineOrder);
  const inScope = lines.filter((l) => l.type !== "payment");

  const lineDates = inScope.map((l) => l.date).filter((d): d is string => !!d).sort();
  const windowFrom = statement.periodFrom ?? lineDates[0] ?? asAt;
  const inWindow = (r: DocumentRecord) => r.date >= windowFrom && r.date <= asAt;
  const population = input.documents.filter(inWindow);

  const S = inScope.reduce((s, l) => s + owed(l, convention), 0);
  const P = population.reduce((s, r) => s + cents(r.amount), 0);
  const notPosted = population.filter((r) => !r.posted);
  const difference = S - P;
  const width = paddingWidth(inScope.map((l) => l.reference));

  // Reviewer decisions in force.
  const revoked = new Set(input.resolutions.filter((r) => r.action === "revoke" && r.revokesId !== null).map((r) => r.revokesId!));
  const active = input.resolutions.filter((r) => r.action !== "revoke" && !revoked.has(r.id));

  const key = (r: { refType: string; refId: number }) => `${r.refType}:${r.refId}`;
  const consumed = new Set<string>();
  const items: ReconciliationItem[] = [];
  const push = (item: Omit<ReconciliationItem, "order" | "explainedByResolutionId">) => items.push({ ...item, order: 0, explainedByResolutionId: null });

  // A matched document leaves D only if it is in the window (before it, it
  // was never counted in P).
  const pairEffect = (lineCents: number, r: DocumentRecord) => lineCents - (inWindow(r) ? cents(r.amount) : 0);
  const notPostedNote = (r: DocumentRecord) => (r.posted ? "" : " It is in PRECISIA but NOT POSTED.");
  const outsideNote = (r: DocumentRecord) => (inWindow(r) ? "" : ` PRECISIA dates it ${r.date}, outside the statement window.`);

  // ---- T0 manual links ------------------------------------------------
  const manualByLine = new Map<number, { record: DocumentRecord | null; resolution: ResolutionInput }>();
  for (const r of active.filter((x) => x.action === "manual-link")) {
    if (r.lineId === null || r.refId === null) continue;
    const record = input.documents.find((x) => x.refType === r.refType && x.refId === r.refId && !consumed.has(key(x))) ?? null;
    if (record) consumed.add(key(record));
    manualByLine.set(r.lineId, { record, resolution: r });
  }

  // ---- statement lines -------------------------------------------------
  const seenRepeat = new Map<string, ReconciliationLine>();
  const seenNumber = new Map<string, { line: ReconciliationLine; amount: number }>();
  for (const line of lines) {
    const amount = owed(line, convention);
    const statementAmount = rands(amount);
    const kind = lineKind(line, amount);
    const documentKind = documentKindOf(line, kind);
    const ref = (line.reference ?? "").trim();

    if (kind === "payment") {
      push({
        lineId: line.id, lineOrder: line.lineOrder, category: "Out of Scope", subStatus: "payment", documentKind: null, matchTier: null,
        refType: null, refId: null, relatedRefs: [], suggestions: [], statementAmount: null, precisiaAmount: null, amountDifference: null,
        effect: 0, explained: true,
        message: `Line ${line.lineOrder} is a payment. Payments are out of scope for supplier document reconciliation: it is kept on the statement and not reconciled.`,
      });
      continue;
    }

    // The same line printed twice on the statement.
    const repeatKey = [line.date ?? "", ref, amount].join("|");
    const first = seenRepeat.get(repeatKey);
    if (first && ref) {
      push({
        lineId: line.id, lineOrder: line.lineOrder, category: "Potential Duplicate", subStatus: "statement-repeat", documentKind, matchTier: null,
        refType: null, refId: null, relatedRefs: [], suggestions: [], statementAmount, precisiaAmount: null, amountDifference: null,
        effect: amount, explained: false,
        message: `Line ${line.lineOrder} repeats line ${first.lineOrder} on the statement (same date, reference and amount). Not matched; check whether the supplier charged it twice.`,
      });
      continue;
    }
    seenRepeat.set(repeatKey, line);

    // The same document number with a different amount.
    const numberKey = ref && kind !== "unclassified" ? `${kind === "charge" ? "charge" : "credit"}|${normaliseInvoiceNumber(ref)}` : "";
    const sameNumber = numberKey ? seenNumber.get(numberKey) : undefined;
    if (sameNumber && sameNumber.amount !== amount) {
      push({
        lineId: line.id, lineOrder: line.lineOrder, category: "Potential Duplicate", subStatus: "same-number-different-amount", documentKind, matchTier: null,
        refType: null, refId: null, relatedRefs: [], suggestions: [], statementAmount, precisiaAmount: null, amountDifference: null,
        effect: amount, explained: false,
        message: `Line ${line.lineOrder} uses document number ${ref}, already used on line ${sameNumber.line.lineOrder} with a different amount. Not matched; check the original.`,
      });
      continue;
    }
    if (numberKey && !sameNumber) seenNumber.set(numberKey, { line, amount });

    // T0
    const manual = manualByLine.get(line.id);
    if (manual) {
      if (!manual.record) {
        push({
          lineId: line.id, lineOrder: line.lineOrder, category: "Unclassified", subStatus: "manual-link-unavailable", documentKind, matchTier: null,
          refType: null, refId: null, relatedRefs: [], suggestions: [], statementAmount, precisiaAmount: null, amountDifference: null,
          effect: amount, explained: false,
          message: `A reviewer linked line ${line.lineOrder} to a supplier document that is not available (not this supplier's, or already matched).`,
        });
        continue;
      }
      pushPair(line, amount, manual.record, "manual", documentKind);
      continue;
    }

    if (kind === "unclassified") {
      push({
        lineId: line.id, lineOrder: line.lineOrder, category: "Unclassified", subStatus: line.type, documentKind: null, matchTier: null,
        refType: null, refId: null, relatedRefs: [], suggestions: suggestionsFor(line, amount, ["bill", "debit-note", "credit-note"]),
        statementAmount, precisiaAmount: null, amountDifference: null, effect: amount, explained: false,
        message: `Line ${line.lineOrder} is ${line.type === "other" ? "not an invoice, debit note or credit note" : `a ${line.type} line`}; it is not matched automatically. Set its type, or link it.`,
      });
      continue;
    }

    const matchKind = kind === "charge" ? "charge" : "credit-note";
    const result = matchDocument(ref, refTypesFor(matchKind));
    if (result.kind === "match") {
      pushPair(line, amount, result.record, result.tier, documentKind);
      continue;
    }
    if (result.kind === "ambiguous") {
      for (const r of result.candidates) consumed.add(key(r));
      const candidateEffect = result.candidates.filter(inWindow).reduce((s, r) => s + cents(r.amount), 0);
      push({
        lineId: line.id, lineOrder: line.lineOrder, category: "Potential Duplicate", subStatus: "multiple-precisia", documentKind, matchTier: result.tier,
        refType: null, refId: null, relatedRefs: result.candidates.map((r) => link(r)), suggestions: [], statementAmount,
        precisiaAmount: null, amountDifference: null, effect: amount - candidateEffect, explained: false,
        message: `Line ${line.lineOrder} (${ref}) matches ${result.candidates.length} PRECISIA documents (${result.tier} reference). None is chosen automatically.`,
      });
      continue;
    }
    if (kind === "unknown-credit") {
      push({
        lineId: line.id, lineOrder: line.lineOrder, category: "Unclassified", subStatus: "unknown-credit", documentKind, matchTier: null,
        refType: null, refId: null, relatedRefs: [], suggestions: suggestionsFor(line, amount, ["credit-note"]),
        statementAmount, precisiaAmount: null, amountDifference: null, effect: amount, explained: false,
        message: `Line ${line.lineOrder} is a credit of unknown type with no matching credit note in PRECISIA. If it is a payment, set its type to Payment (out of scope); if it is a credit note, link it.`,
      });
      continue;
    }
    pushMissing(line, amount, matchKind, documentKind);
  }

  // ---- PRECISIA documents with no statement line ------------------------
  const unmatched = population.filter((r) => !consumed.has(key(r)));
  const matchedRecords = input.documents.filter((r) => consumed.has(key(r)));
  for (const r of unmatched) {
    if (consumed.has(key(r))) continue;
    const norm = normaliseInvoiceNumber(r.number);
    // The same document number twice in PRECISIA (one matched, or both unmatched).
    const twins = norm
      ? [...matchedRecords, ...unmatched].filter((x) => x !== r && recordKind(x) === recordKind(r) && normaliseInvoiceNumber(x.number) === norm)
      : [];
    if (twins.length > 0) {
      const group = [r, ...twins.filter((x) => !consumed.has(key(x)) && inWindow(x))];
      for (const g of group) consumed.add(key(g));
      push({
        lineId: null, lineOrder: null, category: "Potential Duplicate", subStatus: "precisia-duplicate-number", documentKind: recordKind(r), matchTier: null,
        refType: r.refType, refId: r.refId, relatedRefs: [...group, ...twins.filter((x) => !group.includes(x))].map((x) => link(x)), suggestions: [],
        statementAmount: null, precisiaAmount: rands(group.reduce((s, g) => s + cents(g.amount), 0)), amountDifference: null,
        effect: -group.reduce((s, g) => s + cents(g.amount), 0), explained: false,
        message: `Document number ${r.number} appears ${twins.length + 1} times in PRECISIA for this supplier. Flagged only: nothing is changed.`,
      });
      continue;
    }
    consumed.add(key(r));
    const timing = days(asAt, r.date) <= TIMING_DAYS;
    push({
      lineId: null, lineOrder: null, category: "Missing on Statement", subStatus: timing ? "timing" : "in-period", documentKind: recordKind(r), matchTier: null,
      refType: r.refType, refId: r.refId, relatedRefs: [link(r)], suggestions: [], statementAmount: null, precisiaAmount: rands(cents(r.amount)),
      amountDifference: null, effect: -cents(r.amount), explained: true,
      message: `${describe(r)} is in PRECISIA but not on the statement${timing ? " (dated within a week of the statement date — possibly timing)" : ""}.${notPostedNote(r)}`,
    });
  }

  // ---- reviewer explanations ----------------------------------------------
  for (const r of active.filter((x) => x.action === "explained")) {
    for (const item of items) {
      if (item.category === "Out of Scope") continue;
      const hit =
        (r.lineId !== null && item.lineId === r.lineId) ||
        (r.refType !== null && r.refId !== null &&
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
  const summary: EngineResult["summary"] = {};
  const byKind: EngineResult["byKind"] = {};
  for (const item of items) {
    const s = (summary[item.category] ??= { count: 0, amount: 0 });
    s.count += 1;
    s.amount = rands(cents(s.amount) + item.effect);
    if (item.documentKind) {
      const k = (byKind[item.documentKind] ??= {});
      k[item.category] = (k[item.category] ?? 0) + 1;
    }
  }

  return {
    engineVersion: input.engineVersion,
    basis: RECONCILIATION_BASIS,
    windowFrom,
    windowTo: asAt,
    documentsOnStatement: rands(S),
    documentsInPrecisia: rands(P),
    documentsNotPosted: { count: notPosted.length, amount: rands(notPosted.reduce((s, r) => s + cents(r.amount), 0)) },
    difference: rands(difference),
    explained: rands(explained),
    explainedByReviewer: rands(explainedByReviewer),
    unexplained: rands(difference - explained),
    residual: rands(difference - sumEffects),
    outOfScopePayments: items.filter((i) => i.category === "Out of Scope").length,
    items: items.map((i) => ({ ...i, effect: rands(i.effect) })),
    summary,
    byKind,
  };

  // -----------------------------------------------------------------------
  // (function declarations, hoisted)
  // -----------------------------------------------------------------------

  function describe(r: DocumentRecord): string {
    const label = r.refType === "credit-note" ? "Credit note" : r.refType === "debit-note" ? "Debit note" : "Bill";
    return `${label} ${r.number || `#${r.refId}`} (${r.date}, ${rands(cents(r.amount)).toFixed(2)})`;
  }

  function matchDocument(
    ref: string,
    types: DocumentRefType[],
  ): { kind: "match"; record: DocumentRecord; tier: Exclude<MatchTier, "manual"> } | { kind: "ambiguous"; candidates: DocumentRecord[]; tier: Exclude<MatchTier, "manual"> } | { kind: "none" } {
    if (!ref) return { kind: "none" };
    const pool = input.documents.filter((r) => types.includes(r.refType) && r.date <= asAt && !consumed.has(key(r)));
    const decide = (found: DocumentRecord[], tier: Exclude<MatchTier, "manual">) =>
      found.length === 1 ? ({ kind: "match", record: found[0], tier } as const) : found.length > 1 ? ({ kind: "ambiguous", candidates: found, tier } as const) : null;

    const exact = decide(pool.filter((r) => r.number.trim() === ref), "exact");
    if (exact) return exact;
    const norm = normaliseInvoiceNumber(ref);
    if (!norm) return { kind: "none" };
    const normalised = decide(pool.filter((r) => normaliseInvoiceNumber(r.number) === norm), "normalised");
    if (normalised) return normalised;
    // T3 — only for references printed at the statement's padding width.
    if (width !== null && ref.length === width && /^0\d+$/.test(ref)) {
      const target = stripZeros(ref);
      const padded = decide(pool.filter((r) => {
        const n = normaliseInvoiceNumber(r.number);
        return /^\d+$/.test(n) && stripZeros(n) === target;
      }), "zero-padded");
      if (padded) return padded;
    }
    return { kind: "none" };
  }

  function suggestionsFor(line: ReconciliationLine, amount: number, types: DocumentRefType[]): (RefLink & { reason: string })[] {
    const out: (RefLink & { reason: string })[] = [];
    const pool = input.documents.filter((r) => types.includes(r.refType) && r.date <= asAt && !consumed.has(key(r)));
    const lineDigits = stripZeros(digits(line.reference));
    for (const r of pool) {
      const recordDigits = stripZeros(digits(r.number));
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

  function pushPair(line: ReconciliationLine, amount: number, record: DocumentRecord, tier: MatchTier, documentKind: DocumentKind | null) {
    consumed.add(key(record));
    const precisia = cents(record.amount);
    const equal = precisia === amount;
    const statementAmount = rands(amount);
    const how = tier === "manual" ? "by a reviewer's link" : tier === "exact" ? "by exact reference" : tier === "normalised" ? "by normalised reference" : "by zero-padded reference";
    const base = {
      lineId: line.id, lineOrder: line.lineOrder, documentKind: documentKind ?? recordKind(record), matchTier: tier, refType: record.refType, refId: record.refId,
      relatedRefs: [link(record)], suggestions: [], statementAmount, precisiaAmount: rands(precisia),
      amountDifference: equal ? 0 : rands(amount - precisia), effect: pairEffect(amount, record), explained: true,
    };
    if (equal) {
      push({ ...base, category: "Matched", subStatus: record.posted ? "posted" : "not-posted",
        message: `Line ${line.lineOrder} matched ${describe(record)} ${how}.${notPostedNote(record)}${outsideNote(record)}` });
      return;
    }
    const hint = vatHint(amount, precisia);
    push({ ...base, category: "Amount Difference", subStatus: hint ? "vat-hint" : "difference",
      message: `Line ${line.lineOrder} matched ${describe(record)} ${how}, but the statement shows ${statementAmount.toFixed(2)} (difference ${rands(amount - precisia).toFixed(2)}).${hint ? ` ${hint}` : ""}${notPostedNote(record)}${outsideNote(record)}` });
  }

  function pushMissing(line: ReconciliationLine, amount: number, matchKind: "charge" | "credit-note", documentKind: DocumentKind | null) {
    const ref = (line.reference ?? "").trim();
    const norm = normaliseInvoiceNumber(ref);
    const wantCredit = matchKind === "credit-note";
    const captured = norm
      ? input.captures.filter((c) => c.number && normaliseInvoiceNumber(c.number) === norm && (c.documentType === null || (c.documentType === "Credit Note") === wantCredit))
      : [];
    const what = wantCredit ? "credit note" : documentKind === "debit-note" ? "debit note" : documentKind === "invoice" ? "invoice" : "document";
    push({
      lineId: line.id, lineOrder: line.lineOrder, category: "Missing in PRECISIA", subStatus: captured.length > 0 ? "captured-not-converted" : "not-captured",
      documentKind, matchTier: null, refType: captured.length === 1 ? "capture" : null, refId: captured.length === 1 ? captured[0].refId : null,
      relatedRefs: captured.map((c) => ({ refType: c.refType, refId: c.refId, amount: c.amount, date: c.date, number: c.number, note: c.source })),
      suggestions: suggestionsFor(line, amount, refTypesFor(matchKind)), statementAmount: rands(amount), precisiaAmount: null,
      amountDifference: null, effect: amount, explained: true,
      message: captured.length > 0
        ? `The ${what} on line ${line.lineOrder} (${ref}) has been captured in Supplier Documents but is not yet a bill (${captured.map((c) => c.source).join("; ")}).`
        : `The ${what} on line ${line.lineOrder}${ref ? ` (${ref})` : ""} is not in PRECISIA.`,
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
