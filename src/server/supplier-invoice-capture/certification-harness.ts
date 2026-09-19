/**
 * Phase 5M — the field-level accuracy harness.
 *
 * Scores an extraction against independently verified ground truth. Written
 * as offline preparation: it is complete, unit-tested against synthetic
 * cases, and produces the exact report the certification decision needs —
 * so the moment a provider is authorised, certification is a run, not a
 * build.
 *
 * THREE RULES THE BRIEF IS EXPLICIT ABOUT, ENCODED HERE:
 *
 *  1. **A missing field is not a correct field.** `Missing` is its own
 *     outcome and counts against accuracy. Treating "didn't answer" as
 *     "didn't get it wrong" is the single easiest way to manufacture a
 *     pass.
 *  2. **A hallucination is worse than a miss**, and is counted separately:
 *     ground truth says the field is absent, the model supplied a value.
 *     That is the failure mode that quietly becomes a wrong bill.
 *  3. **Confidence never enters the score.** A high confidence score does
 *     not make an incorrect critical field acceptable — it is not an input
 *     to any function here.
 *
 * There is no overall pass threshold in this file, deliberately. The brief
 * forbids inventing "95% = good"; the harness reports, a human decides.
 */

import type { ExtractionResult } from "./types";

/** How much a field being wrong matters, per the brief's classification. */
export type FieldImportance = "critical" | "important" | "optional";

export type FieldOutcome =
  /** Byte-identical to ground truth. */
  | "exact"
  /** Differs only in a way that cannot change meaning — "4111 222 333" vs
   * "4111222333", "R1 000.00" vs 1000, trailing whitespace. */
  | "normalised"
  /** A value was produced and it is wrong. */
  | "incorrect"
  /** Ground truth has a value; the model produced none. */
  | "missing"
  /** Ground truth has NO value; the model produced one. */
  | "hallucinated"
  /** Ground truth has no value and neither did the model. Correct, and
   * counted separately so it cannot inflate the accuracy denominator. */
  | "correctly-absent";

export type FieldScore = {
  field: string;
  importance: FieldImportance;
  expected: string | number | null;
  actual: string | number | null;
  outcome: FieldOutcome;
  /** Which line, when the field belongs to one. */
  lineIndex?: number;
};

/** The accounting classification the brief specifies. */
export const FIELD_IMPORTANCE: Record<string, FieldImportance> = {
  // CRITICAL — supplier identity, the document's identity, and every
  // figure that becomes an accounting amount.
  supplierName: "critical",
  supplierVatNumber: "critical",
  invoiceNumber: "critical",
  invoiceDate: "critical",
  currencyCode: "critical",
  subtotal: "critical",
  vatAmount: "critical",
  total: "critical",
  "line.quantity": "critical",
  "line.unitPrice": "critical",
  "line.lineTotal": "critical",
  "line.vatAmount": "critical",
  "line.discount": "critical",
  // IMPORTANT
  dueDate: "important",
  orderReference: "important",
  discountTotal: "important",
  "line.uom": "important",
  "line.supplierSku": "important",
  // OPTIONAL
  supplierRegistrationNumber: "optional",
  "line.description": "optional",
  "line.packDescription": "optional",
};

/** Ground truth for one document, verified by a human against the page.
 * NEVER produced by the model under test — an answer key written by the
 * extractor certifies its own mistakes. */
export type GroundTruth = {
  key: string;
  supplierName: string | null;
  supplierVatNumber: string | null;
  supplierRegistrationNumber: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  orderReference: string | null;
  currencyCode: string | null;
  subtotal: number | null;
  discountTotal: number | null;
  vatAmount: number | null;
  total: number | null;
  lines: {
    description: string | null;
    supplierSku: string | null;
    quantity: number | null;
    uom: string | null;
    packDescription: string | null;
    unitPrice: number | null;
    discount: number | null;
    vatAmount: number | null;
    lineTotal: number | null;
  }[];
  /** How the truth was established, so a reader can judge it. */
  verifiedBy: string;
};

/** Money equality to the cent. Anything looser would let a wrong figure
 * score as right. */
const CENT = 0.005;

function normaliseText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Identifier comparison: characters only, so "4111 222 333",
 * "4111/222/333" and "4111222333" are the same number — a real
 * normalisation, not a loosened standard. */
function identifierKey(value: string | null): string | null {
  if (value === null) return null;
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "") || null;
}

