/**
 * SD-3D — builds the reconciliation engine's input from the supplier's
 * records, with EXACTLY the supplier ledger's rules (`party-ledger.ts`):
 *
 *   posted Bill / Debit Note  +total     posted Credit Note  −total
 *   posted Supplier Payment   −amount    posted bank "S" row  credit − debit
 *   posted opening balance    −amount
 *
 * and then CHECKS itself against the ledger: the records' balance at the
 * statement date must equal `balancesAt(buildSupplierLedger(...))` for the
 * supplier, to the cent, or the run is refused. The supplier ledger is the
 * authority; this never disagrees with it silently.
 *
 * Records NOT in the ledger are passed separately (never in P):
 *   captured-draft       a capture still in the workflow, or the draft a
 *                        capture was converted to;
 *   imported-not-posted  any other unposted bill — Import Centre, or a
 *                        Purchasing draft (Xero-migrated or entered by hand;
 *                        the data does not distinguish the two).
 * Bank postings without the posted flag are not ledger entries and are not
 * read (they remain unexplained, owner decision).
 *
 * Pure.
 */
import { balancesAt, buildSupplierLedger, isPostedBill } from "@/server/report-centre/party-ledger";
import type { SupplierSources, CaptureRef } from "@/server/repositories/supplier-statement-reconciliation-repository";
import type { LedgerRecord, UnpostedRecord } from "./reconciliation-engine";

export class LedgerMismatchError extends Error {}

const cents = (v: number) => Math.round(v * 100);

/** Capture statuses still in the workflow (not converted, rejected or a
 * blocked duplicate copy). */
const CAPTURE_IN_WORKFLOW = new Set(["Uploaded", "Queued", "Extracting", "NeedsReview", "ManualEntry", "Failed"]);

export function buildLedgerRecords(sources: SupplierSources, supplierId: number, asAt: string): LedgerRecord[] {
  const records: LedgerRecord[] = [];
  for (const ob of sources.openingBalances) {
    if (ob.category !== "Supplier" || ob.status !== "posted" || ob.supplierId !== supplierId) continue;
    records.push({ refType: "opening-balance", refId: ob.id, date: ob.balanceDate, number: ob.reference ?? "", evidence: ob.description ?? "", amount: -ob.amount });
  }
  for (const bill of sources.bills) {
    if (!isPostedBill(bill) || bill.supplierId !== supplierId || !bill.invoiceDate) continue;
    const refType = bill.documentType === "Credit Note" ? "credit-note" : bill.documentType === "Debit Note" ? "debit-note" : "bill";
    const sign = bill.documentType === "Credit Note" ? -1 : 1;
    records.push({ refType, refId: bill.id, date: bill.invoiceDate, number: bill.invoiceNumber ?? "", evidence: "", amount: sign * bill.total });
  }
  for (const p of sources.payments) {
    if (p.status !== "Posted" || p.supplierId !== supplierId) continue;
    records.push({
      refType: "supplier-payment",
      refId: p.id,
      date: p.paymentDate,
      number: p.paymentNumber || p.reference || "",
      evidence: [p.paymentNumber, p.reference, p.notes].filter(Boolean).join(" "),
      amount: -p.amount,
    });
  }
  for (const t of sources.bankTransactions) {
    if (!t.postedFlag || t.allocationType !== "S" || t.matchedSupplierId !== supplierId || !t.transactionDate) continue;
    records.push({
      refType: "bank-transaction",
      refId: t.id,
      date: t.transactionDate,
      number: t.reference ?? "",
      evidence: [t.reference, t.description].filter(Boolean).join(" "),
      amount: t.credit - t.debit,
    });
  }
  records.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.refType < b.refType ? -1 : a.refType > b.refType ? 1 : a.refId - b.refId));

  // The authority: the supplier ledger itself.
  const ledgerBalance = cents(balancesAt(buildSupplierLedger(sources), asAt).get(supplierId) ?? 0);
  const recordsBalance = records.filter((r) => r.date <= asAt).reduce((s, r) => s + cents(r.amount), 0);
  if (ledgerBalance !== recordsBalance) {
    throw new LedgerMismatchError(
      `The reconciliation records (${recordsBalance / 100}) do not agree with the supplier ledger (${ledgerBalance / 100}); the run was refused.`,
    );
  }
  return records;
}

export function buildUnpostedRecords(
  sources: SupplierSources,
  captures: CaptureRef[],
  captureBillIds: ReadonlySet<number>,
  supplierId: number,
): UnpostedRecord[] {
  const out: UnpostedRecord[] = [];
  for (const bill of sources.bills) {
    if (bill.supplierId !== supplierId || isPostedBill(bill) || bill.postingStatus === "Cancelled") continue;
    const sign = bill.documentType === "Credit Note" ? -1 : 1;
    const fromCapture = captureBillIds.has(bill.id);
    out.push({
      refType: "unposted-bill",
      refId: bill.id,
      number: bill.invoiceNumber || null,
      date: bill.invoiceDate,
      amount: sign * bill.total,
      documentType: bill.documentType,
      kind: fromCapture ? "captured-draft" : "imported-not-posted",
      source: fromCapture
        ? `draft bill #${bill.id} created from a captured invoice, not posted`
        : bill.origin === "Imported"
          ? `Import Centre bill #${bill.id}, no journal`
          : `Purchasing ${bill.postingStatus ?? "draft"} bill #${bill.id}, no journal (Xero-migrated or entered by hand)`,
    });
  }
  for (const c of captures) {
    if (c.supplier_id !== supplierId || !CAPTURE_IN_WORKFLOW.has(c.status) || !c.invoice_number) continue;
    const credit = c.document_type === "Credit Note";
    const total = c.total === null ? null : Number(c.total);
    out.push({
      refType: "capture",
      refId: c.id,
      number: c.invoice_number,
      date: c.invoice_date,
      amount: total === null || !Number.isFinite(total) ? null : (credit ? -1 : 1) * total,
      documentType: credit ? "Credit Note" : c.document_type === "Debit Note" ? "Debit Note" : c.document_type === "Invoice" ? "Bill" : null,
      kind: "captured-draft",
      source: `Supplier Documents capture #${c.id} (${c.status})`,
    });
  }
  return out;
}
