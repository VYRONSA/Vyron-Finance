/**
 * @vitest-environment node
 *
 * SD-3C — the supplier-statement certification corpus.
 *
 * Runs the PRODUCTION read path (`readStatementFile`: file-type detection →
 * PDF layout / tabular reader) and the production validation over every
 * document in `statement-corpus/`, and compares the result with the answer
 * key typed by hand from the rendered page (`statement-corpus/ground-truth`).
 * The answer keys were not produced by the reader or the renderer.
 *
 * A failure here means the reader disagrees with a person reading the page.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectStatementFileType } from "./file-type";
import { readStatementFile } from "./read-statement";
import { validateStatement, type ValidationInput } from "./validation";
import type { ExtractedStatementLine, SignConvention, StatementExtraction } from "./types";

type Manifest = { documents: { key: string; file: string; format: string; sha256: string }[] };
type ExpectedLine = {
  page: number | null;
  date: string | null;
  reference: string | null;
  debit: number | null;
  credit: number | null;
  balance: number | null;
  type: string;
  typeSource?: string;
  unresolved: string[];
  descriptionIncludes?: string[];
  rawIncludes?: string[];
};
type GroundTruth = {
  key: string;
  file: string;
  expect: "extract" | "scanned" | "image" | "encrypted";
  method?: "layout" | "tabular";
  pageCount?: number;
  header?: Record<string, unknown>;
  transactions?: ExpectedLine[];
  excluded?: { page: number | null; reason: string; value?: number | null }[];
  validation?: { status: string; codes: string[]; firstBreak?: { transactionIndex: number; expected: number; printed: number }; closingDifference?: number };
  withCreditIncreasesOwed?: { status: string; codes: string[] };
};

const ROOT = "statement-corpus";
const manifest = JSON.parse(readFileSync(`${ROOT}/manifest.json`, "utf8")) as Manifest;
const truths = readdirSync(`${ROOT}/ground-truth`)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(`${ROOT}/ground-truth/${f}`, "utf8")) as GroundTruth);

function validationInput(extraction: StatementExtraction, signConvention: SignConvention): ValidationInput {
  const h = extraction.header;
  return {
    openingBalance: h.openingBalance,
    closingBalance: h.closingBalance,
    statementDate: h.statementDate,
    periodFrom: h.periodFrom,
    currencyCode: h.currencyCode,
    printedTotalDebits: h.printedTotalDebits,
    printedTotalCredits: h.printedTotalCredits,
    printedAgeing: h.printedAgeing,
    signConvention,
    baseCurrencyCode: "ZAR",
    lines: extraction.lines,
  };
}

async function read(truth: GroundTruth) {
  const bytes = new Uint8Array(readFileSync(`${ROOT}/${truth.file}`));
  const kind = detectStatementFileType(bytes, truth.file);
  expect(kind, `${truth.key}: file type`).not.toBeNull();
  return { kind, outcome: await readStatementFile(bytes, kind!) };
}

describe("statement corpus — integrity", () => {
  it("every document is in the manifest, unchanged, and has a hand-typed answer key", () => {
    expect(manifest.documents.length).toBe(15);
    for (const doc of manifest.documents) {
      const bytes = readFileSync(`${ROOT}/${doc.file}`);
      expect(createHash("sha256").update(bytes).digest("hex"), doc.key).toBe(doc.sha256);
      expect(truths.some((t) => t.key === doc.key && t.file === doc.file), `answer key for ${doc.key}`).toBe(true);
    }
    expect(truths.length).toBe(manifest.documents.length);
  });

  it("covers the owner's required cases", () => {
    const keys = new Set(manifest.documents.map((d) => d.key));
    for (const required of [
      "karoo-point", "highveld-comma-crdr", "multipage-repeated", "multipage-continuation", "ambiguous-unreadable",
      "repeated-line", "arithmetic-errors", "reverse-convention", "layout-variation", "scanned", "scan-jpg", "scan-png",
      "encrypted", "csv-semicolon", "xlsx-typed",
    ]) {
      expect(keys.has(required), required).toBe(true);
    }
  });
});

describe.each(truths.filter((t) => t.expect !== "extract"))("statement corpus — $key (not read automatically)", (truth) => {
  it(`is recognised as ${truth.expect} and never guessed at`, async () => {
    const { kind, outcome } = await read(truth);
    if (truth.expect === "image") {
      expect(kind).toBe("image");
      expect(outcome.kind).toBe("manual-entry");
    } else if (truth.expect === "scanned") {
      expect(kind).toBe("pdf");
      expect(outcome).toMatchObject({ kind: "manual-entry", sourceType: "pdf-scanned" });
    } else {
      expect(outcome).toMatchObject({ kind: "failed", category: "encrypted" });
      if (outcome.kind === "failed") expect(outcome.reason).toMatch(/password/i);
    }
  });
});

describe.each(truths.filter((t) => t.expect === "extract"))("statement corpus — $key", (truth) => {
  it("reads the header as a person reads it", async () => {
    const { outcome } = await read(truth);
    expect(outcome.kind).toBe("extracted");
    if (outcome.kind !== "extracted") return;
    expect(outcome.extraction.method).toBe(truth.method);
    if (truth.pageCount !== undefined) expect(outcome.extraction.pageCount).toBe(truth.pageCount);
    for (const [field, value] of Object.entries(truth.header!)) {
      expect(outcome.extraction.header[field as keyof typeof outcome.extraction.header], `${truth.key}.${field}`).toEqual(value);
    }
  });

  it("reads every transaction — references exactly as printed, unreadable values left unresolved", async () => {
    const { outcome } = await read(truth);
    if (outcome.kind !== "extracted") throw new Error("not extracted");
    const transactions = outcome.extraction.lines.filter((l) => !l.isExcluded);
    expect(transactions.length, `${truth.key}: transaction count`).toBe(truth.transactions!.length);
    truth.transactions!.forEach((expected, i) => {
      const line = transactions[i] as ExtractedStatementLine;
      const at = `${truth.key} transaction ${i + 1}`;
      expect(line.pageNumber, `${at} page`).toBe(expected.page);
      expect(line.transactionDate, `${at} date`).toBe(expected.date);
      expect(line.referenceText, `${at} reference`).toBe(expected.reference);
      expect(line.debit, `${at} debit`).toBe(expected.debit);
      expect(line.credit, `${at} credit`).toBe(expected.credit);
      expect(line.runningBalance, `${at} balance`).toBe(expected.balance);
      expect(line.transactionType, `${at} type`).toBe(expected.type);
      if (expected.typeSource) expect(line.typeSource, `${at} type source`).toBe(expected.typeSource);
      expect([...line.unresolvedFields].sort(), `${at} unresolved`).toEqual([...expected.unresolved].sort());
      for (const part of expected.descriptionIncludes ?? []) expect(line.description ?? "", `${at} description`).toContain(part);
      for (const part of expected.rawIncludes ?? []) expect(line.rawText, `${at} raw text kept`).toContain(part);
    });
  });

  it("keeps brought/carried-forward, totals and the closing balance as excluded rows", async () => {
    const { outcome } = await read(truth);
    if (outcome.kind !== "extracted") throw new Error("not extracted");
    const excluded = outcome.extraction.lines.filter((l) => l.isExcluded);
    expect(excluded.map((l) => l.exclusionReason), `${truth.key}: excluded rows`).toEqual(truth.excluded!.map((e) => e.reason));
    truth.excluded!.forEach((expected, i) => {
      expect(excluded[i].pageNumber, `${truth.key} excluded ${i + 1} page`).toBe(expected.page);
      if ("value" in expected) expect(excluded[i].runningBalance, `${truth.key} excluded ${i + 1} value`).toBe(expected.value);
    });
  });

  it("validates arithmetically as the answer key says", async () => {
    const { outcome } = await read(truth);
    if (outcome.kind !== "extracted") throw new Error("not extracted");
    const report = validateStatement(validationInput(outcome.extraction, "debit-increases-owed"));
    expect(report.status, `${truth.key}: ${JSON.stringify(report.findings.map((f) => f.message))}`).toBe(truth.validation!.status);
    expect([...new Set(report.findings.map((f) => f.code))].sort()).toEqual([...truth.validation!.codes].sort());

    if (truth.validation!.firstBreak) {
      const fb = truth.validation!.firstBreak;
      const transactions = outcome.extraction.lines.filter((l) => !l.isExcluded);
      const finding = report.findings.find((f) => f.code === "running-balance-break" && f.lineOrder !== undefined)!;
      expect(finding.lineOrder).toBe(transactions[fb.transactionIndex].lineOrder);
      expect(finding.expectedCents).toBe(Math.round(fb.expected * 100));
      expect(finding.actualCents).toBe(Math.round(fb.printed * 100));
    }
    if (truth.validation!.closingDifference !== undefined) {
      const mismatch = report.findings.find((f) => f.code === "balance-mismatch")!;
      expect(mismatch.differenceCents).toBe(Math.round(truth.validation!.closingDifference * 100));
    }
    if (truth.withCreditIncreasesOwed) {
      const flipped = validateStatement(validationInput(outcome.extraction, "credit-increases-owed"));
      expect(flipped.status).toBe(truth.withCreditIncreasesOwed.status);
    }
  });
});