function looseTextKey(value: string | null): string | null {
  if (value === null) return null;
  return value.toLowerCase().replace(/\s+/g, " ").trim() || null;
}

/** Scores one field. The order of the checks is the meaning of the score. */
export function scoreField(
  field: string,
  expected: string | number | null,
  actual: string | number | null,
  lineIndex?: number,
): FieldScore {
  const importance = FIELD_IMPORTANCE[field] ?? "optional";
  const base = { field, importance, expected, actual, ...(lineIndex === undefined ? {} : { lineIndex }) };

  const expectedAbsent = expected === null || expected === undefined || expected === "";
  const actualAbsent = actual === null || actual === undefined || actual === "";

  if (expectedAbsent && actualAbsent) return { ...base, outcome: "correctly-absent" };
  if (expectedAbsent && !actualAbsent) return { ...base, outcome: "hallucinated" };
  if (!expectedAbsent && actualAbsent) return { ...base, outcome: "missing" };

  if (typeof expected === "number" || typeof actual === "number") {
    const e = typeof expected === "number" ? expected : Number(expected);
    const a = typeof actual === "number" ? actual : Number(actual);
    if (!Number.isFinite(a)) return { ...base, outcome: "incorrect" };
    if (Math.abs(e - a) <= CENT) return { ...base, outcome: "exact" };
    return { ...base, outcome: "incorrect" };
  }

  const e = normaliseText(expected);
  const a = normaliseText(actual);
  if (e === a) return { ...base, outcome: "exact" };

  // Normalisation is accepted ONLY where it cannot change meaning.
  const isIdentifier = /vat|registration|invoiceNumber|Sku/i.test(field);
  if (isIdentifier && identifierKey(e) !== null && identifierKey(e) === identifierKey(a)) {
    return { ...base, outcome: "normalised" };
  }
  if (!isIdentifier && looseTextKey(e) !== null && looseTextKey(e) === looseTextKey(a)) {
    return { ...base, outcome: "normalised" };
  }
  return { ...base, outcome: "incorrect" };
}

export type DocumentScore = {
  key: string;
  fields: FieldScore[];
  /** True when the model returned a different number of lines than the
   * document has. Scored separately because a missing line makes every
   * field on it "missing", which would otherwise drown the signal. */
  lineCountMatches: boolean;
  expectedLineCount: number;
  actualLineCount: number;
};

/** Scores one extraction against its ground truth. */
export function scoreDocument(truth: GroundTruth, extraction: ExtractionResult): DocumentScore {
  const fields: FieldScore[] = [];
  const header = extraction.header;

  for (const field of [
    "supplierName", "supplierVatNumber", "supplierRegistrationNumber", "invoiceNumber", "invoiceDate",
    "dueDate", "orderReference", "currencyCode", "subtotal", "discountTotal", "vatAmount", "total",
  ] as const) {
    fields.push(scoreField(field, truth[field], header[field]));
  }

  const lineCount = Math.max(truth.lines.length, extraction.lines.length);
  for (let i = 0; i < lineCount; i += 1) {
    const expectedLine = truth.lines[i];
    const actualLine = extraction.lines[i];
    for (const field of ["description", "supplierSku", "quantity", "uom", "packDescription", "unitPrice", "discount", "vatAmount", "lineTotal"] as const) {
      fields.push(scoreField(`line.${field}`, expectedLine?.[field] ?? null, actualLine?.[field] ?? null, i));
    }
  }

  return {
    key: truth.key,
    fields,
    lineCountMatches: truth.lines.length === extraction.lines.length,
    expectedLineCount: truth.lines.length,
    actualLineCount: extraction.lines.length,
  };
}

export type AccuracyBreakdown = {
  exact: number;
  normalised: number;
  incorrect: number;
  missing: number;
  hallucinated: number;
  correctlyAbsent: number;
  /** Fields where ground truth HAD a value — the only fair denominator
   * for "did it read the document". `correctly-absent` is excluded so a
   * corpus of sparse documents cannot inflate the score. */
  answerable: number;
  /** (exact + normalised) / answerable. Null when nothing was answerable. */
  accuracy: number | null;
};

function emptyBreakdown(): AccuracyBreakdown {
  return { exact: 0, normalised: 0, incorrect: 0, missing: 0, hallucinated: 0, correctlyAbsent: 0, answerable: 0, accuracy: null };
}

