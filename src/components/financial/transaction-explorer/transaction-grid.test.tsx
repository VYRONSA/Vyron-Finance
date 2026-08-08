import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TransactionGrid } from "./transaction-grid";
import type { BankTransactionRecord } from "@/server/accounting/types";

function txn(id: number): BankTransactionRecord {
  return {
    id, companyId: "c1", transactionDate: "2026-08-01", reference: `REF-${id}`, description: `Transaction ${id}`,
    beneficiary: `Merchant ${id % 10}`, debit: 100, credit: 0, balance: null, bankAccount: "", bankAccountId: 1,
    glAccount: "", vat: null, notes: "", importBatch: "", sourceFilename: "", createdAt: "2026-08-01T00:00:00Z",
    allocationStatus: "Unallocated", matchedSupplierId: null, matchedSupplierName: null, matchedBillId: null,
    confidenceScore: null, rulesTriggered: [], matchReason: "", requiredAction: null,
    suggestedGlAccount: null, suggestedVatCode: null, allocationMethod: null, allocationReason: "",
    isManualOverride: false, reviewStatus: null, reviewedBy: null, reviewedAt: null, reviewNote: null,
    journalId: null, matchedCustomerId: null, matchedMerchantId: null, ruleId: null,
    allocationType: null, allocationNotes: "", entrySource: "Imported", captureStatus: null,
    cashbookBatchId: null, reconciliationId: null, reversalOfTransactionId: null, isSplit: false,
  };
}

const TRANSACTIONS = Array.from({ length: 300 }, (_, i) => txn(i + 1));

// Pilot Review Board follow-up — "must remain responsive with 10,000+
// transactions... only visible rows should render." jsdom has no real
// layout engine (every measured height is 0, and there's no
// ResizeObserver), so it cannot exercise the actual windowing behaviour
// the way a real browser would — with a genuinely zero-height scroll
// container, `@tanstack/react-virtual` correctly computes an empty
// visible range, so this environment cannot assert "some rows are
// rendered" without first faking a realistic container size. What CAN
// be verified here: the virtualized render doesn't crash, the header
// still renders correctly, and it never mounts every one of 300 loaded
// rows into the DOM at once (which a non-virtualized `.map()` over all
// rows — the Phase 1 implementation before this change — would have
// done regardless of jsdom's layout limitations). Real windowing
// behaviour (does scrolling actually keep only the visible ~15 rows
// mounted) needs a real browser to verify — no browser automation is
// available in this environment.
describe("TransactionGrid virtualization", () => {
  it("renders without crashing, keeps the header, and never mounts all loaded rows at once", () => {
    render(
      <TransactionGrid
        transactions={TRANSACTIONS}
        sorting={[]}
        onSortingChange={() => {}}
        columnVisibility={{}}
        onColumnVisibilityChange={() => {}}
        rowSelection={{}}
        onRowSelectionChange={() => {}}
        columnSizing={{}}
        onColumnSizingChange={() => {}}
        onRowClick={() => {}}
        suppliers={[]}
        customers={[]}
        chartOfAccounts={[]}
        vatTreatments={[]}
        onAllocateRow={async () => true}
        onCheckDuplicateRule={async () => null}
      />,
    );

    expect(screen.getByRole("columnheader", { name: "Date" })).toBeInTheDocument();
    const bodyRows = document.querySelectorAll("tbody tr");
    expect(bodyRows.length).toBeLessThan(TRANSACTIONS.length);
  });
});
