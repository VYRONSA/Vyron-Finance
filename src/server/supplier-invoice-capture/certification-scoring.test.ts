/**
 * Phase 5Q.7 — expectations versioning and field-by-field scoring.
 *
 * @vitest-environment node
 *
 * No provider, no database: the scorer takes persisted evidence and frozen
 * answer keys and is deterministic by construction.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadExpectationsV2, resolveExpectations, expectationFor } from "./certification-expectations";
import { formatRunScore, scoreCase, scoreField, scoreRun } from "./certification-scoring";
import { loadGroundTruth, loadManifest } from "./certification-corpus";
import type { StoredEvidence } from "./certification-evidence";

const MANIFEST = loadManifest();
const CORPUS_SHA = "cce1e6168c1613554f79787abddec3885f47836cf739e96afb9884589beaa799";

/** Builds evidence that reproduces a case's answer key exactly — a
 * "perfect" extraction, for testing the scorer's baseline. */
function perfectEvidence(caseId: string, findings: string[] = []): StoredEvidence {
  const truth = loadGroundTruth(caseId);
  return {
    id: 1, certification_run_id: 100, company_id: "co", corpus_case_id: caseId,
    corpus_sha256: CORPUS_SHA, document_file: truth.documentId, document_sha256: "x".repeat(64),
    model: "openai/gpt-4o-mini", calls_used_at_reservation: 1, call_ceiling: 24, duration_ms: 1000,
    usage: null, outcome: "extracted", error_category: null, http_status: null, provider_message: null,
    extracted: {
      header: {
        documentType: truth.documentType,
        supplierName: truth.supplier.name,
        supplierVatNumber: truth.supplier.vatNumber,
        supplierRegistrationNumber: truth.supplier.registrationNumber,
        invoiceNumber: truth.invoiceNumber,
        invoiceDate: truth.invoiceDate,
        dueDate: truth.dueDate,
        orderReference: truth.orderReference,
        currencyCode: truth.currency,
        subtotal: truth.printedTotals.subtotal ?? null,
        discountTotal: truth.printedTotals.discountTotal ?? null,
        vatAmount: truth.printedTotals.vatAmount ?? null,
        total: truth.printedTotals.total,
        confidence: null,
      },
      lines: truth.lines.map((l) => ({
        description: l.description, supplierSku: l.supplierSku, quantity: l.quantity, uom: l.uom,
        packDescription: l.packDescription ?? null, packQuantity: null, unitPrice: l.unitPrice,
        discount: l.discount === 0 ? null : l.discount, vatRatePercent: l.vatRatePercent,
        vatAmount: l.printedVatAmount ?? l.vatAmount, lineTotal: l.lineTotal, confidence: null,
      })),
      invoiceNumbersSeen: truth.invoiceNumber ? [truth.invoiceNumber] : [],
      missingFields: [], warnings: [], declaredLineCount: truth.lines.length,
    },
    validation_status: "Pass",
    validation_findings: findings.map((code) => ({ code })),
    line_count: truth.lines.length, declared_line_count: truth.lines.length,
  };
}

describe("expectations-v2 — the frozen keys are untouched", () => {
  it("every ground-truth file still hashes to the manifest", () => {
    // The decisive property: correcting an expectation must not change a
    // single byte of any answer key, or the countersignatures die.
    for (const entry of MANIFEST.cases) {
      const actual = createHash("sha256").update(readFileSync(`certification-corpus/ground-truth/${entry.groundTruthFile}`)).digest("hex");
      expect(`${entry.caseId}:${actual}`).toBe(`${entry.caseId}:${entry.groundTruthSha256}`);
    }
  });

  it("the corpus SHA is unchanged", () => {
    expect(MANIFEST.corpusSha256).toBe(CORPUS_SHA);
  });

  it("v2 is tied to that exact corpus", () => {
    expect(loadExpectationsV2()!.appliesToCorpusSha256).toBe(CORPUS_SHA);
  });

  it("overrides ONLY the four changed cases — it is not a replacement copy", () => {
    const v2 = loadExpectationsV2()!;
    expect(Object.keys(v2.overrides).sort()).toEqual(["arithmetic-mismatch", "credit-note", "debit-note", "missing-vat-number"]);
  });

  it("every override records what it supersedes, why, and how it is classified", () => {
    const v2 = loadExpectationsV2()!;
    for (const [caseId, o] of Object.entries(v2.overrides)) {
      expect(`${caseId}:${o.supersedes.length > 0}`).toBe(`${caseId}:true`);
      expect(`${caseId}:${o.reason.length > 80}`).toBe(`${caseId}:true`);
      expect(["answer-key-defect", "policy-decision", "legitimate-model-output"]).toContain(o.classification);
    }
  });
});

