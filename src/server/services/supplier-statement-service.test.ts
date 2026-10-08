/**
 * @vitest-environment node
 *
 * SD-3C — the supplier statement workflow (repository mocked; the pure
 * modules — reader, validation, supplier proposal — are the real ones).
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
  insertStatement: vi.fn(),
  recordStatementEvent: vi.fn(),
  findStatementsWithSameFile: vi.fn(),
  updateStatementAsSystem: vi.fn(),
  recordSystemStatementEvent: vi.fn(),
  claimQueuedStatement: vi.fn(),
  getDocumentForProcessing: vi.fn(),
  listSuppliersForMatching: vi.fn(),
  replaceLinesAsSystem: vi.fn(),
  getStatementAsSystem: vi.fn(),
  listStatementLinesAsSystem: vi.fn(),
  getCompanyBaseCurrency: vi.fn(),
  findSimilarStatement: vi.fn(),
  updateStatementAsSystemIfUnchanged: vi.fn(),
  getStatement: vi.fn(),
  updateStatementAsReviewer: vi.fn(),
  updateLineAsReviewer: vi.fn(),
  addLinesAsReviewer: vi.fn(),
  removeLineAsReviewer: vi.fn(),
  requeueStaleProcessing: vi.fn(),
  listStatements: vi.fn(),
  listStatementLines: vi.fn(),
  listStatementEvents: vi.fn(),
  statementAiGate: vi.fn(),
  recordStatementAiAttempt: vi.fn(),
}));
const { readSupplierOriginalBytes, setSupplierOurAccountNumber, recordSupplierDocumentAccess, recon } = vi.hoisted(() => ({
  readSupplierOriginalBytes: vi.fn(),
  setSupplierOurAccountNumber: vi.fn(),
  recordSupplierDocumentAccess: vi.fn(),
  recon: { listRuns: vi.fn(), listResolutionsAsSystem: vi.fn() },
}));

vi.mock("@/server/repositories/supplier-statement-repository", () => repo);
vi.mock("@/server/repositories/supplier-document-access-repository", () => ({
  readSupplierOriginalBytes: (...a: unknown[]) => readSupplierOriginalBytes(...a),
  recordSupplierDocumentAccess: (...a: unknown[]) => recordSupplierDocumentAccess(...a),
}));
vi.mock("@/server/repositories/supplier-statement-reconciliation-repository", () => recon);
vi.mock("@/server/services/supplier-management-service", () => ({ setSupplierOurAccountNumber: (...a: unknown[]) => setSupplierOurAccountNumber(...a) }));
vi.mock("@/server/auth/require-session", () => ({ getPerformedByLabel: async () => "reviewer@synthetic.test" }));

import * as service from "./supplier-statement-service";

const CO = "co_1";
const file = (name: string) => new Uint8Array(readFileSync(`statement-corpus/documents/${name}`));

function statementRow(over: Record<string, unknown> = {}) {
  return {
    id: 7, company_id: CO, document_id: 70, content_sha256: "a".repeat(64), source_type: "pdf", extraction_method: null, status: "NeedsReview",
    status_reason: "", duplicate_of_statement_id: null, supplier_id: 1, supplier_match_tier: "vat", supplier_candidates: [],
    supplier_confirmed_by: null, supplier_confirmed_at: null, supplier_name_extracted: null, supplier_vat_extracted: null,
    supplier_registration_extracted: null, account_number_extracted: "000123", statement_date: "2026-09-30", period_from: null, period_to: null,
    currency_code: null, opening_balance: "100.00", closing_balance: "100.00", printed_total_debits: null, printed_total_credits: null,
    printed_ageing: null, sign_convention: "debit-increases-owed", page_count: 1, validation_status: "Pass", validation_findings: [],
    validated_at: null, extraction_snapshot: null, warnings: [], manual_entry: false, uploaded_by: "u", created_at: "t", updated_at: "u1",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  repo.insertStatement.mockResolvedValue(statementRow({ status: "Queued" }));
  repo.findStatementsWithSameFile.mockResolvedValue([]);
  repo.listSuppliersForMatching.mockResolvedValue({
    suppliers: [{ id: 1, name: "Karoo Building Supplies (Pty) Ltd", vatNumber: "4123456789", registrationNumber: "", supplierCode: "", alternativeNames: [], status: "Active" }],
    accountNumbers: new Map([[1, "000123"]]),
  });
  repo.getCompanyBaseCurrency.mockResolvedValue("ZAR");
  repo.findSimilarStatement.mockResolvedValue(null);
  repo.updateStatementAsSystemIfUnchanged.mockResolvedValue(true);
  repo.listStatementLinesAsSystem.mockResolvedValue([]);
});

describe("upload → queue", () => {
  it("registers a new statement as Queued and does NOT read the file in the request", async () => {
    const result = await service.registerUploadedStatement(CO, 70, "a".repeat(64), "pdf");
    expect(result).toMatchObject({ statementId: 7, status: "Queued" });
    expect(repo.recordStatementEvent).toHaveBeenCalledWith(CO, 7, "Uploaded", { documentId: 70, sourceType: "pdf" });
    expect(readSupplierOriginalBytes).not.toHaveBeenCalled();
  });

  it("the same file as a live statement is a Duplicate — never processed", async () => {
    repo.findStatementsWithSameFile.mockResolvedValue([{ id: 3, status: "NeedsReview" }]);
    const result = await service.registerUploadedStatement(CO, 70, "a".repeat(64), "pdf");
    expect(result).toMatchObject({ status: "Duplicate", duplicateOfStatementId: 3 });
    expect(repo.updateStatementAsSystem).toHaveBeenCalledWith(CO, 7, expect.objectContaining({ status: "Duplicate", duplicate_of_statement_id: 3 }));
  });

  it("a REJECTED copy does not block a re-upload, but is recorded", async () => {
    repo.findStatementsWithSameFile.mockResolvedValue([{ id: 3, status: "Rejected" }]);
    const result = await service.registerUploadedStatement(CO, 70, "a".repeat(64), "pdf");
    expect(result.status).toBe("Queued");
    expect(repo.recordSystemStatementEvent).toHaveBeenCalledWith(CO, 7, "DuplicateEvaluated", { layer: "file-hash", rejectedStatementId: 3 }, expect.any(String));
  });
});

describe("processing (after the response)", () => {
  it("does nothing unless it can claim the statement from Queued (one processor only)", async () => {
    repo.claimQueuedStatement.mockResolvedValue(null);
    expect(await service.processStatement(CO, 7, "System")).toBe("NotQueued");
    expect(readSupplierOriginalBytes).not.toHaveBeenCalled();
  });

  it("a text PDF is read, its supplier PROPOSED (never confirmed), and validated", async () => {
    repo.claimQueuedStatement.mockResolvedValue(statementRow({ status: "Processing" }));
    repo.getDocumentForProcessing.mockResolvedValue({ storagePath: "co_1/Supplier/0/k.pdf", filename: "karoo-point.pdf", mimeType: "application/pdf" });
    readSupplierOriginalBytes.mockResolvedValue(file("karoo-point.pdf"));
    repo.getStatementAsSystem.mockResolvedValue(statementRow({ status: "NeedsReview", opening_balance: "1500", closing_balance: "4260.06" }));

    expect(await service.processStatement(CO, 7, "System")).toBe("NeedsReview");

    const lines = repo.replaceLinesAsSystem.mock.calls[0][2] as { reference_text: string | null; is_excluded: boolean }[];
    expect(lines.filter((l) => !l.is_excluded).map((l) => l.reference_text)).toEqual(["0001042", "0001057", "PMT 2026-09", "CN000311", "0001093"]);
    const header = repo.updateStatementAsSystem.mock.calls.find((c) => c[2].status === "NeedsReview")![2];
    expect(header).toMatchObject({ supplier_id: 1, supplier_match_tier: "vat", account_number_extracted: "000123", source_type: "pdf-text", extraction_method: "layout" });
    expect(header).not.toHaveProperty("supplier_confirmed_at");
    expect(header).not.toHaveProperty("supplier_confirmed_by");
    expect(header.extraction_snapshot).toBeTruthy();
    expect(repo.updateStatementAsSystemIfUnchanged).toHaveBeenCalled();
  });

  it("a scanned PDF goes to manual entry while automatic reading is off — nothing is guessed", async () => {
    repo.claimQueuedStatement.mockResolvedValue(statementRow({ status: "Processing" }));
    repo.getDocumentForProcessing.mockResolvedValue({ storagePath: "p", filename: "scanned.pdf", mimeType: "application/pdf" });
    readSupplierOriginalBytes.mockResolvedValue(file("scanned.pdf"));
    expect(await service.processStatement(CO, 7, "System", { env: {} })).toBe("ManualEntry");
    expect(repo.updateStatementAsSystem).toHaveBeenCalledWith(CO, 7, expect.objectContaining({ status: "ManualEntry", source_type: "pdf-scanned", manual_entry: true }));
    expect(repo.replaceLinesAsSystem).not.toHaveBeenCalled();
    expect(repo.recordSystemStatementEvent).toHaveBeenCalledWith(CO, 7, "AiExtractionSkipped", { switchOn: false, credentialPresent: false }, "System");
    expect(repo.statementAiGate).not.toHaveBeenCalled();
    expect(repo.recordStatementAiAttempt).not.toHaveBeenCalled();
  });

  it("an image statement goes to manual entry", async () => {
    repo.claimQueuedStatement.mockResolvedValue(statementRow({ status: "Processing" }));
    repo.getDocumentForProcessing.mockResolvedValue({ storagePath: "p", filename: "scan-png.png", mimeType: "image/png" });
    readSupplierOriginalBytes.mockResolvedValue(file("scan-png.png"));
    expect(await service.processStatement(CO, 7, "System", { env: {} })).toBe("ManualEntry");
  });

  it("an encrypted PDF fails with the reason, and the original is still kept", async () => {
    repo.claimQueuedStatement.mockResolvedValue(statementRow({ status: "Processing" }));
    repo.getDocumentForProcessing.mockResolvedValue({ storagePath: "p", filename: "encrypted.pdf", mimeType: "application/pdf" });
    readSupplierOriginalBytes.mockResolvedValue(file("encrypted.pdf"));
    expect(await service.processStatement(CO, 7, "System")).toBe("Failed");
    const failed = repo.updateStatementAsSystem.mock.calls.find((c) => c[2].status === "Failed")![2];
    expect(failed.status_reason).toMatch(/password/i);
  });

  it("an unexpected error fails the statement with a generic message (no internals in the audit)", async () => {
    repo.claimQueuedStatement.mockResolvedValue(statementRow({ status: "Processing" }));
    repo.getDocumentForProcessing.mockRejectedValue(new Error("connection string postgres://secret"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await service.processStatement(CO, 7, "System")).toBe("Failed");
    const events = JSON.stringify(repo.recordSystemStatementEvent.mock.calls);
    const updates = JSON.stringify(repo.updateStatementAsSystem.mock.calls);
    expect(events + updates).not.toContain("secret");
    expect(JSON.stringify(error.mock.calls)).not.toContain("secret");
    error.mockRestore();
  });
});

describe("reviewer actions", () => {
  it("confirming a supplier is explicit and recorded; saving the account number is a separate, audited supplier edit", async () => {
    repo.getStatement.mockResolvedValue(statementRow({ supplier_id: 1 }));
    await service.confirmStatementSupplier(CO, 7, 1, { saveAccountNumber: true });
    expect(repo.updateStatementAsReviewer).toHaveBeenCalledWith(CO, 7, { supplier_id: 1, supplier_confirmed_at: expect.any(String) });
    expect(repo.recordStatementEvent).toHaveBeenCalledWith(CO, 7, "SupplierConfirmed", expect.objectContaining({ supplierId: 1 }));
    expect(setSupplierOurAccountNumber).toHaveBeenCalledWith(CO, 1, "000123", "reviewer@synthetic.test", "Saved from supplier statement #7.");
  });

  it("cannot mark ready without a confirmed supplier, even when it validates", async () => {
    repo.getStatement.mockResolvedValue(statementRow({ supplier_id: 1, supplier_confirmed_at: null, validation_status: "Pass" }));
    await expect(service.markStatementReady(CO, 7)).rejects.toThrow(/Confirm the supplier/);
    expect(repo.updateStatementAsReviewer).not.toHaveBeenCalled();
  });

  it("cannot mark ready when it does not add up", async () => {
    repo.getStatement.mockResolvedValue(statementRow({ supplier_confirmed_at: "t", validation_status: "Incomplete" }));
    await expect(service.markStatementReady(CO, 7)).rejects.toThrow(/add up/);
  });

  it("line corrections keep references exactly as typed (leading zeros) and refuse negative columns", async () => {
    repo.getStatement.mockResolvedValue(statementRow());
    repo.getStatementAsSystem.mockResolvedValue(statementRow());
    await service.correctStatementLines(CO, 7, { update: [{ lineId: 5, referenceText: " 0000781 ", debit: "120.50" }], add: [{ referenceText: "00099", credit: 10 }] });
    expect(repo.updateLineAsReviewer).toHaveBeenCalledWith(CO, 7, 5, { reference_text: "0000781", debit: 120.5 });
    expect(repo.addLinesAsReviewer).toHaveBeenCalledWith(CO, 7, [{ reference_text: "00099", credit: 10 }]);
    await expect(service.correctStatementLines(CO, 7, { update: [{ lineId: 5, debit: -1 }] })).rejects.toThrow(/negative/);
  });

  it("corrections are refused once the statement is ready or rejected", async () => {
    repo.getStatement.mockResolvedValue(statementRow({ status: "Ready" }));
    await expect(service.correctStatementHeader(CO, 7, { closingBalance: 1 })).rejects.toThrow(/cannot be changed/);
  });

  it("a rejection needs a reason, which is recorded", async () => {
    repo.getStatement.mockResolvedValue(statementRow());
    await expect(service.rejectStatement(CO, 7, " ")).rejects.toThrow(/reason/);
    await service.rejectStatement(CO, 7, "Not our account");
    expect(repo.recordStatementEvent).toHaveBeenCalledWith(CO, 7, "Rejected", { reason: "Not our account", from: "NeedsReview" });
  });

  it("manual entry only from Queued or Failed", async () => {
    repo.getStatement.mockResolvedValue(statementRow({ status: "NeedsReview" }));
    await expect(service.startStatementManualEntry(CO, 7)).rejects.toThrow(/entered by hand/);
    repo.getStatement.mockResolvedValue(statementRow({ status: "Failed" }));
    await service.startStatementManualEntry(CO, 7);
    expect(repo.updateStatementAsReviewer).toHaveBeenCalledWith(CO, 7, { status: "ManualEntry" });
  });
});

describe("boundaries", () => {
  it("the statement workflow imports no accounting module, reaches AI only through the SD-3F boundary, and touches only its own tables", () => {
    const files = [
      "src/server/services/supplier-statement-service.ts",
      "src/server/repositories/supplier-statement-repository.ts",
      ...["amounts", "layout", "tabular", "validation", "supplier-match", "read-statement", "file-type", "types"].map((m) => `src/server/supplier-statements/${m}.ts`),
    ];
    const allowedTables = new Set(["supplier_statements", "supplier_statement_lines", "supplier_statement_events", "documents", "companies", "ae_suppliers"]);
    for (const path of files) {
      const source = readFileSync(path, "utf8");
      const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
      for (const spec of imports) {
        expect(spec, `${path} imports ${spec}`).not.toMatch(/purchase-bill|posting|journal|supplier-payment|allocation|party-ledger|report-centre|provider-selection|gateway/);
        // AI only through the statement boundary (and the shared, pure error taxonomy).
        if (/\/ai\/|extraction-provider/.test(spec)) {
          expect(spec, `${path} imports ${spec}`).toMatch(/^@\/server\/supplier-statements\/ai\/|^@\/server\/supplier-invoice-capture\/extraction-provider$/);
        }
      }
      const tables = [...source.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
      for (const table of tables) expect(allowedTables.has(table), `${path} touches ${table}`).toBe(true);
      expect(source, path).not.toMatch(/generateObject|AI_GATEWAY_API_KEY|VYRON_AI_|fetch\(/);
    }
  });
});

// ---------------------------------------------------------------------
// SD-3F — the AI boundary inside processing (fake provider; never a real one)
// ---------------------------------------------------------------------

describe("SD-3F — AI reading of scanned statements", () => {
  const ON = { VYRON_AI_STATEMENT_EXTRACTION: "certification", AI_GATEWAY_API_KEY: "test-only-not-a-real-key" };
  const realFetch = globalThis.fetch;
  const fetchSpy = vi.fn(() => {
    throw new Error("No network call may be made in this test.");
  });

  const transcription = {
    supplierName: "Karoo Building Supplies (Pty) Ltd", supplierVatNumber: "4123456789", supplierRegistrationNumber: null, accountNumber: "000123",
    statementDateText: "30/09/2026", periodText: null, currencyText: null, openingBalanceText: null, closingBalanceText: null,
    rows: [
      { page: 1, dateText: "01/09/2026", referenceText: "BAL B/F", description: "Balance brought forward", typeText: null, debitText: null, creditText: null, amountText: null, balanceText: "1 500.00", rowText: "B/F 1 500.00" },
      { page: 1, dateText: "05/09/2026", referenceText: "0001042", description: "Invoice", typeText: "INV", debitText: "2 300.00", creditText: null, amountText: null, balanceText: "3 800.00", rowText: "0001042 2 300.00" },
    ],
    declaredTransactionRows: 1,
    warnings: [],
  };
  const fakeProvider = (result: unknown) => ({ name: "test" as const, transcribe: vi.fn(async () => result as never) });
  const aiLine = { line_order: 2, page_number: 1, transaction_date: "2026-09-05", reference_text: "0001042", debit: "2300", credit: null, running_balance: "3800", unresolved_fields: [], is_excluded: false, exclusion_reason: null };

  function scanned() {
    repo.claimQueuedStatement.mockResolvedValue(statementRow({ status: "Processing", source_type: "pdf" }));
    repo.getDocumentForProcessing.mockResolvedValue({ storagePath: "p", filename: "scanned.pdf", mimeType: "application/pdf" });
    readSupplierOriginalBytes.mockResolvedValue(file("scanned.pdf"));
  }

  beforeEach(() => {
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    fetchSpy.mockClear();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("switch on but no key → skipped: no gate, no reservation, provider never called", async () => {
    scanned();
    const provider = fakeProvider({ ok: true, transcription, model: "m", usage: null });
    expect(await service.processStatement(CO, 7, "System", { env: { VYRON_AI_STATEMENT_EXTRACTION: "certification" }, provider })).toBe("ManualEntry");
    expect(repo.recordSystemStatementEvent).toHaveBeenCalledWith(CO, 7, "AiExtractionSkipped", { switchOn: true, credentialPresent: false }, "System");
    expect(repo.statementAiGate).not.toHaveBeenCalled();
    expect(provider.transcribe).not.toHaveBeenCalled();
    expect(repo.updateStatementAsSystem).toHaveBeenCalledWith(CO, 7, expect.objectContaining({ status: "ManualEntry", status_reason: expect.stringMatching(/not configured/) }));
  });

  it("an injected provider is ignored while the switch is off", async () => {
    scanned();
    const provider = fakeProvider({ ok: true, transcription, model: "m", usage: null });
    expect(await service.processStatement(CO, 7, "System", { env: {}, provider })).toBe("ManualEntry");
    expect(provider.transcribe).not.toHaveBeenCalled();
    expect(repo.statementAiGate).not.toHaveBeenCalled();
  });

  it.each([
    ["circuit_open", /paused after repeated provider failures/],
    ["daily_cap", /budget is used up/],
    ["not_processing", /not attempted/],
  ])("gate refuses (%s) → manual entry, nothing sent, no attempt recorded", async (decision, reason) => {
    scanned();
    repo.statementAiGate.mockResolvedValue({ decision });
    const provider = fakeProvider({ ok: true, transcription, model: "m", usage: null });
    expect(await service.processStatement(CO, 7, "System", { env: ON, provider })).toBe("ManualEntry");
    expect(provider.transcribe).not.toHaveBeenCalled();
    expect(repo.recordStatementAiAttempt).not.toHaveBeenCalled();
    expect(repo.recordSystemStatementEvent).toHaveBeenCalledWith(CO, 7, "AiExtractionRefused", { decision }, "System");
    expect(repo.updateStatementAsSystem).toHaveBeenCalledWith(CO, 7, expect.objectContaining({ status: "ManualEntry", status_reason: expect.stringMatching(reason) }));
    expect(repo.replaceLinesAsSystem).not.toHaveBeenCalled();
  });

  it.each([
    ["payment-required", 402, "auth", true, "provider_error"],
    ["unauthorized", 401, "auth", true, "provider_error"],
    ["timeout", null, "timeout", true, "provider_error"],
    ["server-error", 503, "provider_failure", true, "provider_error"],
    ["rate-limit", 429, "rate_limit", true, "provider_error"],
    ["missing-api-key", null, "auth", false, "provider_error"],
    ["malformed-response", null, "none", true, "invalid_response"],
  ])("provider fails (%s) → attempt recorded with the right circuit signal, manual entry", async (category, httpStatus, signal, reached, outcome) => {
    scanned();
    repo.statementAiGate.mockResolvedValue({ decision: "allow" });
    const provider = fakeProvider({ ok: false, category, httpStatus, message: "Bearer sk-secretABCDEFGHIJKLMNOP123 failed", model: "m" });
    expect(await service.processStatement(CO, 7, "System", { env: ON, provider })).toBe("ManualEntry");
    const attempt = repo.recordStatementAiAttempt.mock.calls[0][0];
    expect(attempt).toMatchObject({ outcome, providerRequestMade: reached, errorCategory: category, circuitSignal: signal, probe: false, httpStatus });
    expect(String(attempt.providerMessage)).not.toMatch(/sk-secretABCDEFGHIJKLMNOP123/);
    expect(repo.recordSystemStatementEvent).toHaveBeenCalledWith(CO, 7, "AiExtractionFailed", { category }, "System");
    expect(repo.replaceLinesAsSystem).not.toHaveBeenCalled();
    expect(repo.updateStatementAsSystem).toHaveBeenCalledWith(CO, 7, expect.objectContaining({ status: "ManualEntry", extraction_method: "manual" }));
  });

  it("a provider that throws is contained: recorded as an unknown failure, manual entry", async () => {
    scanned();
    repo.statementAiGate.mockResolvedValue({ decision: "allow" });
    const provider = {
      name: "test" as const,
      transcribe: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    expect(await service.processStatement(CO, 7, "System", { env: ON, provider })).toBe("ManualEntry");
    expect(repo.recordStatementAiAttempt.mock.calls[0][0]).toMatchObject({ outcome: "provider_error", errorCategory: "unknown", circuitSignal: "none" });
  });

  it("a probe is reported as a probe", async () => {
    scanned();
    repo.statementAiGate.mockResolvedValue({ decision: "probe" });
    const provider = fakeProvider({ ok: false, category: "server-error", httpStatus: 500, message: "x", model: "m" });
    await service.processStatement(CO, 7, "System", { env: ON, provider });
    expect(repo.recordStatementAiAttempt.mock.calls[0][0]).toMatchObject({ probe: true, circuitSignal: "provider_failure" });
  });

  it("a transcription is stored as AI-read evidence, validated, and the supplier is only PROPOSED", async () => {
    scanned();
    repo.statementAiGate.mockResolvedValue({ decision: "allow" });
    repo.getStatementAsSystem.mockResolvedValue(
      statementRow({ status: "NeedsReview", extraction_method: "ai", opening_balance: "1500", closing_balance: "3800", extraction_snapshot: { ai: { declaredTransactionRows: 1 } } }),
    );
    repo.listStatementLinesAsSystem.mockResolvedValue([aiLine]);
    const provider = fakeProvider({ ok: true, transcription, model: "test-model", usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 } });

    expect(await service.processStatement(CO, 7, "System", { env: ON, provider })).toBe("NeedsReview");

    expect(provider.transcribe).toHaveBeenCalledWith(expect.objectContaining({ mimeType: "application/pdf" }));
    const lines = repo.replaceLinesAsSystem.mock.calls[0][2] as { reference_text: string | null; extracted_by: string; debit: number | null; is_excluded: boolean }[];
    expect(lines.every((l) => l.extracted_by === "ai")).toBe(true);
    expect(lines.filter((l) => !l.is_excluded).map((l) => [l.reference_text, l.debit])).toEqual([["0001042", 2300]]);

    const header = repo.updateStatementAsSystem.mock.calls.find((c) => c[2].status === "NeedsReview")![2];
    expect(header).toMatchObject({ extraction_method: "ai", source_type: "pdf-scanned", supplier_id: 1 });
    expect(header).not.toHaveProperty("supplier_confirmed_at");
    expect(header.extraction_snapshot).toMatchObject({ method: "ai", ai: { model: "test-model", declaredTransactionRows: 1, provider: "vercel-ai-gateway" } });

    expect(repo.recordStatementAiAttempt.mock.calls[0][0]).toMatchObject({ outcome: "extracted", providerRequestMade: true, circuitSignal: "success", model: "test-model" });
    expect(repo.recordSystemStatementEvent).toHaveBeenCalledWith(CO, 7, "AiExtracted", expect.objectContaining({ method: "ai" }), "System");
    expect(repo.recordSystemStatementEvent).not.toHaveBeenCalledWith(CO, 7, "Extracted", expect.anything(), expect.anything());
    // Validated by the same deterministic rules (here: it adds up and the row count matches).
    expect(repo.updateStatementAsSystemIfUnchanged).toHaveBeenCalledWith(CO, 7, "u1", expect.objectContaining({ validation_status: "Pass" }));
  });

  it("validation compares the AI's declared row count with what was read (a truncated read is Incomplete)", async () => {
    repo.getStatementAsSystem.mockResolvedValue(
      statementRow({ status: "NeedsReview", extraction_method: "ai", opening_balance: "1500", closing_balance: "3800", extraction_snapshot: { ai: { declaredTransactionRows: 3 } } }),
    );
    repo.listStatementLinesAsSystem.mockResolvedValue([aiLine]);
    await service.revalidateStatement(CO, 7, "System");
    const written = repo.updateStatementAsSystemIfUnchanged.mock.calls[0][3];
    expect(written.validation_status).toBe("Incomplete");
    expect(written.validation_findings.map((f: { code: string }) => f.code)).toContain("row-count-mismatch");
  });

  it("a non-AI statement is never checked against an AI row count", async () => {
    repo.getStatementAsSystem.mockResolvedValue(
      statementRow({ status: "NeedsReview", extraction_method: "layout", opening_balance: "1500", closing_balance: "3800", extraction_snapshot: { ai: { declaredTransactionRows: 3 } } }),
    );
    repo.listStatementLinesAsSystem.mockResolvedValue([aiLine]);
    await service.revalidateStatement(CO, 7, "System");
    expect(repo.updateStatementAsSystemIfUnchanged.mock.calls[0][3].validation_status).toBe("Pass");
  });

  it("a write failure after a successful read is recorded as write_error and the statement fails safely", async () => {
    scanned();
    repo.statementAiGate.mockResolvedValue({ decision: "allow" });
    repo.replaceLinesAsSystem.mockRejectedValueOnce(new Error("db down"));
    const provider = fakeProvider({ ok: true, transcription, model: "m", usage: null });
    expect(await service.processStatement(CO, 7, "System", { env: ON, provider })).toBe("Failed");
    expect(repo.recordStatementAiAttempt.mock.calls[0][0]).toMatchObject({ outcome: "write_error", providerRequestMade: true });
  });

  it("text PDFs never go near the AI boundary, even with the switch on", async () => {
    repo.claimQueuedStatement.mockResolvedValue(statementRow({ status: "Processing" }));
    repo.getDocumentForProcessing.mockResolvedValue({ storagePath: "p", filename: "karoo-point.pdf", mimeType: "application/pdf" });
    readSupplierOriginalBytes.mockResolvedValue(file("karoo-point.pdf"));
    repo.getStatementAsSystem.mockResolvedValue(statementRow({ status: "NeedsReview" }));
    const provider = fakeProvider({ ok: true, transcription, model: "m", usage: null });
    await service.processStatement(CO, 7, "System", { env: ON, provider });
    expect(provider.transcribe).not.toHaveBeenCalled();
    expect(repo.statementAiGate).not.toHaveBeenCalled();
  });

  it("no network call is made on any path in this suite", () => {
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------
// SD-3G — reprocess: the retained original, read again by the current reader
// ---------------------------------------------------------------------

describe("SD-3G — reprocessing a statement", () => {
  const systemEvents = ["Uploaded", "ProcessingStarted", "Extracted", "SupplierProposed", "ValidationEvaluated"].map((t, i) => ({ id: i + 1, event_type: t }));
  const oldLines = [
    { id: 1, line_order: 1, is_excluded: false, unresolved_fields: ["credit"], corrected: false, extracted_by: "reader" },
    { id: 2, line_order: 2, is_excluded: false, unresolved_fields: [], corrected: false, extracted_by: "reader" },
    { id: 3, line_order: 3, is_excluded: true, unresolved_fields: [], corrected: false, extracted_by: "reader" },
  ];
  function ready(over: Record<string, unknown> = {}) {
    repo.getStatement.mockResolvedValue(statementRow({ status: "NeedsReview", extraction_method: "layout", validation_status: "Incomplete", document_id: 70, ...over }));
    repo.listStatementEvents.mockResolvedValue(systemEvents);
    repo.listStatementLinesAsSystem.mockResolvedValue(oldLines);
    recon.listRuns.mockResolvedValue([]);
    recon.listResolutionsAsSystem.mockResolvedValue([]);
    recordSupplierDocumentAccess.mockResolvedValue(901);
  }

  it("records an audited 'reprocess' access FIRST, keeps a summary of what it replaces, clears only derived data and queues the statement", async () => {
    ready();
    const order: string[] = [];
    recordSupplierDocumentAccess.mockImplementation(async () => { order.push("access"); return 901; });
    repo.recordSystemStatementEvent.mockImplementation(async () => { order.push("event"); });
    repo.replaceLinesAsSystem.mockImplementation(async () => { order.push("lines"); });
    repo.updateStatementAsSystem.mockImplementation(async () => { order.push("statement"); });

    expect(await service.reprocessStatement(CO, 7)).toBe("Queued");

    expect(order).toEqual(["access", "event", "lines", "statement"]);
    expect(recordSupplierDocumentAccess).toHaveBeenCalledWith({ companyId: CO, documentId: 70, subject: { kind: "statement", statementId: 7 }, action: "reprocess" });
    expect(repo.recordSystemStatementEvent).toHaveBeenCalledWith(CO, 7, "Reprocessed",
      { from: "NeedsReview", documentId: 70, previous: { method: "layout", transactions: 2, excludedRows: 1, unreadLines: 1, validationStatus: "Incomplete" } }, "reviewer@synthetic.test");
    expect(repo.replaceLinesAsSystem).toHaveBeenCalledWith(CO, 7, []);
    const reset = repo.updateStatementAsSystem.mock.calls[0][2];
    expect(reset).toMatchObject({ status: "Queued", supplier_id: null, statement_date: null, closing_balance: null, extraction_snapshot: null, validation_status: "Pending" });
    // Never the original document, never a new document, never confirmation fields.
    expect(reset).not.toHaveProperty("document_id");
    expect(reset).not.toHaveProperty("content_sha256");
    expect(reset).not.toHaveProperty("supplier_confirmed_at");
  });

  it("fail-closed: if the access cannot be recorded, nothing changes", async () => {
    ready();
    recordSupplierDocumentAccess.mockRejectedValue(Object.assign(new Error("Purchasing:Edit is required to reprocess a statement"), { code: "42501" }));
    await expect(service.reprocessStatement(CO, 7)).rejects.toThrow(/Purchasing:Edit/);
    expect(repo.recordSystemStatementEvent).not.toHaveBeenCalled();
    expect(repo.replaceLinesAsSystem).not.toHaveBeenCalled();
    expect(repo.updateStatementAsSystem).not.toHaveBeenCalled();
  });

  it.each([
    ["a reviewer's correction", { events: ["LineCorrected"] }, /worked on \(LineCorrected\)/],
    ["a header correction", { events: ["FieldCorrected"] }, /FieldCorrected/],
    ["manual entry by a person", { events: ["ManualEntryStarted"] }, /ManualEntryStarted/],
    ["a line added by a reviewer", { lines: [{ id: 9, line_order: 9, is_excluded: false, unresolved_fields: [], corrected: true, extracted_by: "reviewer" }] }, /1 corrected or added line/],
    ["a reconciliation run", { runs: [{ id: 1 }] }, /1 reconciliation run/],
    ["a reconciliation decision", { resolutions: [{ id: 1 }] }, /1 reconciliation decision/],
  ])("REFUSES (never overwrites) when there is %s", async (_label, over, message) => {
    ready();
    if ("events" in over) repo.listStatementEvents.mockResolvedValue([...systemEvents, ...over.events.map((t, i) => ({ id: 100 + i, event_type: t }))]);
    if ("lines" in over) repo.listStatementLinesAsSystem.mockResolvedValue([...oldLines, ...over.lines]);
    if ("runs" in over) recon.listRuns.mockResolvedValue(over.runs);
    if ("resolutions" in over) recon.listResolutionsAsSystem.mockResolvedValue(over.resolutions);
    await expect(service.reprocessStatement(CO, 7)).rejects.toThrow(message);
    expect(recordSupplierDocumentAccess).not.toHaveBeenCalled();
    expect(repo.replaceLinesAsSystem).not.toHaveBeenCalled();
    expect(repo.updateStatementAsSystem).not.toHaveBeenCalled();
  });

  it.each([["Ready"], ["Reconciled"], ["Rejected"], ["Duplicate"], ["Queued"], ["Processing"]])("refuses a statement that is %s", async (status) => {
    ready({ status });
    await expect(service.reprocessStatement(CO, 7)).rejects.toThrow(/can be read again/);
    expect(recordSupplierDocumentAccess).not.toHaveBeenCalled();
  });

  it("refuses when the supplier is confirmed (unconfirm first)", async () => {
    ready({ supplier_confirmed_at: "2026-10-08T10:00:00Z" });
    await expect(service.reprocessStatement(CO, 7)).rejects.toThrow(/supplier has been confirmed/);
    expect(recordSupplierDocumentAccess).not.toHaveBeenCalled();
  });

  it("an unknown (or another company's) statement is not found — nothing is read", async () => {
    repo.getStatement.mockResolvedValue(null);
    await expect(service.reprocessStatement(CO, 7)).rejects.toBeInstanceOf(service.NotFoundError);
    expect(recordSupplierDocumentAccess).not.toHaveBeenCalled();
  });

  it("then the normal processing reads the SAME retained original with the current reader", async () => {
    repo.claimQueuedStatement.mockResolvedValue(statementRow({ status: "Processing", document_id: 70 }));
    repo.getDocumentForProcessing.mockResolvedValue({ storagePath: "co_1/Supplier/0/gourmet.pdf", filename: "monthly-negative-credits.pdf", mimeType: "application/pdf" });
    readSupplierOriginalBytes.mockResolvedValue(file("monthly-negative-credits.pdf"));
    repo.getStatementAsSystem.mockResolvedValue(statementRow({ status: "NeedsReview" }));
    expect(await service.processStatement(CO, 7, "reviewer@synthetic.test")).toBe("NeedsReview");
    expect(repo.getDocumentForProcessing).toHaveBeenCalledWith(CO, 70);
    const header = repo.updateStatementAsSystem.mock.calls.find((c) => c[2].status === "NeedsReview")![2];
    expect(header).toMatchObject({ statement_date: "2026-10-06", closing_balance: 23251.95, opening_balance: null, supplier_name_extracted: "Cape Harbour Fine Foods (Pty) Ltd" });
    const lines = repo.replaceLinesAsSystem.mock.calls[0][2] as { transaction_type: string; unresolved_fields: string[]; is_excluded: boolean }[];
    expect(lines.filter((l) => !l.is_excluded)).toHaveLength(12);
    expect(lines.filter((l) => l.transaction_type === "payment")).toHaveLength(4);
    expect(lines.every((l) => l.unresolved_fields.length === 0)).toBe(true);
  });
});
