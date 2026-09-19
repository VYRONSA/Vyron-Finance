/**
 * Phase 5Q.7 — field-by-field scoring of a certification run.
 *
 * Answers the question run #47 could not: for every one of the 24 corpus
 * cases, exactly what did the AI extract, and how did it compare with the
 * independently countersigned answer key?
 *
 * DETERMINISTIC, AND TESTABLE WITHOUT A PROVIDER. It scores persisted
 * evidence against frozen answer keys. Nothing here calls a model, and
 * the same inputs always produce the same report.
 *
 * WHAT IT SCORES. Only fields the corpus actually records. The answer keys
 * describe a document; inventing a field they do not cover would be
 * scoring against nothing.
 *
 * THE FIGURES USED ARE THE PRINTED ONES. On `arithmetic-mismatch` the page
 * prints VAT of 165.00 where 15% of 1 000.00 is 150.00. The correct
 * EXTRACTION is 165.00, because that is what the document says. Scoring
 * against the arithmetic instead would mark a correct reading wrong and
 * reward a model that silently corrects its supplier — the exact behaviour
 * the case exists to catch.
 *
 * A VALIDATION DISAGREEMENT IS NOT AN EXTRACTION ERROR. The two are
 * reported separately and classified separately, because conflating them
 * turns a policy decision into an accusation against the model.
 */

import { loadGroundTruth, type CertificationGroundTruth, type GroundTruthLine } from "./certification-corpus";
import { resolveExpectations, type ResolvedExpectation } from "./certification-expectations";
import type { StoredEvidence } from "./certification-evidence";
import type { ExtractionResult } from "./types";

/** Money to the cent. Anything looser lets a wrong figure score as right. */
const CENT = 0.005;

export type FieldOutcome = "exact" | "normalised" | "incorrect" | "missing" | "hallucinated" | "correctly-absent";

export type FieldScore = {
  field: string;
  expected: string | number | null;
  actual: string | number | null;
  outcome: FieldOutcome;
  lineIndex?: number;
};

export type ValidationComparison = {
  expected: string[];
  actual: string[];
  matches: boolean;
  /** In the expectation but not produced. */
  missing: string[];
  /** Produced but not expected. */
  unexpected: string[];
  overridden: boolean;
  classification?: string;
};

export type CaseScore = {
  caseId: string;
  /** Did the provider answer at all. */
  extracted: boolean;
  providerError?: { category: string; httpStatus: number | null };
  fields: FieldScore[];
  fieldMismatches: FieldScore[];
  expectedLineCount: number;
  actualLineCount: number | null;
  lineCountMatches: boolean;
  validation: ValidationComparison;
  /** The headline for this case. */
  verdict: "PASS" | "FIELD MISMATCH" | "VALIDATION MISMATCH" | "INCOMPLETE";
};

export type RunScore = {
  runId: number;
  corpusSha256: string;
  casesScored: number;
  casesPerfect: number;
  fieldsCompared: number;
  fieldsExact: number;
  fieldsNormalised: number;
  fieldsIncorrect: number;
  fieldsMissing: number;
  fieldsHallucinated: number;
  fieldsCorrectlyAbsent: number;
  lineCountMismatches: string[];
  validationMismatches: string[];
  cases: CaseScore[];
};

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Differences that cannot change meaning: spacing, case, separators. */
function normaliseText(value: string): string {
  return value.toLowerCase().replace(/[\s\-_/.,]/g, "").trim();
}

/**
 * Scores one field.
 *
 * The five outcomes are kept distinct on purpose. A MISSING field is not a
 * correct one — treating "didn't answer" as "didn't get it wrong" is the
 * easiest way to manufacture a pass. A HALLUCINATED field (truth absent,
 * model supplied a value) is counted separately, because that is the
 * failure that quietly becomes a wrong bill.
 */
export function scoreField(field: string, expected: unknown, actual: unknown, lineIndex?: number): FieldScore {
  const base = { field, expected: (expected ?? null) as string | number | null, actual: (actual ?? null) as string | number | null, ...(lineIndex === undefined ? {} : { lineIndex }) };
  const expectedAbsent = expected === null || expected === undefined || expected === "";
  const actualAbsent = actual === null || actual === undefined || actual === "";

  if (expectedAbsent && actualAbsent) return { ...base, outcome: "correctly-absent" };
  if (expectedAbsent && !actualAbsent) return { ...base, outcome: "hallucinated" };
  if (!expectedAbsent && actualAbsent) return { ...base, outcome: "missing" };

  if (isNum(expected)) {
    if (!isNum(actual)) return { ...base, outcome: "incorrect" };
    return { ...base, outcome: Math.abs(expected - actual) < CENT ? "exact" : "incorrect" };
  }

  const e = String(expected);
  const a = String(actual);
  if (e === a) return { ...base, outcome: "exact" };
  return { ...base, outcome: normaliseText(e) === normaliseText(a) ? "normalised" : "incorrect" };
}

