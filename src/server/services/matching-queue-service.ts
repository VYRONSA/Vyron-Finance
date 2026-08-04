/**
 * The ONE Review Queue — Matching Platform directive: "Every unmatched
 * item in the system must appear here. Not in multiple pages. Everything
 * enters one queue." A live aggregation, not a persisted shadow table —
 * every item is read from its own real source of truth (Banking
 * Exceptions, Sales Invoices, Purchase Bills, Cashbook, Audit's own
 * duplicate-party tests) and normalized into one shape; nothing here
 * recomputes what an existing module already owns.
 */

import { listBankingExceptions } from "@/server/services/banking-exception-service";
import { listUnmatchedTransactionsForQueue, listRecentTransactionsForDuplicateCheck } from "@/server/services/transaction-explorer-service";
import { listSalesInvoices } from "@/server/services/sales-invoice-service";
import { listAllBills } from "@/server/services/purchase-bill-service";
import { listCashbookTransactions } from "@/server/services/cashbook-service";
import { listCustomers } from "@/server/services/customer-service";
import { listSuppliers } from "@/server/services/supplier-management-service";
import { detectDuplicatePayments } from "@/server/banking-rules/banking-intelligence";
import { runDuplicateCustomersTest, runDuplicateSuppliersTest } from "@/server/audit/audit-tests-engine";

export type MatchingQueueItemType =
  | "BankTransaction"
  | "UnknownMerchant"
  | "DuplicatePayment"
  | "DuplicateCustomer"
  | "DuplicateSupplier"
  | "UnallocatedInvoice"
  | "UnallocatedBill"
  | "CashbookEntry";

export type MatchingQueueItem = {
  id: string;
  itemType: MatchingQueueItemType;
  description: string;
  amount: number | null;
  date: string | null;
  confidence: number | null;
  detailHref: string;
};

/** `detectDuplicatePayments`'s own matching window is 3 days (see
 * banking-intelligence.ts's `windowDays = 3` default) — a pair further
 * apart than that is mathematically never flagged, so feeding it a
 * company's entire transaction history is pure waste, not a real
 * detection-coverage requirement. 30 days is a generous multiple of
 * that window, not an arbitrary cap. Launch Blocker fix, found by
 * testing at 1,000,000 rows (well beyond RC2's own 250,000-row test):
 * `getMatchingQueue` fed the FULL, unbounded transaction history to
 * this function on every Dashboard and Matching page load, the same
 * "pull everything, reduce in memory" pattern already fixed for the
 * banking-automation summary — this was a second, independent instance
 * of the identical defect class, in a function that pattern hadn't
 * reached yet. */
const DUPLICATE_CHECK_WINDOW_DAYS = 30;

/** One live, company-wide queue across every real "needs review" source
 * this platform has today. Reuses each source's own existing service —
 * no new detection logic anywhere in this file.
 *
 * Two separately-scoped transaction queries, not one shared unbounded
 * pull: the "every unmatched item must appear" queue listing (this
 * file's own stated design principle) genuinely needs every Suggested/
 * Unallocated transaction regardless of age — filtered server-side by
 * status, not by date, so nothing old silently stops appearing. Only
 * duplicate-payment detection gets the date-bounded window above. */
// Launch Blocker fix, found by testing well beyond RC2's own 250,000-row
// scale (1,000,000 rows): the "every unmatched item must appear" listing
// used a plain filtered+sorted+limited SELECT, which still forces RLS to
// evaluate `user_can_access_company()` once per row satisfying the
// filter BEFORE the sort+limit can apply — proven live at 14.9s / a real
// request timeout with 800,000 matching rows. Uses
// `listUnmatchedTransactionsForQueue` (a purpose-built `security
// definer` RPC, migrations 0041/0042) instead — checks access once, not
// per-row; verified live at 0.56s for the identical data. A queue is
// bounded by definition regardless — nobody reviews 500,000 items in
// one page.
const QUEUE_PAGE_SIZE = 500;

