/**
 * Bulk Unpost (migration 0120) — service and repository: the database
 * decides, under the user's own session; refusals are typed, never
 * reported as success.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ rpc })) }));

import { executeBankUnposting, previewBankUnposting, unpostingCandidateFromRow } from "@/server/repositories/bank-unallocation-repository";
import { DuplicateRunError, executeUnposting, ForbiddenError, parseUnpostRequest, previewUnposting, ValidationError } from "./bank-unallocation-service";
import { MAX_UNALLOCATION_ROWS } from "@/server/banking/bulk-unallocation";

const KEY = "5f400000-0000-4000-8000-0000000012ff";

function row(id: number) {
  return {
    id, transaction_date: "2026-03-10", description: `T${id}`, reference: "R", debit: "0", credit: "200.00",
    bank_account_id: 1, bank_account_name: "Cheque", allocation_status: "Allocated", allocation_type: "C",
    gl_account_code: null, gl_account_name: null, customer_id: 7, customer_code: "CUST-001", customer_name: "Acme",
    supplier_id: null, supplier_code: null, supplier_name: null, journal_id: 42, journal_number: "JR000042",
    journal_date: "2026-03-10", journal_source_type: "bank_transactions_post", journal_transaction_count: 3, exclusion_reason: null,
  };
}

beforeEach(() => rpc.mockReset());

describe("unpostingCandidateFromRow", () => {
  it("signs the amount and keeps the customer, journal and group size", () => {
    expect(unpostingCandidateFromRow(row(5))).toMatchObject({
      id: 5, amount: 200, customerId: 7, customerCode: "CUST-001", journalId: 42, journalNumber: "JR000042", journalTransactionCount: 3,
      exclusionReason: null,
    });
  });
});

describe("previewUnposting", () => {
  it("calls the posted preview function with the exact range and asks for one row more than a run takes", async () => {
    rpc.mockResolvedValue({ data: [row(1)], error: null });
    const preview = await previewUnposting("co_1", { dateFrom: "2026-03-01", dateTo: "2026-03-31", bankAccountId: "4" });
    expect(rpc).toHaveBeenCalledWith("fn_preview_bank_unposting", {
      p_company_id: "co_1", p_date_from: "2026-03-01", p_date_to: "2026-03-31", p_bank_account_id: 4, p_limit: MAX_UNALLOCATION_ROWS + 1,
    });
    expect(preview.candidates).toHaveLength(1);
    expect(preview.truncated).toBe(false);
  });

  it("refuses an inverted range before reaching the database", async () => {
    await expect(previewUnposting("co_1", { dateFrom: "2026-03-31", dateTo: "2026-03-01" })).rejects.toThrow(ValidationError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("names both permissions when the database refuses", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "Banking:Edit and GeneralLedger:Reverse are required" } });
    await expect(previewUnposting("co_1", { dateFrom: "2026-03-01", dateTo: "2026-03-31" })).rejects.toThrow(/General Ledger Reverse/);
  });
});

describe("parseUnpostRequest", () => {
  const base = { requestKey: KEY, dateFrom: "2026-03-01", dateTo: "2026-03-31", bankAccountId: null };

  it("keeps each item's journal, GL, customer and supplier as previewed", () => {
    const request = parseUnpostRequest({ ...base, items: [{ id: 1, journalId: 42, glAccount: "", customerId: 7, supplierId: null }] });
    expect(request.items).toEqual([{ id: 1, journalId: 42, glAccount: "", customerId: 7, supplierId: null }]);
  });

  it("refuses an item without the journal it was posted on", () => {
    expect(() => parseUnpostRequest({ ...base, items: [{ id: 1 }] })).toThrow(/journal it was posted on/);
  });

  it("refuses a missing request key, an empty selection and an over-large one", () => {
    expect(() => parseUnpostRequest({ ...base, requestKey: "x", items: [{ id: 1, journalId: 2 }] })).toThrow(/preview key/);
    expect(() => parseUnpostRequest({ ...base, items: [] })).toThrow(/at least one/);
    const many = Array.from({ length: MAX_UNALLOCATION_ROWS + 1 }, (_, i) => ({ id: i + 1, journalId: 1 }));
    expect(() => parseUnpostRequest({ ...base, items: many })).toThrow(/At most/);
  });
});

describe("executeUnposting", () => {
  const body = { requestKey: KEY, dateFrom: "2026-03-01", dateTo: "2026-03-31", bankAccountId: null, items: [{ id: 1, journalId: 42, glAccount: "6100" }] };

  it("sends the request to the writer and never an actor (the database stamps it from the session)", async () => {
    rpc.mockResolvedValue({ data: { runId: 9, unposted: 1 }, error: null });
    const result = await executeUnposting("co_1", body);
    expect(result).toEqual({ runId: 9, unposted: 1 });
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe("fn_bulk_unpost_bank_transactions");
    expect(args.p_items).toEqual([{ id: 1, journalId: 42, glAccount: "6100", customerId: null, supplierId: null }]);
    expect(Object.keys(args).some((k) => /actor|performed/i.test(k))).toBe(false);
  });

  it("a repeated preview is a DuplicateRunError", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "23505", message: "PRECISIA_UNALLOCATION_DUPLICATE: this preview has already been executed." } });
    await expect(executeUnposting("co_1", body)).rejects.toThrow(DuplicateRunError);
  });

  it("the database's permission refusal is a ForbiddenError", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "Banking:Edit and GeneralLedger:Reverse are required" } });
    await expect(executeUnposting("co_1", body)).rejects.toThrow(ForbiddenError);
  });

  it("an unexpected database error propagates unchanged", async () => {
    const error = { code: "XX000", message: "boom" };
    rpc.mockResolvedValue({ data: null, error });
    await expect(executeUnposting("co_1", body)).rejects.toBe(error);
  });
});

describe("executeBankUnposting / previewBankUnposting", () => {
  it("throw the database error rather than returning a result", async () => {
    const error = { code: "42501", message: "no" };
    rpc.mockResolvedValue({ data: null, error });
    await expect(previewBankUnposting("co_1", "a", "b", null, 1)).rejects.toBe(error);
    await expect(executeBankUnposting("co_1", { requestKey: "k", dateFrom: "a", dateTo: "b", bankAccountId: null, items: [] })).rejects.toBe(error);
  });
});