/** Header fields the corpus records, and where each lives. */
function headerFields(truth: CertificationGroundTruth, header: Record<string, unknown>): FieldScore[] {
  return [
    scoreField("documentType", truth.documentType, header.documentType),
    scoreField("supplierName", truth.supplier.name, header.supplierName),
    scoreField("supplierVatNumber", truth.supplier.vatNumber, header.supplierVatNumber),
    scoreField("supplierRegistrationNumber", truth.supplier.registrationNumber, header.supplierRegistrationNumber),
    scoreField("invoiceNumber", truth.invoiceNumber, header.invoiceNumber),
    scoreField("invoiceDate", truth.invoiceDate, header.invoiceDate),
    scoreField("dueDate", truth.dueDate, header.dueDate),
    scoreField("orderReference", truth.orderReference, header.orderReference),
    scoreField("currencyCode", truth.currency, header.currencyCode),
    scoreField("subtotal", truth.printedTotals.subtotal ?? null, header.subtotal),
    scoreField("discountTotal", truth.printedTotals.discountTotal ?? null, header.discountTotal),
    // The PRINTED VAT, always — see the file header on arithmetic-mismatch.
    scoreField("vatAmount", truth.printedTotals.vatAmount ?? null, header.vatAmount),
    scoreField("total", truth.printedTotals.total, header.total),
  ];
}

function lineFields(expected: GroundTruthLine, actual: Record<string, unknown>, index: number): FieldScore[] {
  return [
    scoreField("line.description", expected.description, actual.description, index),
    scoreField("line.supplierSku", expected.supplierSku, actual.supplierSku, index),
    scoreField("line.quantity", expected.quantity, actual.quantity, index),
    scoreField("line.uom", expected.uom, actual.uom, index),
    scoreField("line.unitPrice", expected.unitPrice, actual.unitPrice, index),
    // A zero discount means "none printed", not a printed 0.00.
    scoreField("line.discount", expected.discount === 0 ? null : expected.discount, actual.discount, index),
    scoreField("line.vatRatePercent", expected.vatRatePercent, actual.vatRatePercent, index),
    scoreField("line.vatAmount", expected.printedVatAmount ?? expected.vatAmount, actual.vatAmount, index),
    scoreField("line.lineTotal", expected.lineTotal, actual.lineTotal, index),
  ];
}

/** Scores one case's persisted evidence against its answer key. */
export function scoreCase(evidence: StoredEvidence, expectation: ResolvedExpectation, root?: string): CaseScore {
  const truth = loadGroundTruth(evidence.corpus_case_id, root);

  const actualFindings = Array.isArray(evidence.validation_findings)
    ? (evidence.validation_findings as { code: string }[]).map((f) => f.code)
    : [];
  const expectedFindings = expectation.validationFindings;
  const missingFindings = expectedFindings.filter((c) => !actualFindings.includes(c));
  const unexpectedFindings = actualFindings.filter((c) => !expectedFindings.includes(c));

  const validation: ValidationComparison = {
    expected: expectedFindings,
    actual: actualFindings,
    matches: missingFindings.length === 0 && unexpectedFindings.length === 0,
    missing: missingFindings,
    unexpected: unexpectedFindings,
    overridden: expectation.overridden,
    classification: expectation.classification,
  };

  if (evidence.outcome !== "extracted" || !evidence.extracted) {
    return {
      caseId: evidence.corpus_case_id,
      extracted: false,
      providerError: { category: evidence.error_category ?? "unknown", httpStatus: evidence.http_status },
      fields: [],
      fieldMismatches: [],
      expectedLineCount: truth.lines.length,
      actualLineCount: null,
      lineCountMatches: false,
      validation,
      verdict: "INCOMPLETE",
    };
  }

  const result = evidence.extracted as ExtractionResult;
  const header = result.header as unknown as Record<string, unknown>;
  const actualLines = (result.lines ?? []) as unknown as Record<string, unknown>[];

  const fields = headerFields(truth, header);
  // Compare as many lines as either side has, so a missing or invented
  // line shows up as missing/hallucinated fields rather than vanishing.
  const lineCount = Math.max(truth.lines.length, actualLines.length);
  for (let i = 0; i < lineCount; i += 1) {
    const expectedLine = truth.lines[i];
    const actualLine = actualLines[i];
    if (expectedLine && actualLine) fields.push(...lineFields(expectedLine, actualLine, i));
    else if (expectedLine) fields.push(...lineFields(expectedLine, {}, i));
    else if (actualLine) {
      const blank: GroundTruthLine = {
        description: "", supplierSku: null, quantity: null as unknown as number, uom: null,
        unitPrice: null as unknown as number, discount: 0, vatRatePercent: null, vatAmount: null,
        lineTotal: null as unknown as number,
      };
      fields.push(...lineFields(blank, actualLine, i));
    }
  }

  const fieldMismatches = fields.filter((f) => f.outcome === "incorrect" || f.outcome === "missing" || f.outcome === "hallucinated");
  const lineCountMatches = truth.lines.length === actualLines.length;

  const verdict: CaseScore["verdict"] =
    fieldMismatches.length > 0 || !lineCountMatches ? "FIELD MISMATCH" : validation.matches ? "PASS" : "VALIDATION MISMATCH";

  return {
    caseId: evidence.corpus_case_id,
    extracted: true,
    fields,
    fieldMismatches,
    expectedLineCount: truth.lines.length,
    actualLineCount: actualLines.length,
    lineCountMatches,
    validation,
    verdict,
  };
}