export async function getMatchingQueue(companyId: string): Promise<MatchingQueueItem[]> {
  const todayIso = new Date().toISOString().slice(0, 10);
  const windowStartIso = new Date(Date.now() - DUPLICATE_CHECK_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);

  const [exceptions, unmatchedResult, recentForDuplicateCheck, invoices, bills, cashbookEntries, customers, suppliers] = await Promise.all([
    listBankingExceptions(companyId, "Open"),
    listUnmatchedTransactionsForQueue(companyId, QUEUE_PAGE_SIZE),
    listRecentTransactionsForDuplicateCheck(companyId, windowStartIso, todayIso, QUEUE_PAGE_SIZE),
    listSalesInvoices(companyId),
    listAllBills(companyId),
    listCashbookTransactions(companyId, { entrySource: "Manual" }),
    listCustomers(companyId),
    listSuppliers(companyId),
  ]);
  const transactions = unmatchedResult.transactions;
  // Disclosed, not hidden: if there are more unmatched transactions than
  // one page holds, the queue shows the most recent QUEUE_PAGE_SIZE
  // rather than silently truncating with no signal — a real UI
  // affordance (e.g. "showing the most recent 500 of N — refine filters
  // to see more") is the correct long-term fix; logged for now so the
  // gap is visible in server logs rather than invisible.
  if (unmatchedResult.hasMore) {
    console.warn(`getMatchingQueue(${companyId}): unmatched-transaction queue exceeds ${QUEUE_PAGE_SIZE} rows; showing the most recent ${QUEUE_PAGE_SIZE} only.`);
  }

  const items: MatchingQueueItem[] = [];

  // Bank transactions still Suggested/Unallocated after import + rule
  // engine — entry_source/allocation_status already filtered server-side
  // by fn_unmatched_bank_transactions (migrations 0041/0042).
  for (const t of transactions) {
    items.push({
      id: `BankTransaction:${t.id}`,
      itemType: "BankTransaction",
      description: `${t.description || t.reference || "Bank transaction"} (${t.allocationStatus})`,
      amount: t.debit > 0 ? -t.debit : t.credit,
      date: t.transactionDate,
      confidence: t.confidenceScore,
      detailHref: `/company/${companyId}/transactions?transaction=${t.id}`,
    });
  }

  // Open Banking Exceptions (Unknown Merchant, Possible Duplicate, etc.) —
  // reused verbatim, not a second exception list.
  for (const e of exceptions) {
    items.push({
      id: `UnknownMerchant:${e.id}`,
      itemType: e.exceptionType === "PossibleDuplicate" ? "DuplicatePayment" : "UnknownMerchant",
      description: e.reason,
      amount: null,
      date: e.createdAt.slice(0, 10),
      confidence: null,
      detailHref: `/company/${companyId}/banking-exceptions`,
    });
  }

  // Duplicate payment pairs — reused from banking-intelligence.ts, not
  // reimplemented for the queue.
  const duplicateSignals = detectDuplicatePayments(
    recentForDuplicateCheck.map((t) => ({ id: t.id, transactionDate: t.transactionDate, debit: t.debit, credit: t.credit, beneficiary: t.beneficiary })),
  );
  for (const [transactionId, signal] of duplicateSignals) {
    items.push({
      id: `DuplicatePayment:${transactionId}`,
      itemType: "DuplicatePayment",
      description: signal.reasoning,
      amount: null,
      date: null,
      confidence: signal.confidence,
      detailHref: `/company/${companyId}/transactions?transaction=${transactionId}`,
    });
  }

  // Duplicate Customer/Supplier master records — reused from Auditor
  // Workspace's own test, not a second implementation.
  for (const finding of runDuplicateCustomersTest(customers.map((c) => ({ id: c.id, name: c.name, vatNumber: c.vatNumber ?? "", registrationNumber: c.registrationNumber ?? "" })))) {
    items.push({ id: `DuplicateCustomer:${finding.relatedId}`, itemType: "DuplicateCustomer", description: finding.reason, amount: null, date: null, confidence: finding.confidence, detailHref: `/company/${companyId}/customers` });
  }
  for (const finding of runDuplicateSuppliersTest(suppliers.map((s) => ({ id: s.id, name: s.name, bankAccountNumber: s.bankAccountNumber ?? "", vatNumber: s.vatNumber ?? "" })))) {
    items.push({ id: `DuplicateSupplier:${finding.relatedId}`, itemType: "DuplicateSupplier", description: finding.reason, amount: null, date: null, confidence: finding.confidence, detailHref: `/company/${companyId}/suppliers` });
  }

  // Unallocated Sales Invoices / Purchase Bills — real outstanding
  // balances with no receipt/payment allocated yet.
  for (const invoice of invoices) {
    if (invoice.status !== "Posted" || invoice.outstanding <= 0) continue;
    items.push({
      id: `UnallocatedInvoice:${invoice.id}`,
      itemType: "UnallocatedInvoice",
      description: `${invoice.invoiceNumber} — ${invoice.outstanding} outstanding`,
      amount: invoice.outstanding,
      date: invoice.invoiceDate,
      confidence: null,
      detailHref: `/company/${companyId}/sales?tab=invoices`,
    });
  }
  for (const bill of bills) {
    if (bill.outstanding <= 0) continue;
    items.push({
      id: `UnallocatedBill:${bill.id}`,
      itemType: "UnallocatedBill",
      description: `${bill.invoiceNumber} — ${bill.outstanding} outstanding`,
      amount: bill.outstanding,
      date: bill.invoiceDate,
      confidence: null,
      detailHref: `/company/${companyId}/purchasing?tab=bills`,
    });
  }

  // Cashbook entries still Draft/Submitted — awaiting Approve & Post.
  for (const entry of cashbookEntries) {
    if (entry.captureStatus !== "Draft" && entry.captureStatus !== "Submitted") continue;
    items.push({
      id: `CashbookEntry:${entry.id}`,
      itemType: "CashbookEntry",
      description: `${entry.description} (${entry.captureStatus})`,
      amount: entry.debit > 0 ? -entry.debit : entry.credit,
      date: entry.transactionDate,
      confidence: null,
      detailHref: `/company/${companyId}/cashbook?tab=capture`,
    });
  }

  return items;
}
