/**
 * PRODUCTION DEFECT — "I updated the 2 ticked supplier invoices, after it
 * does not give me the option to post them."
 *
 * A bank payment allocated to a SUPPLIER deliberately carries no GL
 * account: the expense was recognised when the supplier invoice was
 * captured, and the payment settles a control-account balance. But
 * `transactionPostingStatus` recognised only a `suggested_gl_account` (or
 * a split) as "this transaction has a destination", so every
 * supplier-allocated payment stayed Unprocessed forever, "Post to
 * Accounting" never enabled, and there was no way forward at all. On
 * Northwood Management Investments that was 194 transactions.
 *
 * The company's own seeded posting rules (migration 0007) have always
 * stated the correct treatment:
 *
 *   Supplier Payment   DR creditors (2000)   CR bank (1000)
 *   Customer Receipt   DR bank (1000)        CR debtors (1100)
 *
 * These tests pin that treatment, and pin the two things it must NOT do:
 * invent a control account when the company has not configured one, and
 * change how any transaction that could already post is posted.
 */
import { describe, expect, it } from "vitest";
import {
  buildJournalLinesForTransaction,
  resolveTransactionGlAccount,
  CREDITORS_CONTROL_MISSING_REASON,
  DEBTORS_CONTROL_MISSING_REASON,
  type LedgerControlAccounts,
} from "@/server/services/journal-service";
import { buildBankPostingPlan, controlAccountFromRule } from "@/server/services/bank-posting-service";
import { isAllocatedForPosting, transactionPostingStatus, type BankTransactionRecord } from "@/server/accounting/types";
import type { FinancialYear } from "@/server/company-management/types";

const SEEDED: LedgerControlAccounts = { creditors: "2000", debtors: "1100" };
const BANK_GL = { glAccount: "1000", accountNumber: "62050837304" };

const OPEN_YEAR: FinancialYear[] = [
  {
    id: 1,
    companyId: "co_1",
    yearLabel: "FY2026",
    startDate: "2026-03-01",
    endDate: "2027-02-28",
    status: "Open",
    periods: [{ id: 1, financialYearId: 1, periodNumber: 6, startDate: "2026-08-01", endDate: "2026-08-31", status: "Open" }],
  } as unknown as FinancialYear,
];

function txn(overrides: Partial<BankTransactionRecord> = {}): BankTransactionRecord {
  return {
    id: 1, companyId: "co_1", transactionDate: "2026-08-13", reference: "", description: "FNB OB Pmt — The Wash Line",
    beneficiary: "The Wash Line", debit: 12910, credit: 0, balance: null, bankAccount: "62050837304", bankAccountId: 1,
    glAccount: "", vat: null, notes: "", importBatch: "XERO", sourceFilename: "bank.xlsx",
    createdAt: "2026-09-09T00:00:00Z", allocationStatus: "Allocated", matchedSupplierId: null, matchedSupplierName: null,
    matchedBillId: null, confidenceScore: null, rulesTriggered: [], matchReason: "", requiredAction: null,
    suggestedGlAccount: null, suggestedVatCode: null, allocationMethod: "Manual", allocationReason: "", isManualOverride: true,
    reviewStatus: null, reviewedBy: null, reviewedAt: null, reviewNote: null, journalId: null, matchedCustomerId: null,
    matchedMerchantId: null, ruleId: null, allocationType: null, allocationNotes: "", entrySource: "Imported",
    captureStatus: null, cashbookBatchId: null, reconciliationId: null, reversalOfTransactionId: null, isSplit: false,
    postedFlag: false, postedAt: null, postingBatchId: null, sourceOccurrence: 1, reviewHold: false,
    reviewHoldReason: "", reviewHoldBy: null, reviewHoldAt: null, overrideSupplierInvoiceMatching: false,
    overrideSupplierInvoiceMatchingBy: null, overrideSupplierInvoiceMatchingAt: null,
    ...overrides,
  };
}

/** Exactly the Northwood shape: allocated to a supplier, no GL account. */
function supplierPayment(overrides: Partial<BankTransactionRecord> = {}): BankTransactionRecord {
  return txn({ allocationType: "S", matchedSupplierId: 630, suggestedGlAccount: null, debit: 12910, credit: 0, ...overrides });
}

function customerReceipt(overrides: Partial<BankTransactionRecord> = {}): BankTransactionRecord {
  return txn({ allocationType: "C", matchedCustomerId: 77, suggestedGlAccount: null, debit: 0, credit: 5000, ...overrides });
}