/** Scores a whole run. */
export function scoreRun(runId: number, evidence: StoredEvidence[], root?: string): RunScore {
  const expectations = resolveExpectations(root);
  const cases = evidence.map((e) => {
    const expectation = expectations.find((x) => x.caseId === e.corpus_case_id);
    if (!expectation) throw new Error(`Evidence names case "${e.corpus_case_id}", which is not in the corpus.`);
    return scoreCase(e, expectation, root);
  });

  const allFields = cases.flatMap((c) => c.fields);
  const count = (outcome: FieldOutcome) => allFields.filter((f) => f.outcome === outcome).length;

  return {
    runId,
    corpusSha256: evidence[0]?.corpus_sha256 ?? "",
    casesScored: cases.length,
    casesPerfect: cases.filter((c) => c.verdict === "PASS").length,
    fieldsCompared: allFields.length,
    fieldsExact: count("exact"),
    fieldsNormalised: count("normalised"),
    fieldsIncorrect: count("incorrect"),
    fieldsMissing: count("missing"),
    fieldsHallucinated: count("hallucinated"),
    fieldsCorrectlyAbsent: count("correctly-absent"),
    lineCountMismatches: cases.filter((c) => !c.lineCountMatches).map((c) => c.caseId),
    validationMismatches: cases.filter((c) => !c.validation.matches).map((c) => c.caseId),
    cases,
  };
}

/**
 * Renders the report.
 *
 * Numbers and named discrepancies. There is deliberately no overall score
 * and no pass threshold — the brief forbids inventing "95% = good", and a
 * single wrong critical field matters more than a percentage does.
 */
export function formatRunScore(score: RunScore): string {
  const lines: string[] = [];
  lines.push(`CERTIFICATION SCORING — run #${score.runId}`);
  lines.push(`corpus ${score.corpusSha256}`);
  lines.push("");
  lines.push(`Cases scored          : ${score.casesScored}`);
  lines.push(`Cases fully matching  : ${score.casesPerfect}`);
  lines.push("");
  lines.push(`Fields compared       : ${score.fieldsCompared}`);
  lines.push(`  exact               : ${score.fieldsExact}`);
  lines.push(`  normalised          : ${score.fieldsNormalised}`);
  lines.push(`  INCORRECT           : ${score.fieldsIncorrect}`);
  lines.push(`  MISSING             : ${score.fieldsMissing}`);
  lines.push(`  HALLUCINATED        : ${score.fieldsHallucinated}`);
  lines.push(`  correctly absent    : ${score.fieldsCorrectlyAbsent}`);
  lines.push("");

  for (const c of score.cases) {
    lines.push(`${c.caseId.padEnd(26)} ${c.verdict.padEnd(20)} lines ${c.actualLineCount ?? "-"}/${c.expectedLineCount}`);
    for (const m of c.fieldMismatches) {
      const where = m.lineIndex === undefined ? "" : ` (line ${m.lineIndex + 1})`;
      lines.push(`    ${m.outcome.toUpperCase().padEnd(18)} ${m.field}${where}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.actual)}`);
    }
    if (!c.validation.matches) {
      lines.push(`    VALIDATION         expected [${c.validation.expected.join(", ") || "none"}], got [${c.validation.actual.join(", ") || "none"}]`);
      if (c.validation.overridden) lines.push(`                       (expectation overridden in v2: ${c.validation.classification})`);
    }
  }

  return lines.join("\n");
}
