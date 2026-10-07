/**
 * @vitest-environment node
 *
 * SD-3C — the supplier statement workflow (repository mocked; the pure
 * modules — reader, validation, supplier proposal — are the real ones).
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
}));
const { readSupplierOriginalBytes, setSupplierOurAccountNumber } = vi.hoisted(() => ({ readSupplierOriginalBytes: vi.fn(), setSupplierOurAccountNumber: vi.fn() }));

vi.mock("@/server/repositories/supplier-statement-repository", () => repo);
vi.mock("@/server/repositories/supplier-document-access-repository", () => ({ readSupplierOriginalBytes: (...a: unknown[]) => readSupplierOriginalBytes(...a) }));
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

  it("a scanned PDF goes to manual entry (no OCR in SD-3C) — nothing is guessed", async () => {
    repo.claimQueuedStatement.mockResolvedValue(statementRow({ status: "Processing" }));
    repo.getDocumentForProcessing.mockResolvedValue({ storagePath: "p", filename: "scanned.pdf", mimeType: "application/pdf" });
    readSupplierOriginalBytes.mockResolvedValue(file("scanned.pdf"));
    expect(await service.processStatement(CO, 7, "System")).toBe("ManualEntry");
    expect(repo.updateStatementAsSystem).toHaveBeenCalledWith(CO, 7, expect.objectContaining({ status: "ManualEntry", source_type: "pdf-scanned", manual_entry: true }));
    expect(repo.replaceLinesAsSystem).not.toHaveBeenCalled();
  });

  it("an image statement goes to manual entry", async () => {
    repo.claimQueuedStatement.mockResolvedValue(statementRow({ status: "Processing" }));
    repo.getDocumentForProcessing.mockResolvedValue({ storagePath: "p", filename: "scan-png.png", mimeType: "image/png" });
    readSupplierOriginalBytes.mockResolvedValue(file("scan-png.png"));
    expect(await service.processStatement(CO, 7, "System")).toBe("ManualEntry");
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
  it("the statement workflow imports no accounting or AI module, and touches only its own tables", () => {
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
        expect(spec, `${path} imports ${spec}`).not.toMatch(/purchase-bill|posting|journal|supplier-payment|allocation|party-ledger|report-centre|\/ai\/|extraction-provider|provider-selection|gateway/);
      }
      const tables = [...source.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
      for (const table of tables) expect(allowedTables.has(table), `${path} touches ${table}`).toBe(true);
      expect(source, path).not.toMatch(/generateObject|AI_GATEWAY_API_KEY|VYRON_AI_/);
    }
  });
});