function planContext(controlAccounts: LedgerControlAccounts = SEEDED) {
  return {
    bankAccountsById: new Map([[1, BANK_GL]]),
    controlAccounts,
    splitsByTransactionId: new Map(),
    accountCodes: new Set(["1000", "1100", "2000", "2300", "3030"]),
    financialYears: OPEN_YEAR,
    financialYearStartMonth: 3,
    journalNumberAt: (i: number) => `JR${String(1 + i).padStart(6, "0")}`,
  };
}

describe("1. the reported defect: a supplier-allocated payment is Ready to Post", () => {
  it("allocated to a supplier with no GL account — was Unprocessed, is now Ready to Post", () => {
    expect(transactionPostingStatus(supplierPayment())).toBe("Ready to Post");
  });

  it("a receipt allocated to a customer is Ready to Post too", () => {
    expect(transactionPostingStatus(customerReceipt())).toBe("Ready to Post");
  });

  it("an allocation type with NO counterparty identified is not a destination", () => {
    expect(isAllocatedForPosting(supplierPayment({ matchedSupplierId: null }))).toBe(false);
    expect(isAllocatedForPosting(customerReceipt({ matchedCustomerId: null }))).toBe(false);
    expect(transactionPostingStatus(supplierPayment({ matchedSupplierId: null }))).toBe("Unprocessed");
  });

  it("a genuinely unallocated transaction is still Unprocessed", () => {
    expect(transactionPostingStatus(txn())).toBe("Unprocessed");
  });

  it("a matched supplier WITHOUT an explicit allocation type is not swept in", () => {
    // Matching can identify a supplier on a row nobody has allocated;
    // identification alone is not a decision about where it posts.
    expect(isAllocatedForPosting(txn({ matchedSupplierId: 630, allocationType: null }))).toBe(false);
  });

  it("posted and reconciled still win over everything", () => {
    expect(transactionPostingStatus(supplierPayment({ postedFlag: true }))).toBe("Posted");
    expect(transactionPostingStatus(supplierPayment({ postedFlag: true, reconciliationId: 5 }))).toBe("Reconciled");
  });
});

describe("2. the double entry is the company's own posting rule", () => {
  it("supplier payment: DR Creditors, CR Bank, gross, no VAT line", () => {
    const result = buildJournalLinesForTransaction(supplierPayment({ vat: 1683.91 }), BANK_GL, SEEDED);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines).toEqual([
      { accountCode: "2000", debit: 12910, credit: 0, description: "FNB OB Pmt — The Wash Line" },
      { accountCode: "1000", debit: 0, credit: 12910, description: "FNB OB Pmt — The Wash Line" },
    ]);
  });

  it("VAT is NEVER split out of a control-account posting — it was recognised on the invoice", () => {
    // A VAT line here would double-count input tax: once on the supplier
    // invoice, once again on the payment that settles it.
    const result = buildJournalLinesForTransaction(supplierPayment({ vat: 1683.91 }), BANK_GL, SEEDED);
    if (!result.ok) throw new Error("expected ok");
    expect(result.lines.some((l) => l.accountCode === "2300")).toBe(false);
    expect(result.lines).toHaveLength(2);
  });

  it("customer receipt: DR Bank, CR Debtors, gross", () => {
    const result = buildJournalLinesForTransaction(customerReceipt(), BANK_GL, SEEDED);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines).toEqual([
      { accountCode: "1000", debit: 5000, credit: 0, description: "FNB OB Pmt — The Wash Line" },
      { accountCode: "1100", debit: 0, credit: 5000, description: "FNB OB Pmt — The Wash Line" },
    ]);
  });

  it("every control-account journal balances", () => {
    for (const t of [supplierPayment(), customerReceipt()]) {
      const result = buildJournalLinesForTransaction(t, BANK_GL, SEEDED);
      if (!result.ok) throw new Error("expected ok");
      const debit = result.lines.reduce((s, l) => s + l.debit, 0);
      const credit = result.lines.reduce((s, l) => s + l.credit, 0);
      expect(debit).toBeCloseTo(credit, 2);
    }
  });
});

describe("3. a directly assigned GL account is untouched — nothing that posts today changes", () => {
  it("a GL account always wins over the control account", () => {
    const resolved = resolveTransactionGlAccount(supplierPayment({ suggestedGlAccount: "3030" }), SEEDED);
    expect(resolved).toEqual({ ok: true, accountCode: "3030", viaControlAccount: false });
  });

  it("VAT is still split out on a direct GL allocation, exactly as before", () => {
    const result = buildJournalLinesForTransaction(txn({ suggestedGlAccount: "3030", debit: 1150, vat: 150 }), BANK_GL, SEEDED);
    if (!result.ok) throw new Error("expected ok");
    expect(result.lines).toEqual([
      { accountCode: "3030", debit: 1000, credit: 0, description: "FNB OB Pmt — The Wash Line" },
      { accountCode: "2300", debit: 150, credit: 0, description: "VAT — FNB OB Pmt — The Wash Line" },
      { accountCode: "1000", debit: 0, credit: 1150, description: "FNB OB Pmt — The Wash Line" },
    ]);
  });

  it("a transaction with neither a GL account nor a ledger allocation is still 'No GL account assigned'", () => {
    expect(resolveTransactionGlAccount(txn(), SEEDED)).toEqual({ ok: false, reason: "No GL account assigned" });
  });
});