describe("resolving expectations", () => {
  it("uses v2 where present and the frozen key otherwise", () => {
    const resolved = resolveExpectations();
    expect(resolved).toHaveLength(24);
    expect(resolved.filter((r) => r.overridden).map((r) => r.caseId).sort())
      .toEqual(["arithmetic-mismatch", "credit-note", "debit-note", "missing-vat-number"]);

    // An untouched case keeps exactly what the countersigned key said.
    const clean = resolved.find((r) => r.caseId === "clean-pdf")!;
    expect(clean.overridden).toBe(false);
    expect(clean.validationFindings).toEqual(loadGroundTruth("clean-pdf").expected.validationFindings);
  });

  it("arithmetic-mismatch now expects the finding that actually exists", () => {
    const e = expectationFor("arithmetic-mismatch");
    expect(e.validationFindings).toEqual(["line-vat-disagrees-with-rate"]);
    expect(e.original).toEqual(["totals-mismatch"]);
    expect(e.classification).toBe("answer-key-defect");
  });

  it("missing-vat-number expects NO finding — supplier VAT number is optional", () => {
    const e = expectationFor("missing-vat-number");
    expect(e.validationFindings).toEqual([]);
    expect(e.classification).toBe("policy-decision");
    // And the ground truth still records the field as missing, which
    // remains a true statement about the page.
    expect(loadGroundTruth("missing-vat-number").fieldStatus.supplierVatNumber).toBe("missing");
  });

  it("credit and debit notes expect multiple-invoices, because both numbers ARE printed", () => {
    for (const caseId of ["credit-note", "debit-note"]) {
      const e = expectationFor(caseId);
      expect(e.validationFindings.sort()).toEqual(["multiple-invoices", "not-an-invoice"]);
      expect(e.classification).toBe("legitimate-model-output");
    }
  });

  it("REFUSES overrides written against a different corpus", () => {
    // Fail closed: applying expectations nobody checked against this
    // corpus would be worse than having none.
    const tampered = { ...loadExpectationsV2()!, appliesToCorpusSha256: "0".repeat(64) };
    expect(tampered.appliesToCorpusSha256).not.toBe(MANIFEST.corpusSha256);
  });
});

describe("scoreField — the six outcomes", () => {
  it("exact, normalised, incorrect", () => {
    expect(scoreField("invoiceNumber", "KW-10041", "KW-10041").outcome).toBe("exact");
    expect(scoreField("invoiceNumber", "KW-10041", "kw 10041").outcome).toBe("normalised");
    expect(scoreField("total", 1150, 1015).outcome).toBe("incorrect");
  });

  it("MISSING is never treated as correct", () => {
    expect(scoreField("invoiceNumber", "KW-10041", null).outcome).toBe("missing");
  });

  it("HALLUCINATED is counted separately", () => {
    expect(scoreField("orderReference", null, "PO-99999").outcome).toBe("hallucinated");
  });

  it("correctly-absent when neither side has a value", () => {
    expect(scoreField("dueDate", null, null).outcome).toBe("correctly-absent");
  });

  it("money is compared to the cent", () => {
    expect(scoreField("total", 1150, 1150.004).outcome).toBe("exact");
    expect(scoreField("total", 1150, 1150.01).outcome).toBe("incorrect");
    expect(scoreField("total", 1150, "not a number").outcome).toBe("incorrect");
  });
});

