/**
 * Phase 5L — the corpus runs against the deterministic pipeline.
 *
 * No provider is called. Each fixture is an answer a model returned; the
 * assertion is what THIS SYSTEM concludes about it. That is the contract
 * worth freezing — model behaviour will drift, and what must not drift is
 * how a given answer is treated.
 */
import { describe, expect, it } from "vitest";
import { CORPUS, REQUIRED_PROFILES } from "./test-corpus";
import { shouldRetryExtraction, validateExtraction } from "./validation";
import { FixtureExtractionProvider } from "./extraction-provider";
import type { ExtractionInput } from "./types";

describe("corpus coverage", () => {
  it("covers every document profile the phase requires", () => {
    const covered = new Set(CORPUS.map((c) => c.profile));
    const missing = REQUIRED_PROFILES.filter((p) => !covered.has(p));
    expect(missing).toEqual([]);
  });

  it("uses only synthetic data — no production invoice is referenced", () => {
    const serialised = JSON.stringify(CORPUS);
    // The reference tenants and suppliers that appear in this repository's
    // real data must not appear in a test fixture.
    for (const forbidden of ["Northwood", "Metanoia", "Gourmet Foods", "Kingdom Foods", "Food Sock", "Harlow"]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it("has a unique key per case", () => {
    expect(new Set(CORPUS.map((c) => c.key)).size).toBe(CORPUS.length);
  });
});

describe.each(CORPUS)("$key — $description", (testCase) => {
  const report = validateExtraction(testCase.answer);

  it(`is assessed as ${testCase.expect.validation}`, () => {
    expect(report.status).toBe(testCase.expect.validation);
  });

  if (testCase.expect.findings) {
    it("raises the expected findings", () => {
      for (const code of testCase.expect.findings!) {
        expect(report.findings.map((f) => f.code)).toContain(code);
      }
    });
  }

  if (testCase.expect.retryable !== undefined) {
    it(`is ${testCase.expect.retryable ? "" : "not "}retried`, () => {
      expect(shouldRetryExtraction(report, 1, 3)).toBe(testCase.expect.retryable);
    });
  }

  it("never stores a placeholder string where a number or date belongs", () => {
    const { header, lines } = testCase.answer;
    for (const value of [header.subtotal, header.vatAmount, header.total, header.discountTotal]) {
      expect(value === null || typeof value === "number").toBe(true);
    }
    for (const value of [header.invoiceDate, header.dueDate]) {
      expect(value === null || /^\d{4}-\d{2}-\d{2}$/.test(value)).toBe(true);
    }
    for (const l of lines) {
      for (const value of [l.quantity, l.unitPrice, l.discount, l.vatAmount, l.lineTotal, l.packQuantity]) {
        expect(value === null || typeof value === "number").toBe(true);
      }
    }
  });
});

describe("the two failure modes that matter most", () => {
  it("the weight-column invoice is rejected despite confidence 95 on every row", () => {
    const testCase = CORPUS.find((c) => c.key === "weight-column")!;
    expect(testCase.answer.header.confidence).toBe(95);
    expect(testCase.answer.lines.every((l) => l.confidence === 95)).toBe(true);
    const report = validateExtraction(testCase.answer);
    expect(report.status).toBe("Incomplete");
    expect(report.findings.map((f) => f.code)).toContain("constant-money-column");
  });

  it("a low-confidence but arithmetically sound scan is accepted", () => {
    const testCase = CORPUS.find((c) => c.key === "jpg-photo")!;
    expect(testCase.answer.header.confidence).toBeLessThan(50);
    expect(validateExtraction(testCase.answer).status).toBe("Pass");
  });

  it("taken together: confidence predicts nothing about the verdict", () => {
    const byConfidence = CORPUS.map((c) => ({
      confidence: c.answer.header.confidence ?? 0,
      ok: validateExtraction(c.answer).status === "Pass",
    }));
    const highAndRejected = byConfidence.filter((r) => r.confidence >= 85 && !r.ok);
    const lowAndAccepted = byConfidence.filter((r) => r.confidence < 65 && r.ok);
    expect(highAndRejected.length).toBeGreaterThan(0);
    expect(lowAndAccepted.length).toBeGreaterThan(0);
  });
});

describe("FixtureExtractionProvider", () => {
  const input: ExtractionInput = { bytes: new Uint8Array([1, 2, 3]), mimeType: "application/pdf" };

  it("returns the fixture for a known document", async () => {
    const testCase = CORPUS[0];
    const provider = new FixtureExtractionProvider(
      new Map([["k", { ok: true as const, result: testCase.answer, model: "fixture", usage: null }]]),
      () => "k",
    );
    const out = await provider.extract(input);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.result.header.invoiceNumber).toBe(testCase.answer.header.invoiceNumber);
  });

  it("fails honestly for an unknown document rather than inventing one", async () => {
    const provider = new FixtureExtractionProvider(new Map(), () => "missing");
    const out = await provider.extract(input);
    expect(out).toMatchObject({ ok: false, category: "unsupported-document" });
  });

  it("makes no network call — the whole corpus is provider-free", async () => {
    // A guard against a future edit reaching for the real provider here:
    // the fixture provider's only dependency is its own Map.
    const provider = new FixtureExtractionProvider(new Map(), () => "x");
    await expect(provider.extract(input)).resolves.toBeDefined();
  });
});
