import { describe, expect, it } from "vitest";
import { buildMyDraftsList } from "./my-drafts-service";
import type { Journal } from "@/server/accounting/types";
import type { Quotation, SalesOrder } from "@/server/sales/types";
import type { PurchaseRequisition, PurchaseOrder } from "@/server/purchasing/types";
import type { CashbookBatch } from "@/server/banking/types";

function journal(overrides: Partial<Journal> & Pick<Journal, "id" | "status">): Journal {
  return {
    companyId: "co_1", journalNumber: `JR${overrides.id}`, journalDate: "2026-07-01", journalType: "Manual",
    description: "Test journal", reference: "", sourceType: "manual", sourceId: null, totalDebit: 0, totalCredit: 0,
    createdAt: "2026-07-01T00:00:00Z", postedAt: null, submittedBy: null, submittedAt: null, approvedBy: null,
    approvedAt: null, rejectedBy: null, rejectedAt: null, cancelledBy: null, cancelledAt: null, isReversed: false,
    reversalOfJournalId: null, reversedByJournalId: null, postingBatchId: null, lines: [],
    ...overrides,
  };
}

function quotation(overrides: Partial<Quotation> & Pick<Quotation, "id" | "status">): Quotation {
  return { companyId: "co_1", customerId: 1, quotationNumber: `QT${overrides.id}`, quotationDate: "2026-07-02", expiryDate: null, notes: "", createdAt: "2026-07-02T00:00:00Z", lines: [], ...overrides };
}

function salesOrder(overrides: Partial<SalesOrder> & Pick<SalesOrder, "id" | "status">): SalesOrder {
  return { companyId: "co_1", customerId: 1, quotationId: null, orderNumber: `SO${overrides.id}`, orderDate: "2026-07-03", notes: "", createdAt: "2026-07-03T00:00:00Z", lines: [], ...overrides };
}

function requisition(overrides: Partial<PurchaseRequisition> & Pick<PurchaseRequisition, "id" | "status">): PurchaseRequisition {
  return { companyId: "co_1", requisitionNumber: `PR${overrides.id}`, requestedBy: "tester", departmentId: null, requisitionDate: "2026-07-04", notes: "", createdAt: "2026-07-04T00:00:00Z", lines: [], ...overrides };
}

function purchaseOrder(overrides: Partial<PurchaseOrder> & Pick<PurchaseOrder, "id" | "status">): PurchaseOrder {
  return { companyId: "co_1", supplierId: 1, requisitionId: null, orderNumber: `PO${overrides.id}`, orderDate: "2026-07-05", notes: "", createdAt: "2026-07-05T00:00:00Z", lines: [], ...overrides };
}

function cashbookBatch(overrides: Partial<CashbookBatch> & Pick<CashbookBatch, "id" | "status">): CashbookBatch {
  return { companyId: "co_1", batchNumber: `CB${overrides.id}`, batchDate: "2026-07-06", batchType: "Receipts", notes: "", createdBy: "tester", createdAt: "2026-07-06T00:00:00Z", ...overrides };
}

const EMPTY = { journals: [], quotations: [], salesOrders: [], requisitions: [], purchaseOrders: [], cashbookBatches: [] };

describe("buildMyDraftsList", () => {
  it("includes only Draft-status items across every module", () => {
    const result = buildMyDraftsList("co_1", {
      journals: [journal({ id: 1, status: "Draft" }), journal({ id: 2, status: "Posted" })],
      quotations: [quotation({ id: 1, status: "Draft" }), quotation({ id: 2, status: "Sent" })],
      salesOrders: [salesOrder({ id: 1, status: "Draft" }), salesOrder({ id: 2, status: "Confirmed" })],
      requisitions: [requisition({ id: 1, status: "Draft" }), requisition({ id: 2, status: "Approved" })],
      purchaseOrders: [purchaseOrder({ id: 1, status: "Draft" }), purchaseOrder({ id: 2, status: "Submitted" })],
      cashbookBatches: [cashbookBatch({ id: 1, status: "Draft" }), cashbookBatch({ id: 2, status: "Posted" })],
    });

    expect(result).toHaveLength(6);
    expect(result.every((item) => result.filter((i) => i.number === item.number).length === 1)).toBe(true);
    expect(result.map((i) => i.module).sort()).toEqual(["Cashbook", "General Ledger", "Purchasing", "Purchasing", "Sales", "Sales"]);
  });

  it("returns an empty list when nothing is in Draft", () => {
    expect(buildMyDraftsList("co_1", EMPTY)).toEqual([]);
  });

  it("sorts most-recently-dated first, across modules", () => {
    const result = buildMyDraftsList("co_1", {
      ...EMPTY,
      journals: [journal({ id: 1, status: "Draft", journalDate: "2026-07-01" })],
      quotations: [quotation({ id: 1, status: "Draft", quotationDate: "2026-07-15" })],
      cashbookBatches: [cashbookBatch({ id: 1, status: "Draft", batchDate: "2026-07-08" })],
    });

    expect(result.map((i) => i.documentType)).toEqual(["Quotation", "Cashbook Batch", "Journal"]);
  });

  it("links each item into its owning module's screen", () => {
    const result = buildMyDraftsList("co_1", { ...EMPTY, journals: [journal({ id: 1, status: "Draft", journalNumber: "JR000042" })] });
    expect(result[0].href).toBe("/company/co_1/general-ledger?tab=journals&journal=JR000042");
  });
});
