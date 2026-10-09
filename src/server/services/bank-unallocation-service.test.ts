import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/repositories/bank-unallocation-repository", () => ({
  previewBankUnallocation: vi.fn(),
  executeBankUnallocation: vi.fn(),
}));

import * as repo from "@/server/repositories/bank-unallocation-repository";
import {
  DuplicateRunError,
  executeUnallocation,
  ForbiddenError,
  parseExecuteRequest,
  previewUnallocation,
  ValidationError,
} from "./bank-unallocation-service";
import { MAX_UNALLOCATION_ROWS, type UnallocationCandidate } from "@/server/banking/bulk-unallocation";

const KEY = "5f400000-0000-4000-8000-0000000011ff";

function candidate(id: number, exclusionReason: string | null = null): UnallocationCandidate {
  return {
    id, transactionDate: "2026-03-01", description: `T${id}`, reference: "", amount: -10, bankAccountId: 1, bankAccountName: "Cheque",
    allocationStatus: "Allocated", allocationMethod: "Manual", glAccountCode: "6100", glAccountName: "Bank Charges", exclusionReason,
  };
}

beforeEach(() => {
  vi.mocked(repo.previewBankUnallocation).mockReset();
  vi.mocked(repo.executeBankUnallocation).mockReset();
});

describe("previewUnallocation", () => {
  it("asks the database for one more row than a run may take, so an over-large range is reported, not cut silently", async () => {
    vi.mocked(repo.previewBankUnallocation).mockResolvedValue(Array.from({ length: MAX_UNALLOCATION_ROWS + 1 }, (_, i) => candidate(i + 1)));
    const preview = await previewUnallocation("co_1", { dateFrom: "2026-03-01", dateTo: "2026-03-31", bankAccountId: "7" });
    expect(repo.previewBankUnallocation).toHaveBeenCalledWith("co_1", "2026-03-01", "2026-03-31", 7, MAX_UNALLOCATION_ROWS + 1);
    expect(preview.truncated).toBe(true);
    expect(preview.candidates).toHaveLength(MAX_UNALLOCATION_ROWS);
    expect(preview.bankAccountId).toBe(7);
  });

  it("passes no bank account as null (all accounts)", async () => {
    vi.mocked(repo.previewBankUnallocation).mockResolvedValue([candidate(1)]);
    const preview = await previewUnallocation("co_1", { dateFrom: "2026-03-01", dateTo: "2026-03-01", bankAccountId: "" });
    expect(repo.previewBankUnallocation).toHaveBeenCalledWith("co_1", "2026-03-01", "2026-03-01", null, MAX_UNALLOCATION_ROWS + 1);
    expect(preview.truncated).toBe(false);
  });

  it("refuses an inverted range before reaching the database", async () => {
    await expect(previewUnallocation("co_1", { dateFrom: "2026-03-31", dateTo: "2026-03-01" })).rejects.toThrow(ValidationError);
    expect(repo.previewBankUnallocation).not.toHaveBeenCalled();
  });

  it("turns the database's permission refusal into a ForbiddenError", async () => {
    vi.mocked(repo.previewBankUnallocation).mockRejectedValue({ code: "42501", message: "Banking:Edit is required" });
    await expect(previewUnallocation("co_1", { dateFrom: "2026-03-01", dateTo: "2026-03-31" })).rejects.toThrow(ForbiddenError);
  });

  it("lets an unexpected database error propagate unchanged", async () => {
    const failure = { code: "XX000", message: "boom" };
    vi.mocked(repo.previewBankUnallocation).mockRejectedValue(failure);
    await expect(previewUnallocation("co_1", { dateFrom: "2026-03-01", dateTo: "2026-03-31" })).rejects.toBe(failure);
  });
});

describe("parseExecuteRequest", () => {
  const valid = { requestKey: KEY, dateFrom: "2026-03-01", dateTo: "2026-03-31", bankAccountId: null, items: [{ id: 5, glAccount: "6100" }] };

  it("accepts a complete request and keeps each previewed GL for the stale check", () => {
    expect(parseExecuteRequest(valid)).toEqual({ ...valid, items: [{ id: 5, glAccount: "6100" }] });
  });

  it("requires the preview's request key", () => {
    expect(() => parseExecuteRequest({ ...valid, requestKey: undefined })).toThrow(/preview key/);
  });

  it("requires at least one selected transaction", () => {
    expect(() => parseExecuteRequest({ ...valid, items: [] })).toThrow(/at least one/);
  });

  it("refuses an inverted range", () => {
    expect(() => parseExecuteRequest({ ...valid, dateFrom: "2026-04-01" })).toThrow(/From Date cannot be later/);
  });

  it("refuses an invalid transaction id", () => {
    expect(() => parseExecuteRequest({ ...valid, items: [{ id: "x" }] })).toThrow(/valid id/);
  });

  it("refuses more than one run may take", () => {
    const items = Array.from({ length: MAX_UNALLOCATION_ROWS + 1 }, (_, i) => ({ id: i + 1, glAccount: "6100" }));
    expect(() => parseExecuteRequest({ ...valid, items })).toThrow(/narrow the date range/);
  });
});

describe("executeUnallocation", () => {
  const body = { requestKey: KEY, dateFrom: "2026-03-01", dateTo: "2026-03-31", items: [{ id: 5, glAccount: "6100" }] };

  it("returns the database's per-transaction result as-is", async () => {
    const result = { runId: 9, requested: 1, unallocated: 0, skipped: 0, failed: 1, items: [{ transactionId: 5, outcome: "failed", reason: "x", glAccount: "6100", glAccountName: null }] };
    vi.mocked(repo.executeBankUnallocation).mockResolvedValue(result as never);
    await expect(executeUnallocation("co_1", body)).resolves.toBe(result);
    expect(repo.executeBankUnallocation).toHaveBeenCalledWith("co_1", { ...body, bankAccountId: null });
  });

  it("reports a repeated preview as a duplicate run", async () => {
    vi.mocked(repo.executeBankUnallocation).mockRejectedValue({ code: "23505", message: "PRECISIA_UNALLOCATION_DUPLICATE: this preview has already been executed." });
    await expect(executeUnallocation("co_1", body)).rejects.toThrow(DuplicateRunError);
  });

  it("shows the database's own validation message", async () => {
    vi.mocked(repo.executeBankUnallocation).mockRejectedValue({ code: "42501", message: "PRECISIA_UNALLOCATION_INVALID: that bank account does not belong to this company." });
    await expect(executeUnallocation("co_1", body)).rejects.toThrow("that bank account does not belong to this company.");
  });

  it("reports the database's permission refusal (view-only or another company's user)", async () => {
    vi.mocked(repo.executeBankUnallocation).mockRejectedValue({ code: "42501", message: "Banking:Edit is required" });
    await expect(executeUnallocation("co_1", body)).rejects.toThrow(ForbiddenError);
  });
});
