/**
 * @vitest-environment node
 *
 * SD-3F — the supplier-statement AI boundary: the switch, the second key
 * lock, the text-only transcription contract, and the deterministic reading
 * of a transcription. No test here contacts a provider: `generateObject` is
 * mocked and the global fetch is a spy that fails the test if called.
 */
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { generateObjectMock } = vi.hoisted(() => ({ generateObjectMock: vi.fn() }));
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateObject: generateObjectMock };
});

import {
  decideStatementProvider,
  parseStatementTranscription,
  selectStatementProvider,
  STATEMENT_TRANSCRIPTION_INSTRUCTION,
  UnavailableStatementProvider,
  type StatementTranscription,
  type TranscribedRow,
} from "./statement-ai-provider";
import { createGatewayStatementProvider, STATEMENT_TRANSCRIPTION_SCHEMA } from "./gateway-statement-provider";
import { transcriptionToExtraction } from "./transcription-to-extraction";

const ORIGINAL_KEY = process.env.AI_GATEWAY_API_KEY;
const fetchSpy = vi.fn(() => {
  throw new Error("No network call may be made in this test.");
});
const realFetch = globalThis.fetch;

beforeEach(() => {
  generateObjectMock.mockReset();
  fetchSpy.mockClear();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  if (ORIGINAL_KEY === undefined) delete process.env.AI_GATEWAY_API_KEY;
  else process.env.AI_GATEWAY_API_KEY = ORIGINAL_KEY;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

function row(partial: Partial<TranscribedRow>): TranscribedRow {
  return {
    page: 1, dateText: null, referenceText: null, description: null, typeText: null, debitText: null,
    creditText: null, amountText: null, balanceText: null, rowText: "", ...partial,
  };
}

function transcription(partial: Partial<StatementTranscription> = {}): StatementTranscription {
  return {
    supplierName: "Karoo Building Supplies (Pty) Ltd",
    supplierVatNumber: "4123456789",
    supplierRegistrationNumber: null,
    accountNumber: "000123",
    statementDateText: "30/09/2026",
    periodText: null,
    currencyText: null,
    openingBalanceText: null,
    closingBalanceText: null,
    rows: [
      row({ dateText: "01/09/2026", referenceText: "BAL B/F", description: "Balance brought forward", balanceText: "1 500.00", rowText: "01/09/2026 Balance brought forward 1 500.00" }),
      row({ dateText: "05/09/2026", referenceText: "0001042", description: "Invoice", typeText: "INV", debitText: "2 300.00", balanceText: "3 800.00", rowText: "05/09/2026 0001042 Invoice 2 300.00 3 800.00" }),
      row({ page: 2, dateText: "12/09/2026", referenceText: "PMT 2026-09", description: "Payment received", typeText: "PMT", creditText: "1 000.00", balanceText: "2 800.00", rowText: "12/09/2026 PMT 2026-09 Payment 1 000.00 2 800.00" }),
      row({ page: 2, description: "Closing balance", balanceText: "2 800.00", rowText: "Closing balance 2 800.00" }),
    ],
    declaredTransactionRows: 2,
    warnings: [],
    ...partial,
  };
}

describe("the switch (OFF unless certified)", () => {
  it.each([
    [{}, "unavailable", false],
    [{ AI_GATEWAY_API_KEY: "k" }, "unavailable", false],
    [{ VYRON_AI_STATEMENT_EXTRACTION: "on", AI_GATEWAY_API_KEY: "k" }, "unavailable", false],
    [{ VYRON_AI_STATEMENT_EXTRACTION: "true", AI_GATEWAY_API_KEY: "k" }, "unavailable", false],
    [{ VYRON_AI_INVOICE_EXTRACTION: "certification", AI_GATEWAY_API_KEY: "k" }, "unavailable", false],
    [{ VYRON_AI_STATEMENT_EXTRACTION: "certification" }, "unavailable", true],
    [{ VYRON_AI_STATEMENT_EXTRACTION: "certification", AI_GATEWAY_API_KEY: "   " }, "unavailable", true],
    [{ VYRON_AI_STATEMENT_EXTRACTION: " Certification ", AI_GATEWAY_API_KEY: "k" }, "gateway", true],
  ])("%o → %s", (env, provider, switchOn) => {
    const decision = decideStatementProvider(env);
    expect(decision.provider).toBe(provider);
    expect(decision.switchOn).toBe(switchOn);
    if (provider === "unavailable") expect(decision.reason).toMatch(/by hand/);
  });

  it("the invoice switch does not turn statements on (separate switches)", () => {
    expect(decideStatementProvider({ VYRON_AI_INVOICE_EXTRACTION: "certification", AI_GATEWAY_API_KEY: "k" }).provider).toBe("unavailable");
  });

  it("with the switch off, the selected provider is the unavailable one and sends nothing", async () => {
    const provider = await selectStatementProvider({});
    expect(provider.name).toBe("unavailable");
    const result = await provider.transcribe({ bytes: PDF, mimeType: "application/pdf", pageCount: 1 });
    expect(result).toMatchObject({ ok: false, category: "missing-api-key", model: null });
    expect(generateObjectMock).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("UnavailableStatementProvider never succeeds", async () => {
    const result = await new UnavailableStatementProvider().transcribe();
    expect(result.ok).toBe(false);
  });
});

describe("the gateway adapter (never reached in tests)", () => {
  it("second key lock: without the configured key, no request is made", async () => {
    delete process.env.AI_GATEWAY_API_KEY;
    const result = await createGatewayStatementProvider().transcribe({ bytes: PDF, mimeType: "application/pdf", pageCount: 1 });
    expect(result).toMatchObject({ ok: false, category: "missing-api-key", model: null });
    expect(generateObjectMock).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("with a key, it asks for a TEXT transcription at temperature 0 and validates the answer", async () => {
    process.env.AI_GATEWAY_API_KEY = "test-only-not-a-real-key";
    generateObjectMock.mockResolvedValue({ object: transcription(), usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } });
    const result = await createGatewayStatementProvider().transcribe({ bytes: PDF, mimeType: "application/pdf", pageCount: 2 });
    expect(result.ok).toBe(true);
    const call = generateObjectMock.mock.calls[0][0];
    expect(call.temperature).toBe(0);
    expect(call.instructions).toBe(STATEMENT_TRANSCRIPTION_INSTRUCTION);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a malformed answer is a typed failure, never a partial value", async () => {
    process.env.AI_GATEWAY_API_KEY = "test-only-not-a-real-key";
    generateObjectMock.mockResolvedValue({ object: { ...transcription(), rows: [{ ...row({}), debitText: 2300 }] }, usage: null });
    const result = await createGatewayStatementProvider().transcribe({ bytes: PDF, mimeType: "application/pdf", pageCount: 1 });
    expect(result).toMatchObject({ ok: false, category: "malformed-response" });
  });

  it("a thrown provider error is classified, not rethrown", async () => {
    process.env.AI_GATEWAY_API_KEY = "test-only-not-a-real-key";
    generateObjectMock.mockRejectedValue(Object.assign(new Error("Payment Required"), { statusCode: 402 }));
    const result = await createGatewayStatementProvider().transcribe({ bytes: PDF, mimeType: "application/pdf", pageCount: 1 });
    expect(result.ok).toBe(false);
  });

  it("the schema has no number field a model could calculate into (only page and the declared count)", () => {
    const rowProps = (STATEMENT_TRANSCRIPTION_SCHEMA.properties!.rows as { items: { properties: Record<string, { type: unknown }> } }).items.properties;
    for (const [key, prop] of Object.entries(rowProps)) {
      if (key === "page") continue;
      expect(JSON.stringify(prop.type), key).not.toMatch(/number|integer/);
    }
    const top = STATEMENT_TRANSCRIPTION_SCHEMA.properties as Record<string, { type?: unknown }>;
    for (const [key, prop] of Object.entries(top)) {
      if (key === "declaredTransactionRows" || key === "rows" || key === "warnings") continue;
      expect(JSON.stringify(prop.type), key).not.toMatch(/number|integer/);
    }
  });
});

describe("parseStatementTranscription (text only)", () => {
  it("accepts a well-formed transcription", () => {
    expect(parseStatementTranscription(transcription())).not.toBeNull();
  });

  it.each([
    ["an amount given as a number", { rows: [{ ...row({}), debitText: 100 }] }],
    ["a balance given as a number", { closingBalanceText: 2800 }],
    ["a page outside 1–60", { rows: [{ ...row({}), page: 61 }] }],
    ["a missing rowText", { rows: [{ ...row({}), rowText: undefined }] }],
    ["a negative declared count", { declaredTransactionRows: -1 }],
    ["a fractional declared count", { declaredTransactionRows: 1.5 }],
    ["rows that are not a list", { rows: "x" }],
  ])("refuses %s", (_label, change) => {
    expect(parseStatementTranscription({ ...transcription(), ...change })).toBeNull();
  });

  it("refuses non-objects", () => {
    expect(parseStatementTranscription(null)).toBeNull();
    expect(parseStatementTranscription("text")).toBeNull();
  });
});

describe("transcriptionToExtraction (the deterministic reader's own rules)", () => {
  it("reads values through the parsers, keeps references exactly, and excludes balance rows", () => {
    const extraction = transcriptionToExtraction(transcription(), 2);
    const transactions = extraction.lines.filter((l) => !l.isExcluded);
    expect(transactions.map((l) => l.referenceText)).toEqual(["0001042", "PMT 2026-09"]);
    expect(transactions.map((l) => [l.debit, l.credit])).toEqual([[2300, null], [null, 1000]]);
    expect(transactions.map((l) => l.transactionDate)).toEqual(["2026-09-05", "2026-09-12"]);
    expect(extraction.header.openingBalance).toBe(1500);
    expect(extraction.header.closingBalance).toBe(2800);
    expect(extraction.header.statementDate).toBe("2026-09-30");
    expect(extraction.header.accountNumber).toBe("000123");
  });

  it("keeps page provenance and the row as transcribed", () => {
    const extraction = transcriptionToExtraction(transcription(), 2);
    const payment = extraction.lines.find((l) => l.referenceText === "PMT 2026-09")!;
    expect(payment.pageNumber).toBe(2);
    expect(payment.rawText).toBe("12/09/2026 PMT 2026-09 Payment 1 000.00 2 800.00");
    const invoice = extraction.lines.find((l) => l.referenceText === "0001042")!;
    expect(invoice.pageNumber).toBe(1);
  });

  it("an unreadable amount stays UNRESOLVED — never guessed", () => {
    const t = transcription({
      rows: [row({ dateText: "05/09/2026", referenceText: "0001042", debitText: "2 3?0.00", rowText: "05/09/2026 0001042 2 3?0.00" })],
      declaredTransactionRows: 1,
    });
    const line = transcriptionToExtraction(t, 1).lines.find((l) => l.referenceText === "0001042")!;
    expect(line.debit).toBeNull();
    expect(line.unresolvedFields).toContain("debit");
  });

  it("an ambiguous date stays unresolved", () => {
    const t = transcription({ rows: [row({ dateText: "32/13/2026", referenceText: "INV9", debitText: "10.00", rowText: "x" })], declaredTransactionRows: 1 });
    const line = transcriptionToExtraction(t, 1).lines.find((l) => l.referenceText === "INV9")!;
    expect(line.transactionDate).toBeNull();
    expect(line.unresolvedFields).toContain("transaction_date");
  });

  it("an unreadable transcribed closing balance is not used, and says so", () => {
    const t = transcription({ rows: [row({ dateText: "05/09/2026", referenceText: "A1", debitText: "10.00", rowText: "x" })], closingBalanceText: "about 2,8k" });
    const extraction = transcriptionToExtraction(t, 1);
    expect(extraction.header.closingBalance).toBeNull();
    expect(extraction.warnings.join(" ")).toMatch(/closing balance could not be read/);
  });

  it("marks the reading as AI and passes on the provider's notes as notes", () => {
    const extraction = transcriptionToExtraction(transcription({ warnings: ["Page 2 is faint"] }), 2);
    expect(extraction.warnings[0]).toMatch(/Read by AI/);
    expect(extraction.warnings).toContain("AI note: Page 2 is faint");
  });

  it("never decides the supplier: only the transcribed name is carried, for the matcher to PROPOSE", () => {
    const extraction = transcriptionToExtraction(transcription(), 1);
    expect(extraction.header).not.toHaveProperty("supplierId");
    expect(extraction.header.supplierName).toBe("Karoo Building Supplies (Pty) Ltd");
  });
});

describe("boundary of the AI modules", () => {
  it("import no accounting, reconciliation or ledger module", () => {
    for (const path of ["statement-ai-provider.ts", "gateway-statement-provider.ts", "transcription-to-extraction.ts"]) {
      const source = readFileSync(`src/server/supplier-statements/ai/${path}`, "utf8");
      const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
      for (const spec of imports) {
        expect(spec, `${path} imports ${spec}`).not.toMatch(/purchase-bill|posting|journal|supplier-payment|allocation|party-ledger|reconciliation|repositor|supabase/);
      }
    }
  });
});