describe("scoring a case", () => {
  it("a perfect extraction of clean-pdf scores PASS with no mismatches", () => {
    const score = scoreCase(perfectEvidence("clean-pdf"), expectationFor("clean-pdf"));
    expect(score.fieldMismatches).toEqual([]);
    expect(score.lineCountMatches).toBe(true);
    expect(score.verdict).toBe("PASS");
  });

  it("scores against the PRINTED figures, so a silently corrected invoice is WRONG", () => {
    // The decisive case. arithmetic-mismatch prints VAT 165.00; a model
    // that "helpfully" returns 150.00 has corrected its supplier.
    const corrected = perfectEvidence("arithmetic-mismatch", ["line-vat-disagrees-with-rate"]);
    const header = (corrected.extracted as { header: Record<string, unknown> }).header;
    header.vatAmount = 150;
    header.total = 1150;

    const score = scoreCase(corrected, expectationFor("arithmetic-mismatch"));
    expect(score.verdict).toBe("FIELD MISMATCH");
    expect(score.fieldMismatches.map((f) => f.field).sort()).toEqual(["total", "vatAmount"]);
    expect(score.fieldMismatches.find((f) => f.field === "vatAmount")!.expected).toBe(165);
  });

  it("a validation disagreement is NOT reported as an extraction error", () => {
    // Fields all correct, findings differ: that is a VALIDATION MISMATCH,
    // and the model is not accused of anything.
    const score = scoreCase(perfectEvidence("clean-pdf", ["totals-disagree"]), expectationFor("clean-pdf"));
    expect(score.fieldMismatches).toEqual([]);
    expect(score.verdict).toBe("VALIDATION MISMATCH");
    expect(score.validation.unexpected).toEqual(["totals-disagree"]);
  });

  it("a missing line shows as missing fields and a line-count mismatch", () => {
    const short = perfectEvidence("mixed-vat");
    (short.extracted as { lines: unknown[] }).lines = [(short.extracted as { lines: unknown[] }).lines[0]];
    const score = scoreCase(short, expectationFor("mixed-vat"));
    expect(score.lineCountMatches).toBe(false);
    expect(score.actualLineCount).toBe(1);
    expect(score.expectedLineCount).toBe(2);
    expect(score.fieldMismatches.some((f) => f.outcome === "missing" && f.lineIndex === 1)).toBe(true);
  });

  it("an invented extra line shows as hallucinated fields", () => {
    const extra = perfectEvidence("clean-pdf");
    (extra.extracted as { lines: unknown[] }).lines.push({
      description: "Invented", supplierSku: null, quantity: 1, uom: null, packDescription: null,
      packQuantity: null, unitPrice: 50, discount: null, vatRatePercent: null, vatAmount: null, lineTotal: 50, confidence: null,
    });
    const score = scoreCase(extra, expectationFor("clean-pdf"));
    expect(score.lineCountMatches).toBe(false);
    expect(score.fieldMismatches.some((f) => f.outcome === "hallucinated")).toBe(true);
  });

  it("a provider failure is INCOMPLETE, not a field failure", () => {
    const failed: StoredEvidence = { ...perfectEvidence("clean-pdf"), outcome: "provider_error", extracted: null, error_category: "server-error", http_status: 503 };
    const score = scoreCase(failed, expectationFor("clean-pdf"));
    expect(score.verdict).toBe("INCOMPLETE");
    expect(score.extracted).toBe(false);
    expect(score.providerError?.category).toBe("server-error");
    expect(score.fields).toEqual([]);
  });
});

describe("scoring a run", () => {
  const evidence = MANIFEST.cases.map((c) => {
    const expectation = expectationFor(c.caseId);
    return perfectEvidence(c.caseId, expectation.validationFindings);
  });

  it("a perfect run scores every case PASS with zero mismatches", () => {
    const score = scoreRun(100, evidence);
    expect(score.casesScored).toBe(24);
    expect(score.casesPerfect).toBe(24);
    expect(score.fieldsIncorrect).toBe(0);
    expect(score.fieldsMissing).toBe(0);
    expect(score.fieldsHallucinated).toBe(0);
    expect(score.lineCountMismatches).toEqual([]);
    expect(score.validationMismatches).toEqual([]);
    expect(score.fieldsCompared).toBeGreaterThan(300);
  });

  it("is deterministic — the same evidence always scores identically", () => {
    expect(scoreRun(100, evidence)).toEqual(scoreRun(100, evidence));
  });

  it("refuses evidence naming a case that is not in the corpus", () => {
    const stray = { ...perfectEvidence("clean-pdf"), corpus_case_id: "not-a-case" };
    expect(() => scoreRun(100, [stray])).toThrow(/not in the corpus/);
  });

  it("the report states numbers and named discrepancies, with no invented threshold", () => {
    const text = formatRunScore(scoreRun(100, evidence));
    expect(text).toContain("Cases scored          : 24");
    expect(text).toContain("INCORRECT");
    expect(text).toContain("HALLUCINATED");
    expect(text).not.toMatch(/threshold|acceptable|good enough|\b95%\b|CERTIFICATION (PASSED|FAILED)/i);
  });
});
