/**
 * Phase 5O — the independent certification corpus, tested.
 *
 * @vitest-environment node
 *
 * These tests do three separate jobs:
 *
 *  1. COVERAGE — all 24 cases exist, each with exactly one document and
 *     exactly one answer key, and nothing is silently dropped.
 *  2. INDEPENDENCE — the answer keys cannot have come from an extraction,
 *     and no code path allows one to.
 *  3. AGREEMENT — the ground truth actually matches what is printed on the
 *     page. This one reads the REAL rendered PDFs, so a typo in either half
 *     is a failure rather than a silent agreement.
 *
 * NO PROVIDER IS CONTACTED BY ANY TEST HERE. Nothing in this file imports
 * the provider, the adapter or the SDK.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  certificationReadiness,
  computeCorpusHash,
  listCertificationCases,
  loadGroundTruth,
  loadManifest,
  requireCertificationCase,
  requireVerifiedCorpus,
  toScoringGroundTruth,
  verifyCorpusIntegrity,
  type CertificationGroundTruth,
  type ManifestCase,
} from "./certification-corpus";

const MANIFEST = loadManifest();
const CASES = listCertificationCases();

/** Every case the brief requires, by the name the corpus uses. */
const REQUIRED_CASES = [
  "clean-pdf", "multi-page", "scan", "jpg", "png", "rotated", "poor-quality",
  "small-text", "many-lines", "mixed-vat", "zero-vat", "no-vat", "discount",
  "uom-pack", "ambiguous-supplier", "duplicate", "repeated-invoice-number",
  "missing-vat-number", "missing-invoice-number", "arithmetic-mismatch",
  "credit-note", "debit-note", "foreign-currency",
  // The additional realistic baseline: the exact table layout that put a
  // weight into a cost field on every row of a real invoice in VYRON COST.
  "weight-column",
];