describe("4. a control account is never invented", () => {
  it("no Creditors account configured — reports the configuration problem, posts nothing", () => {
    const result = buildJournalLinesForTransaction(supplierPayment(), BANK_GL, { creditors: null, debtors: "1100" });
    expect(result).toEqual({ ok: false, reason: CREDITORS_CONTROL_MISSING_REASON });
    expect(CREDITORS_CONTROL_MISSING_REASON).toMatch(/Supplier Payment/);
  });

  it("no Debtors account configured — same treatment for a customer receipt", () => {
    const result = buildJournalLinesForTransaction(customerReceipt(), BANK_GL, { creditors: "2000", debtors: null });
    expect(result).toEqual({ ok: false, reason: DEBTORS_CONTROL_MISSING_REASON });
    expect(DEBTORS_CONTROL_MISSING_REASON).toMatch(/Customer Receipt/);
  });

  it("a blank account code on the rule counts as not configured", () => {
    expect(controlAccountFromRule({ lines: [{ role: "creditors", fixedAccountCode: "   " }] }, "creditors")).toBeNull();
    expect(controlAccountFromRule({ lines: [{ role: "creditors", fixedAccountCode: null }] }, "creditors")).toBeNull();
    expect(controlAccountFromRule(null, "creditors")).toBeNull();
    expect(controlAccountFromRule({ lines: [{ role: "bank", fixedAccountCode: "1000" }] }, "creditors")).toBeNull();
  });

  it("reads the code the company actually uses, not a hardcoded one", () => {
    expect(controlAccountFromRule({ lines: [{ role: "creditors", fixedAccountCode: "2050" }] }, "creditors")).toBe("2050");
    const result = buildJournalLinesForTransaction(supplierPayment(), BANK_GL, { creditors: "2050", debtors: null });
    if (!result.ok) throw new Error("expected ok");
    expect(result.lines[0].accountCode).toBe("2050");
  });
});

describe("5. every other posting guard still applies", () => {
  it("supplier invoice matching still blocks a payment with no bill and no override", () => {
    const plan = buildBankPostingPlan([supplierPayment()], planContext());
    expect(plan.journals).toHaveLength(0);
    expect(plan.blocked).toHaveLength(1);
    expect(plan.blocked[0].reason).toMatch(/Supplier invoice matching required/i);
  });

  it("with the override set, the payment posts to the Creditors control account", () => {
    const plan = buildBankPostingPlan([supplierPayment({ overrideSupplierInvoiceMatching: true })], planContext());
    expect(plan.blocked).toHaveLength(0);
    expect(plan.notReady).toHaveLength(0);
    expect(plan.journals).toHaveLength(1);
    expect(plan.journals[0].lines.map((l) => l.accountCode)).toEqual(["2000", "1000"]);
  });

  it("with a matched bill, it posts without needing the override", () => {
    const plan = buildBankPostingPlan([supplierPayment({ matchedBillId: 9001 })], planContext());
    expect(plan.blocked).toHaveLength(0);
    expect(plan.journals).toHaveLength(1);
  });

  it("an unconfigured Creditors account is reported as needing attention, never guessed", () => {
    const plan = buildBankPostingPlan([supplierPayment({ overrideSupplierInvoiceMatching: true })], planContext({ creditors: null, debtors: null }));
    expect(plan.journals).toHaveLength(0);
    expect(plan.blocked[0].reason).toBe(CREDITORS_CONTROL_MISSING_REASON);
  });

  it("a control account missing from the Chart of Accounts blocks rather than posting to a phantom account", () => {
    const context = { ...planContext(), accountCodes: new Set(["1000", "3030"]) };
    const plan = buildBankPostingPlan([supplierPayment({ overrideSupplierInvoiceMatching: true })], context);
    expect(plan.journals).toHaveLength(0);
    expect(plan.blocked[0].reason).toMatch(/No Chart of Accounts entry for account code "2000"/);
  });

  it("an already-posted supplier payment is left alone", () => {
    const plan = buildBankPostingPlan([supplierPayment({ postedFlag: true, overrideSupplierInvoiceMatching: true })], planContext());
    expect(plan.journals).toHaveLength(0);
    expect(plan.alreadyPosted).toHaveLength(1);
  });
});
