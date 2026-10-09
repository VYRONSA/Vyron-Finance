import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ rpc })) }));

import { candidateFromRow, executeBankUnallocation, previewBankUnallocation } from "./bank-unallocation-repository";

beforeEach(() => rpc.mockReset());

describe("candidateFromRow", () => {
  it("signs the amount (money in positive, money out negative) and keeps the GL code and name", () => {
    const c = candidateFromRow({
      id: 3, transaction_date: "2026-03-01", description: "Fee", reference: "R", debit: "125.50", credit: "0",
      bank_account_id: 1, bank_account_name: "Cheque", allocation_status: "Allocated", allocation_method: "Manual",
      gl_account_code: "6100", gl_account_name: "Bank Charges", exclusion_reason: null,
    });
    expect(c).toMatchObject({ id: 3, amount: -125.5, glAccountCode: "6100", glAccountName: "Bank Charges", exclusionReason: null });
  });
});

describe("previewBankUnallocation", () => {
  it("calls the preview function under the user's session with the exact range and bank account", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await previewBankUnallocation("co_1", "2026-03-01", "2026-03-31", 4, 5001);
    expect(rpc).toHaveBeenCalledWith("fn_preview_bank_unallocation", {
      p_company_id: "co_1", p_date_from: "2026-03-01", p_date_to: "2026-03-31", p_bank_account_id: 4, p_limit: 5001,
    });
  });
});

describe("executeBankUnallocation", () => {
  it("sends the request key and each previewed GL; it never sends an actor", async () => {
    rpc.mockResolvedValue({ data: { runId: 1 }, error: null });
    await executeBankUnallocation("co_1", {
      requestKey: "k", dateFrom: "2026-03-01", dateTo: "2026-03-31", bankAccountId: null, items: [{ id: 1, glAccount: "6100" }],
    });
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe("fn_bulk_unallocate_bank_transactions");
    expect(args).toEqual({
      p_company_id: "co_1", p_request_key: "k", p_date_from: "2026-03-01", p_date_to: "2026-03-31", p_bank_account_id: null,
      p_items: [{ id: 1, glAccount: "6100" }],
    });
    expect(Object.keys(args).some((k) => /actor|performed/i.test(k))).toBe(false);
  });

  it("throws the database error rather than reporting a result", async () => {
    const error = { code: "42501", message: "Banking:Edit is required" };
    rpc.mockResolvedValue({ data: null, error });
    await expect(executeBankUnallocation("co_1", { requestKey: "k", dateFrom: "a", dateTo: "b", bankAccountId: null, items: [] })).rejects.toBe(error);
  });
});