/** Source text with comments removed, for guards that would otherwise trip
 * on a file's own description of what it does not do. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("corpus inventory", () => {
  it("holds exactly 24 cases", () => {
    expect(MANIFEST.caseCount).toBe(24);
    expect(MANIFEST.cases).toHaveLength(24);
    expect(CASES).toHaveLength(24);
  });

  it.each(REQUIRED_CASES)("covers %s", (caseId) => {
    expect(MANIFEST.cases.some((c) => c.caseId === caseId)).toBe(true);
  });

  it("covers every required case and nothing is silently dropped", () => {
    expect([...MANIFEST.cases.map((c) => c.caseId)].sort()).toEqual([...REQUIRED_CASES].sort());
  });

  it("gives every case exactly one source document", () => {
    const files = MANIFEST.cases.map((c) => c.documentFile);
    expect(new Set(files).size).toBe(files.length);
    for (const entry of CASES) {
      expect(readFileSync(entry.documentPath).length).toBeGreaterThan(1024);
    }
  });

  it("gives every case exactly one independent ground-truth record", () => {
    const files = MANIFEST.cases.map((c) => c.groundTruthFile);
    expect(new Set(files).size).toBe(files.length);
    for (const entry of CASES) {
      expect(entry.truth.caseId).toBe(entry.caseId);
      expect(entry.truth.documentId).toBe(entry.documentFile);
    }
  });

  it("records who established every answer key", () => {
    for (const entry of CASES) {
      expect(`${entry.caseId}:${entry.truth.verifiedBy.length > 40}`).toBe(`${entry.caseId}:true`);
      expect(entry.truth.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("delivers the formats a provider will actually receive", () => {
    const byExtension = (ext: string) => MANIFEST.cases.filter((c) => c.documentFile.endsWith(ext)).length;
    expect(byExtension(".pdf")).toBeGreaterThanOrEqual(19);
    expect(byExtension(".jpg")).toBeGreaterThanOrEqual(2);
    expect(byExtension(".png")).toBeGreaterThanOrEqual(2);
  });

  it("is ready, and says so in numbers", () => {
    // Phase 5N reported ready=0 with a note that this assertion should be
    // changed deliberately when a corpus was authored. Phase 5O authored it.
    const readiness = certificationReadiness();
    expect(readiness.totalCases).toBe(24);
    expect(readiness.withDocument).toBe(24);
    expect(readiness.withGroundTruth).toBe(24);
    expect(readiness.ready).toBe(24);
    expect(readiness.integrityOk).toBe(true);
    expect(readiness.outstanding).toEqual([]);
  });
});

describe("corpus integrity", () => {
  it("verifies clean, and the manifest's own hash is self-consistent", () => {
    const result = verifyCorpusIntegrity();
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(computeCorpusHash(MANIFEST.cases)).toBe(MANIFEST.corpusSha256);
  });

  it("the corpus hash is deterministic and order-independent", () => {
    const shuffled = [...MANIFEST.cases].reverse();
    expect(computeCorpusHash(shuffled)).toBe(computeCorpusHash(MANIFEST.cases));
    expect(computeCorpusHash(MANIFEST.cases)).toBe(computeCorpusHash(MANIFEST.cases));
  });

  it("a changed SOURCE DOCUMENT changes the hash", () => {
    const tampered: ManifestCase[] = MANIFEST.cases.map((c, i) =>
      i === 0 ? { ...c, documentSha256: c.documentSha256.replace(/^./, "f") } : c,
    );
    expect(computeCorpusHash(tampered)).not.toBe(MANIFEST.corpusSha256);
  });

  it("a changed GROUND TRUTH changes the hash", () => {
    const tampered: ManifestCase[] = MANIFEST.cases.map((c, i) =>
      i === 0 ? { ...c, groundTruthSha256: c.groundTruthSha256.replace(/^./, "f") } : c,
    );
    expect(computeCorpusHash(tampered)).not.toBe(MANIFEST.corpusSha256);
  });

  it("the certification runner REFUSES a modified corpus", () => {
    // Pointed at a directory whose manifest does not describe what is on
    // disk. The run must stop rather than certify against an unknown set.
    expect(() => requireVerifiedCorpus("src/server/supplier-invoice-capture")).toThrow();
  });

  it("the certification runner refuses MISSING ground truth", () => {
    expect(() => loadGroundTruth("no-such-case")).toThrow(/no ground truth/i);
    expect(() => requireCertificationCase("no-such-case")).toThrow(/no certification case/i);
  });

  it("refuses ground truth with no verifiedBy", () => {
    // Unattributed truth is not truth: who established it, and how, is the
    // only thing separating an answer key from another opinion.
    expect(() => loadGroundTruth("clean-pdf", "src/server")).toThrow();
  });

  it("passes the real gate on the real corpus", () => {
    expect(requireVerifiedCorpus().corpusSha256).toBe(MANIFEST.corpusSha256);
  });
});

describe("independence — ground truth cannot come from an extraction", () => {
  it("the answer keys are plain JSON, which can neither import nor call anything", () => {
    for (const entry of CASES) {
      const raw = readFileSync(`certification-corpus/ground-truth/${entry.caseId}.json`, "utf8");
      expect(() => JSON.parse(raw)).not.toThrow();
      expect(raw).not.toMatch(/\bimport\b|\brequire\(|=>|function\s/);
    }
  });

  it("the loader never imports extraction output, the fixtures, the prompt or the provider", () => {
    const source = readFileSync("src/server/supplier-invoice-capture/certification-corpus.ts", "utf8");
    const imports = source.match(/^import[\s\S]*?;$/gm)?.join("\n") ?? "";
    expect(imports).not.toMatch(/ExtractionResult/);
    expect(imports).not.toMatch(/\bCORPUS\b|test-corpus/);
    expect(imports).not.toMatch(/extraction-provider|gateway|EXTRACTION_INSTRUCTION|validation/);
  });

  it("no ground-truth builder accepts an ExtractionResult", () => {
    const source = readFileSync("src/server/supplier-invoice-capture/certification-corpus.ts", "utf8");
    // `toScoringGroundTruth` takes an authored record and returns a
    // GroundTruth. Nothing here takes an extraction and returns one.
    expect(source).not.toMatch(/function\s+\w*[Tt]ruth[Ff]rom(Extraction|Result|Answer)/);
    expect(source).not.toMatch(/\(\s*\w+\s*:\s*ExtractionResult/);
  });

  it("the authoring script derives nothing from src/ or from any model", () => {
    // Comments are stripped first: the file NAMES these things in order to
    // say it does not use them, and a guard that trips on its own
    // explanation is noise rather than evidence.
    const source = stripComments(readFileSync("scripts/author-ground-truth.mjs", "utf8"));
    expect(source).not.toMatch(/from\s+["'].*\/src\//);
    expect(source).not.toMatch(/document-content|test-corpus|ExtractionResult|generateObject/);
  });

  it("the arithmetic answer key does not come from Finance's implementation", () => {
    const source = stripComments(readFileSync("scripts/author-ground-truth.mjs", "utf8"));
    // The point of the corpus is to detect disagreement between the
    // document, the model and Finance. An answer key computed BY Finance
    // could never catch Finance being wrong.
    expect(source).not.toMatch(/computeLineAmounts|summarizeBillLines|computeBillLine|invoice-totals/);
  });

  it("the harness still never derives truth from an extraction", () => {
    const source = readFileSync("src/server/supplier-invoice-capture/certification-harness.ts", "utf8");
    expect(source).not.toMatch(/truth\s*=\s*extraction|groundTruth\s*=\s*(result|extraction)/);
    expect(source).not.toMatch(/function\s+\w*[Tt]ruth[Ff]rom/);
  });
});

describe("missing / absent / ambiguous / not-applicable semantics", () => {
  const status = (caseId: string, field: string) =>
    CASES.find((c) => c.caseId === caseId)!.truth.fieldStatus[field];

  it("a non-VAT-registered supplier has a CORRECTLY ABSENT VAT number", () => {
    // There is no VAT number to omit. Scoring this as an error punishes a
    // correct reading.
    expect(status("no-vat", "supplierVatNumber")).toBe("correctly-absent");
    expect(status("no-vat", "vatAmount")).toBe("not-applicable");
  });

  it("a VAT-registered supplier whose tax invoice omits the number is MISSING", () => {
    // Same empty field, opposite meaning: this document charges VAT and is
    // headed TAX INVOICE, so the absence is a defect.
    expect(status("missing-vat-number", "supplierVatNumber")).toBe("missing");
  });

  it("the two cases are genuinely different documents, not the same one labelled twice", () => {
    const noVat = CASES.find((c) => c.caseId === "no-vat")!.truth;
    const missing = CASES.find((c) => c.caseId === "missing-vat-number")!.truth;
    expect(noVat.supplier.name).not.toBe(missing.supplier.name);
    expect(noVat.lines[0].vatRatePercent).toBeNull();
    expect(missing.lines[0].vatRatePercent).toBe(15);
  });

  it("an unidentifiable supplier is AMBIGUOUS, never resolved", () => {
    expect(status("ambiguous-supplier", "supplierName")).toBe("ambiguous");
    expect(CASES.find((c) => c.caseId === "ambiguous-supplier")!.truth.expected.supplierResolution).toBe("ambiguous");
  });

  it("an absent invoice number on an otherwise complete invoice is MISSING", () => {
    expect(status("missing-invoice-number", "invoiceNumber")).toBe("missing");
    expect(CASES.find((c) => c.caseId === "missing-invoice-number")!.truth.invoiceNumber).toBeNull();
  });

  it("a foreign supplier's South African VAT is NOT APPLICABLE, not missing", () => {
    expect(status("foreign-currency", "supplierVatNumber")).toBe("not-applicable");
    expect(status("foreign-currency", "currency")).toBe("present");
  });

  it("uses only the five defined statuses, so no case invents a sixth meaning", () => {
    const allowed = new Set(["present", "correctly-absent", "missing", "ambiguous", "not-applicable"]);
    for (const entry of CASES) {
      for (const [field, value] of Object.entries(entry.truth.fieldStatus)) {
        expect(`${entry.caseId}.${field}:${allowed.has(value)}`).toBe(`${entry.caseId}.${field}:true`);
      }
    }
  });

  it("does not turn every absent field into an error", () => {
    // The brief is explicit about this. Most absences in this corpus are
    // correct, and only two are findings.
    const absences = CASES.flatMap((c) => Object.values(c.truth.fieldStatus)).filter((s) => s === "correctly-absent");
    const findings = CASES.filter((c) => c.truth.expected.validationFindings.includes("missing-required-field"));
    expect(absences.length).toBeGreaterThan(10);
    expect(findings.map((c) => c.caseId).sort()).toEqual(["missing-invoice-number", "missing-vat-number"]);
  });
});

describe("arithmetic ground truth", () => {
  it("every case carries independently calculated arithmetic", () => {
    for (const entry of CASES) {
      const a = entry.truth.independentArithmetic;
      expect(a.lineExtensions).toHaveLength(entry.truth.lines.length);
      expect(typeof a.taxableAmount).toBe("number");
      expect(typeof a.total).toBe("number");
    }
  });

  it("re-derives every figure with arithmetic written HERE, independently again", () => {
    // Deliberately duplicated rather than imported: if this test called the
    // same helper the authoring script used, a wrong helper would agree
    // with itself. Written out a third time, by hand.
    for (const entry of CASES) {
      const truth = entry.truth;
      const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

      let net = 0;
      let vat = 0;
      let anyVat = false;
      for (const line of truth.lines) {
        const taxable = round2(line.quantity * line.unitPrice - line.discount);
        expect(`${truth.caseId}:${taxable}`).toBe(`${truth.caseId}:${line.lineTotal}`);
        net = round2(net + taxable);
        if (line.vatRatePercent !== null) {
          anyVat = true;
          vat = round2(vat + round2((taxable * line.vatRatePercent) / 100));
        }
      }

      expect(`${truth.caseId} net:${net}`).toBe(`${truth.caseId} net:${truth.independentArithmetic.taxableAmount}`);
      expect(`${truth.caseId} vat:${anyVat ? vat : null}`).toBe(`${truth.caseId} vat:${truth.independentArithmetic.vat}`);
      expect(`${truth.caseId} total:${round2(net + (anyVat ? vat : 0))}`).toBe(`${truth.caseId} total:${truth.independentArithmetic.total}`);
    }
  });

  it("the deliberately wrong document stays wrong, and both figures are recorded", () => {
    const wrong = CASES.find((c) => c.caseId === "arithmetic-mismatch")!.truth;
    expect(wrong.documentIsArithmeticallyWrong).toBe(true);

    // What the page prints — preserved exactly, never corrected.
    expect(wrong.printedTotals.vatAmount).toBe(165.0);
    expect(wrong.printedTotals.total).toBe(1165.0);

    // What the arithmetic actually gives.
    expect(wrong.independentArithmetic.vat).toBe(150.0);
    expect(wrong.independentArithmetic.total).toBe(1150.0);

    // And the expected system behaviour: notice, do not silently fix.
    expect(wrong.expected.validationFindings).toContain("totals-mismatch");
  });

  it("scoring uses the PRINTED figure, so a silently corrected invoice scores WRONG", () => {
    // The decisive property of this case. A model that returns 150.00 has
    // corrected its supplier's invoice — plausible, helpful-looking, and
    // exactly how a wrong figure enters a ledger unchallenged.
    const scoring = toScoringGroundTruth(CASES.find((c) => c.caseId === "arithmetic-mismatch")!.truth);
    expect(scoring.vatAmount).toBe(165.0);
    expect(scoring.total).toBe(1165.0);
    expect(scoring.lines[0].vatAmount).toBe(165.0);
  });

  it("every other case's printed totals and arithmetic agree", () => {
    for (const entry of CASES) {
      if (entry.caseId === "arithmetic-mismatch") continue;
      expect(`${entry.caseId}:${entry.truth.documentIsArithmeticallyWrong}`).toBe(`${entry.caseId}:false`);
      expect(`${entry.caseId}:${entry.truth.printedTotals.total}`).toBe(`${entry.caseId}:${entry.truth.independentArithmetic.total}`);
    }
  });

  it("charges VAT after discount, not before", () => {
    const discount = CASES.find((c) => c.caseId === "discount")!.truth;
    expect(discount.lines[0].lineTotal).toBe(900.0);
    expect(discount.printedTotals.vatAmount).toBe(135.0); // 15% of 900, not of 1 000
  });

  it("keeps mixed VAT per line rather than at a blended header rate", () => {
    const mixed = CASES.find((c) => c.caseId === "mixed-vat")!.truth;
    expect(mixed.independentArithmetic.taxableAmount).toBe(1300.0);
    expect(mixed.independentArithmetic.vat).toBe(150.0); // NOT 1 300 x 15% = 195
  });
});

describe("supplier resolution expectations", () => {
  it("records an expected outcome for every case", () => {
    const allowed = new Set(["resolved-exact", "ambiguous", "unresolved"]);
    for (const entry of CASES) {
      expect(`${entry.caseId}:${allowed.has(entry.truth.expected.supplierResolution)}`).toBe(`${entry.caseId}:true`);
    }
  });

  it("an exact match is expected only where the supplier is deterministically identifiable", () => {
    const exact = CASES.filter((c) => c.truth.expected.supplierResolution === "resolved-exact");
    expect(exact.length).toBeGreaterThan(15);
  });

  it("a high fuzzy score is NOT an expected resolution", () => {
    // 'Karoo Wholesale Supply (Pty) Ltd' scores very close to 'Karoo
    // Wholesale Supplies' and is a different legal entity. Posting against
    // the wrong one is not fixed by editing a name afterwards.
    const ambiguous = CASES.find((c) => c.caseId === "ambiguous-supplier")!.truth;
    expect(ambiguous.expected.supplierResolution).toBe("ambiguous");
    expect(ambiguous.supplier.vatNumber).toBeNull();
    expect(ambiguous.supplier.registrationNumber).toBeNull();
    expect(ambiguous.expected.conversion).toBe("blocked-no-supplier");
  });

  it("an unknown foreign supplier is unresolved, not guessed", () => {
    expect(CASES.find((c) => c.caseId === "foreign-currency")!.truth.expected.supplierResolution).toBe("unresolved");
  });
});

describe("duplicate expectations", () => {
  it("covers all four scenarios the brief names", () => {
    const outcome = (caseId: string) => CASES.find((c) => c.caseId === caseId)!.truth.expected.duplicate;

    // A genuine unique invoice.
    expect(outcome("clean-pdf")).toBe("none");
    // An exact duplicate of it.
    expect(outcome("duplicate")).toBe("blocked");
    // The same invoice NUMBER from a different supplier.
    expect(outcome("repeated-invoice-number")).toBe("none");
    // The same supplier with a different invoice number.
    expect(outcome("mixed-vat")).toBe("none");
  });

  it("the duplicate really is the same invoice identity as clean-pdf", () => {
    const original = CASES.find((c) => c.caseId === "clean-pdf")!.truth;
    const copy = CASES.find((c) => c.caseId === "duplicate")!.truth;

    expect(copy.supplier.name).toBe(original.supplier.name);
    expect(copy.invoiceNumber).toBe(original.invoiceNumber);
    expect(copy.invoiceDate).toBe(original.invoiceDate);
    expect(copy.printedTotals.total).toBe(original.printedTotals.total);
    // ...but a DIFFERENT file, so a content hash alone cannot catch it.
    const entry = (id: string) => MANIFEST.cases.find((c) => c.caseId === id)!;
    expect(entry("duplicate").documentSha256).not.toBe(entry("clean-pdf").documentSha256);
    expect(copy.duplicateScenario).toMatch(/content-hash/i);
  });

  it("the repeated number is a DIFFERENT supplier, so it is not a duplicate", () => {
    const original = CASES.find((c) => c.caseId === "clean-pdf")!.truth;
    const repeated = CASES.find((c) => c.caseId === "repeated-invoice-number")!.truth;
    expect(repeated.invoiceNumber).toBe(original.invoiceNumber);
    expect(repeated.supplier.name).not.toBe(original.supplier.name);
    expect(repeated.expected.duplicate).toBe("none");
  });

  it("the same supplier with different numbers is not a duplicate either", () => {
    const karoo = CASES.filter((c) => c.truth.supplier.name === "Karoo Wholesale Supplies");
    const numbers = karoo.map((c) => c.truth.invoiceNumber);
    expect(karoo.length).toBeGreaterThan(4);
    // Only clean-pdf and duplicate share a number; everything else differs.
    expect(numbers.filter((n) => n === "KW-10041")).toHaveLength(2);
  });
});

describe("credit note, debit note and foreign currency — boundaries unchanged", () => {
  it("a credit note is classified and then REFUSED for ordinary Bill conversion", () => {
    const credit = CASES.find((c) => c.caseId === "credit-note")!.truth;
    expect(credit.documentType).toBe("Credit Note");
    expect(credit.expected.validationFindings).toContain("not-an-invoice");
    expect(credit.expected.conversion).toBe("not-supported-credit-note");
  });

  it("a debit note likewise", () => {
    const debit = CASES.find((c) => c.caseId === "debit-note")!.truth;
    expect(debit.documentType).toBe("Debit Note");
    expect(debit.expected.conversion).toBe("not-supported-debit-note");
  });

  it("both print POSITIVE amounts — a credit note does not print negatives", () => {
    for (const id of ["credit-note", "debit-note"]) {
      const truth = CASES.find((c) => c.caseId === id)!.truth;
      expect(truth.printedTotals.total).toBeGreaterThan(0);
      expect(truth.lines.every((l) => l.lineTotal > 0)).toBe(true);
    }
  });

  it("the foreign-currency case is extracted correctly and then refused", () => {
    const foreign = CASES.find((c) => c.caseId === "foreign-currency")!.truth;
    expect(foreign.currency).toBe("USD");
    expect(foreign.expected.conversion).toBe("not-supported-foreign-currency");
    // No invented rate, no converted amount anywhere in the record.
    expect(JSON.stringify(foreign)).not.toMatch(/exchange|rate of|ZAR equivalent|converted/i);
  });

  it("no case expects a credit or debit note to become a Draft Bill", () => {
    for (const entry of CASES) {
      if (entry.truth.documentType === "Invoice") continue;
      expect(`${entry.caseId}:${entry.truth.expected.conversion}`).not.toBe(`${entry.caseId}:draft-bill`);
    }
  });
});

describe("security — synthetic only", () => {
  const allText = CASES.map((c) => JSON.stringify(c.truth)).join("\n");

  it("contains no production tenant, customer or supplier", () => {
    expect(allText).not.toMatch(/northwood|gnvhzckxryuttsqnvriv/i);
  });

  it("contains no credential, key or token", () => {
    expect(allText).not.toMatch(/sk-[A-Za-z0-9]{12,}|AI_GATEWAY_API_KEY|eyJhbGciOi|vck_/);
  });

  it("contains no production tenant id", () => {
    // No bare UUIDs: company ids in this system are UUIDs, and a corpus is
    // no place for one.
    expect(allText).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("uses only the invented supplier cast", () => {
    const allowed = new Set([
      "Karoo Wholesale Supplies", "Karoo Wholesale Supply (Pty) Ltd", "Loskop Handyman Services",
      "Drakensberg Cold Chain", "Umgeni Packaging Co", "Highveld Fasteners", "Atlas Software International Inc",
    ]);
    for (const entry of CASES) {
      expect(`${entry.caseId}:${allowed.has(entry.truth.supplier.name)}`).toBe(`${entry.caseId}:true`);
    }
  });
});

describe("the ground truth agrees with what is printed on the page", () => {
  /**
   * Reads the REAL rendered PDF and returns its text.
   *
   * This is the mechanised half of the brief's "independently inspect every
   * document". It is not an extraction: pdfjs returns the text the PDF
   * itself stores, with no model and no interpretation. Because it reads
   * the finished artefact rather than the authoring spec, a typo in either
   * half of the corpus shows up here instead of agreeing with itself.
   *
   * The image cases (scan, jpg, png, rotated, poor-quality) have no text
   * layer by design and were inspected visually instead — recorded in the
   * Phase 5O report.
   */
  async function pdfText(file: string): Promise<string> {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const data = new Uint8Array(readFileSync(`certification-corpus/documents/${file}`));
    const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
    let text = "";
    for (let page = 1; page <= doc.numPages; page += 1) {
      const content = await (await doc.getPage(page)).getTextContent();
      text += content.items.map((i) => ("str" in i ? i.str : "")).join(" ") + "\n";
    }
    await doc.destroy();
    // Collapse whitespace so "1 150.00" and "1  150.00" compare equal.
    return text.replace(/\s+/g, " ");
  }

  const money = (n: number) => {
    const [whole, fraction] = n.toFixed(2).split(".");
    return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ")}.${fraction}`;
  };

  const TEXT_PDF_CASES = MANIFEST.cases
    .filter((c) => c.documentFile.endsWith(".pdf") && c.caseId !== "scan")
    .map((c) => c.caseId);

  it("covers 19 text PDFs mechanically; the 5 image cases were inspected by eye", () => {
    // scan.pdf is deliberately image-only, so it joins the four true image
    // formats in the by-eye group rather than this one.
    expect(TEXT_PDF_CASES).toHaveLength(19);
    expect(MANIFEST.cases.length - TEXT_PDF_CASES.length).toBe(5);
  });

  it.each(TEXT_PDF_CASES)("%s: supplier, number, date and totals appear on the page", async (caseId) => {
    const truth: CertificationGroundTruth = loadGroundTruth(caseId);
    const text = await pdfText(truth.documentId);

    expect(text).toContain(truth.supplier.name);
    if (truth.invoiceNumber) expect(text).toContain(truth.invoiceNumber);
    if (truth.supplier.vatNumber) expect(text).toContain(truth.supplier.vatNumber);

    // The printed totals — the figures a reader must return.
    expect(text).toContain(money(truth.printedTotals.total));
    if (truth.printedTotals.subtotal !== undefined) expect(text).toContain(money(truth.printedTotals.subtotal));
    if (truth.printedTotals.vatAmount !== undefined) expect(text).toContain(money(truth.printedTotals.vatAmount));
  });

  it.each(TEXT_PDF_CASES)("%s: every line's description and amount appear on the page", async (caseId) => {
    const truth: CertificationGroundTruth = loadGroundTruth(caseId);
    const text = await pdfText(truth.documentId);

    for (const line of truth.lines) {
      expect(`${caseId}:${text.includes(line.description)}`).toBe(`${caseId}:true`);
      expect(`${caseId}:${text.includes(money(line.lineTotal))}`).toBe(`${caseId}:true`);
      expect(`${caseId}:${text.includes(money(line.unitPrice))}`).toBe(`${caseId}:true`);
    }
  });

  it("a field recorded as ABSENT really is absent from the page", async () => {
    // The trap this avoids: declaring a field missing while the document
    // prints it perfectly well, which would score a correct reading as a
    // hallucination.
    // Note the trap inside the trap: the page DOES print a VAT number —
    // the BILL-TO party's, which is our own company and entirely correct.
    // What must be absent is a VAT number for the SUPPLIER. Asserting on
    // "VAT Reg No" alone would have failed on a perfectly good document.
    const noVat = await pdfText("no-vat.pdf");
    const SUPPLIER_VAT_NUMBERS = ["4111222333", "4990887766", "4223344556", "4778899001"];
    for (const number of SUPPLIER_VAT_NUMBERS) expect(noVat).not.toContain(number);
    expect(noVat).not.toContain("V.A.T.");
    expect(noVat).toContain("Not registered for VAT.");

    const missingVat = await pdfText("missing-vat-number.pdf");
    expect(missingVat).not.toContain("4990887766");
    expect(missingVat).toContain("TAX INVOICE"); // ...but it IS a tax invoice
    expect(missingVat).toContain("V.A.T.");

    const noNumber = await pdfText("missing-invoice-number.pdf");
    expect(noNumber).not.toContain("Invoice no");
  });

  it("the deliberately incorrect arithmetic is really printed incorrectly", async () => {
    const text = await pdfText("arithmetic-mismatch.pdf");
    expect(text).toContain("165.00");
    expect(text).toContain("1 165.00");
    // The correct figures must NOT appear — otherwise the document is
    // ambiguous rather than wrong.
    expect(text).not.toContain("1 150.00");
  });

  it("credit and debit notes are visibly identifiable as such", async () => {
    expect(await pdfText("credit-note.pdf")).toContain("CREDIT NOTE");
    expect(await pdfText("debit-note.pdf")).toContain("DEBIT NOTE");
    // ...and the ordinary invoices are not mislabelled.
    expect(await pdfText("clean-pdf.pdf")).not.toContain("CREDIT NOTE");
  });

  it("foreign currency is visibly identifiable, stated more than once", async () => {
    const text = await pdfText("foreign-currency.pdf");
    expect(text).toContain("USD");
    expect(text).toContain("$");
    expect(text.match(/USD/g)!.length).toBeGreaterThanOrEqual(2);
  });

  it("the non-money weight column is printed, and is not a price", async () => {
    const text = await pdfText("weight-column.pdf");
    expect(text).toContain("MASS (kg)");
    expect(text).toContain("5.33");
    expect(text).toContain("47.10");

    const truth = loadGroundTruth("weight-column");
    for (const line of truth.lines) {
      const weight = Object.values(line.printedNonMoneyColumns!)[0];
      expect(line.unitPrice).not.toBe(weight);
      expect(line.vatAmount).not.toBe(weight);
      expect(line.lineTotal).not.toBe(weight);
    }
  });

  it("the scanned PDF has NO text layer, so it cannot be parsed instead of read", async () => {
    expect((await pdfText("scan.pdf")).trim().length).toBeLessThan(20);
  });

  it("no document hides an answer key in invisible text or metadata", async () => {
    // A machine-readable answer would make extraction artificially easy and
    // the certification meaningless.
    for (const caseId of TEXT_PDF_CASES) {
      const truth = loadGroundTruth(caseId);
      const raw = readFileSync(`certification-corpus/documents/${truth.documentId}`).toString("latin1");
      // The real property is that no ANSWER leaks through metadata. Chrome
      // writes /Title (about:blank), which gives nothing away; asserting an
      // empty title instead would police the wrong thing.
      const metadata = raw.match(/\/(Title|Subject|Keywords|Author|Producer|Creator) \([^)]*\)/g)?.join(" ") ?? "";
      expect(`${caseId}:${metadata.includes(truth.supplier.name)}`).toBe(`${caseId}:false`);
      if (truth.invoiceNumber) {
        expect(`${caseId}:${metadata.includes(truth.invoiceNumber)}`).toBe(`${caseId}:false`);
      }
      expect(`${caseId}:${metadata.includes(String(truth.printedTotals.total))}`).toBe(`${caseId}:false`);
      expect(`${caseId}:${raw.includes("groundTruth")}`).toBe(`${caseId}:false`);
      expect(`${caseId}:${raw.includes("caseId")}`).toBe(`${caseId}:false`);
    }
  });
});