export function summariseFields(scores: FieldScore[]): AccuracyBreakdown {
  const out = emptyBreakdown();
  for (const score of scores) {
    switch (score.outcome) {
      case "exact": out.exact += 1; out.answerable += 1; break;
      case "normalised": out.normalised += 1; out.answerable += 1; break;
      case "incorrect": out.incorrect += 1; out.answerable += 1; break;
      case "missing": out.missing += 1; out.answerable += 1; break;
      // A hallucination has no ground-truth value to be "accurate" about,
      // so it is not in the denominator — but it IS reported, prominently.
      case "hallucinated": out.hallucinated += 1; break;
      case "correctlyAbsent" as never: break;
      case "correctly-absent": out.correctlyAbsent += 1; break;
    }
  }
  out.accuracy = out.answerable === 0 ? null : (out.exact + out.normalised) / out.answerable;
  return out;
}

export type CertificationReport = {
  documents: number;
  overall: AccuracyBreakdown;
  byImportance: Record<FieldImportance, AccuracyBreakdown>;
  byField: Record<string, AccuracyBreakdown>;
  /** Every critical field that was incorrect, missing or hallucinated —
   * listed in full, because these are the ones that decide certification. */
  criticalFailures: FieldScore[];
  lineCountMismatches: { key: string; expected: number; actual: number }[];
};

export function buildCertificationReport(scores: DocumentScore[]): CertificationReport {
  const allFields = scores.flatMap((s) => s.fields);

  const byImportance: Record<FieldImportance, AccuracyBreakdown> = {
    critical: summariseFields(allFields.filter((f) => f.importance === "critical")),
    important: summariseFields(allFields.filter((f) => f.importance === "important")),
    optional: summariseFields(allFields.filter((f) => f.importance === "optional")),
  };

  const byField: Record<string, AccuracyBreakdown> = {};
  for (const field of new Set(allFields.map((f) => f.field))) {
    byField[field] = summariseFields(allFields.filter((f) => f.field === field));
  }

  return {
    documents: scores.length,
    overall: summariseFields(allFields),
    byImportance,
    byField,
    criticalFailures: allFields.filter(
      (f) => f.importance === "critical" && (f.outcome === "incorrect" || f.outcome === "missing" || f.outcome === "hallucinated"),
    ),
    lineCountMismatches: scores
      .filter((s) => !s.lineCountMatches)
      .map((s) => ({ key: s.key, expected: s.expectedLineCount, actual: s.actualLineCount })),
  };
}

/**
 * Renders the report as plain text for the certification record. No
 * verdict — the brief forbids an invented threshold, so this states the
 * numbers and stops.
 *
 * ⚠ This output NECESSARILY contains document values: you cannot diagnose
 * a wrong field without seeing what was expected and what came back. That
 * is the one place in this feature where invoice content is rendered, and
 * it is why the corpus must be synthetic or explicitly authorised. Do not
 * run this harness over customer invoices and then paste its output
 * somewhere the corpus would not be allowed to go.
 */
export function formatCertificationReport(report: CertificationReport): string {
  const pct = (value: number | null) => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);
  const row = (label: string, b: AccuracyBreakdown) =>
    `  ${label.padEnd(28)} ${pct(b.accuracy).padStart(7)}  exact ${b.exact}  norm ${b.normalised}  wrong ${b.incorrect}  missing ${b.missing}  hallucinated ${b.hallucinated}`;

  const lines = [
    `Documents scored: ${report.documents}`,
    "",
    "By importance:",
    row("CRITICAL", report.byImportance.critical),
    row("IMPORTANT", report.byImportance.important),
    row("OPTIONAL", report.byImportance.optional),
    "",
    row("OVERALL", report.overall),
    "",
    `Critical-field failures: ${report.criticalFailures.length}`,
  ];
  for (const failure of report.criticalFailures.slice(0, 50)) {
    lines.push(
      `  ${failure.outcome.padEnd(13)} ${failure.field}${failure.lineIndex === undefined ? "" : ` [line ${failure.lineIndex + 1}]`} — expected ${JSON.stringify(failure.expected)}, got ${JSON.stringify(failure.actual)}`,
    );
  }
  if (report.lineCountMismatches.length) {
    lines.push("", "Line-count mismatches:");
    for (const m of report.lineCountMismatches) lines.push(`  ${m.key}: expected ${m.expected}, got ${m.actual}`);
  }
  return lines.join("\n");
}
