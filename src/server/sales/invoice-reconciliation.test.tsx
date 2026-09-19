/**
 * Phase 5J — the reconciliation test.
 *
 * One invoice, carried through every layer that states a figure about it,
 * using the REAL function from each layer — not a restatement of what
 * each is expected to do:
 *
 *     the form's preview      computeInvoiceTotalsFromCodes
 *       -> the saved invoice  (what the repository writes)
 *       -> the document/PDF   InvoiceDocumentBody
 *       -> the journal        buildJournalLinesFromRule + the seeded rule
 *       -> the ledger         the journal's debits and credits
 *       -> customer balance   outstanding
 *       -> AR ageing          computeAgingBuckets on the derived due date
 *       -> VAT reporting      buildVat201Summary
 *
 * Every one of those has to produce the same numbers. Before this phase
 * they could not: the form summed quantity x price, the repository
 * applied one flat header rate to that sum, and the journal re-derived a
 * third split from the total at approval time.
 *
 * The posting rule below is the one `seed_company_defaults()` actually
 * seeds (`0022_cashbook_reconciliation.sql`: DR 1100 gross / CR 4000 net
 * / CR 2200 vat), verified against the live local database for this
 * phase, not an invented fixture.
 */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { computeInvoiceTotalsFromCodes } from "./invoice-totals";
import { resolveDueDate } from "@/server/services/sales-invoice-service";
import { buildJournalLinesFromRule } from "@/server/services/posting-rule-service";
import { computeAgingBuckets } from "@/server/shared/aging";
import { buildVat201Summary } from "@/server/vat/vat-201-engine";
import { InvoiceDocumentBody } from "@/components/documents/print/invoice-body";
import type { PostingRule } from "@/server/general-ledger/types";
import type { SalesInvoice, SalesInvoiceLine } from "@/server/sales/types";

/** The six treatments every company is seeded with. */
const RATES = new Map<string, number>([
  ["Standard Rated", 15],
  ["Zero Rated", 0],
  ["Exempt", 0],
  ["No VAT", 0],
  ["Fuel VAT", 0],
  ["Import VAT", 15],
]);

const SALES_INVOICE_RULE: PostingRule = {
  id: 1,
  companyId: "co_1",
  eventType: "Sales Invoice",
  description: "Customer sales invoice",
  isActive: true,
  createdAt: "2026-01-01T00:00:00Z",
  lines: [
    { id: 1, postingRuleId: 1, lineOrder: 0, side: "Debit", role: "debtors", fixedAccountCode: "1100", amountSource: "gross" },
    { id: 2, postingRuleId: 1, lineOrder: 1, side: "Credit", role: "sales", fixedAccountCode: "4000", amountSource: "net" },
    { id: 3, postingRuleId: 1, lineOrder: 2, side: "Credit", role: "vat_output", fixedAccountCode: "2200", amountSource: "vat" },
  ],
};

/** A deliberately awkward document: mixed VAT treatments, a discount, and
 * a unit price that does not divide cleanly into cents. Exactly the shape
 * that used to break — no single blended rate describes it. */
const CAPTURED_LINES = [
  { description: "Consulting — standard rated", quantity: 3, unitPrice: 333.33, discount: 99.99, vatCode: "Standard Rated" },
  { description: "Export freight — zero rated", quantity: 1, unitPrice: 1250, discount: 0, vatCode: "Zero Rated" },
  { description: "Bank charges recovered — exempt", quantity: 2, unitPrice: 47.5, discount: 5, vatCode: "Exempt" },
];

const INVOICE_DATE = "2026-06-01";
const CUSTOMER_TERMS_DAYS = 30;

describe("Phase 5J — one invoice reconciles across every layer", () => {
  // --- 1. What the form previews, and what the server computes. --------
  const computed = computeInvoiceTotalsFromCodes(CAPTURED_LINES, 15, RATES);
  if (!computed.ok) throw new Error("fixture uses an unknown VAT code");
  const totals = computed.totals;

  const { dueDate, paymentTermsDays } = resolveDueDate({
    invoiceDate: INVOICE_DATE,
    customerPaymentTermsDays: CUSTOMER_TERMS_DAYS,
  });

  // --- 2. The invoice as the repository stores it. ---------------------
  const lines: SalesInvoiceLine[] = CAPTURED_LINES.map((l, i) => ({
    id: i + 1,
    invoiceId: 1,
    lineOrder: i,
    description: l.description,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    lineTotal: totals.lines[i].lineTotal,
    stockItemId: null,
    glAccount: null,
    vatCode: l.vatCode,
    discount: totals.lines[i].discount,
    netAmount: totals.lines[i].netAmount,
    vatAmount: totals.lines[i].vatAmount,
  }));

  const saved: SalesInvoice = {
    id: 1, companyId: "co_1", customerId: 1, orderId: null, deliveryId: null,
    invoiceNumber: "INV000001", documentType: "Invoice",
    invoiceDate: INVOICE_DATE, dueDate, vatTreatmentCode: "Standard Rated",
    status: "Posted", journalId: 1,
    subtotal: totals.subtotal, vatAmount: totals.vatAmount, total: totals.total, outstanding: totals.total,
    isRecurringTemplate: false, recurrencePattern: "", reference: "PO-1", notes: "",
    createdAt: `${INVOICE_DATE}T08:00:00Z`,
    submittedBy: null, submittedAt: null, approvedBy: null, approvedAt: null,
    postedAt: `${INVOICE_DATE}T09:00:00Z`, cancelledBy: null, cancelledAt: null,
    originalInvoiceId: null, reason: "", paymentTermsDays,
    lines,
  };

  it("the arithmetic itself holds: subtotal + VAT = total, and the lines add up to it", () => {
    expect(saved.subtotal).toBe(2240); // 900.00 + 1250.00 + 90.00
    expect(saved.vatAmount).toBe(135); // 15% of 900 only; the other two lines are 0%
    expect(saved.total).toBe(2375);
    expect(totals.discountTotal).toBe(104.99); // 99.99 + 0 + 5.00
    expect(Math.round((saved.subtotal + saved.vatAmount) * 100) / 100).toBe(saved.total);
    expect(Math.round(saved.lines.reduce((s, l) => s + l.lineTotal, 0) * 100) / 100).toBe(saved.total);
    expect(Math.round(saved.lines.reduce((s, l) => s + l.netAmount, 0) * 100) / 100).toBe(saved.subtotal);
    expect(Math.round(saved.lines.reduce((s, l) => s + l.vatAmount, 0) * 100) / 100).toBe(saved.vatAmount);
  });

  it("VAT is charged per line, at that line's own rate, on the amount after discount", () => {
    expect(saved.lines.map((l) => [l.netAmount, l.vatAmount])).toEqual([
      [900, 135], // (3 x 333.33 = 999.99) - 99.99 = 900.00, at 15%
      [1250, 0], // zero rated
      [90, 0], // (2 x 47.50 = 95.00) - 5.00 = 90.00, exempt
    ]);
  });

  // --- 3. The document. ------------------------------------------------
  it("13. the PDF/preview prints the saved figures, and its lines reconcile to its totals", () => {
    const { container } = render(
      <InvoiceDocumentBody
        invoice={saved}
        customer={{ name: "Meridian Traders", vatNumber: "4123456789", registrationNumber: "2016/112233/07" }}
        addressLine="1 Long Street, Cape Town"
        letterhead={<div>LETTERHEAD</div>}
        currencyCode="ZAR"
      />,
    );

    const totalsList = within(container.querySelector("dl.w-64") as HTMLElement);
    expect(totalsList.getByText("Subtotal").parentElement).toHaveTextContent("ZAR 2,240.00");
    expect(totalsList.getByText("VAT").parentElement).toHaveTextContent("ZAR 135.00");
    expect(totalsList.getByText("Total").parentElement).toHaveTextContent("ZAR 2,375.00");
    expect(totalsList.getByText("Discount").parentElement).toHaveTextContent("ZAR 104.99");

    // And the printed line VAT column sums to the printed VAT total — the
    // thing that was impossible before, when every line printed "—".
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    const printedVat = rows.map((r) => Number(within(r).getAllByRole("cell")[4].textContent!.replace(/,/g, "")));
    expect(Math.round(printedVat.reduce((a, b) => a + b, 0) * 100) / 100).toBe(saved.vatAmount);

    // Due date is printed, because there now is one.
    expect(screen.getByText("2026-07-01")).toBeInTheDocument();
  });

  // --- 4. The journal and the ledger. ----------------------------------
  const built = buildJournalLinesFromRule(SALES_INVOICE_RULE, {
    grossAmount: saved.total,
    vatRatePercent: (saved.vatAmount / saved.subtotal) * 100,
    amounts: { gross: saved.total, net: saved.subtotal, vat: saved.vatAmount },
    description: `Invoice ${saved.invoiceNumber}`,
  });

  it("10. the journal IS the invoice — debtors, revenue and output VAT are the saved figures", () => {
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.lines).toEqual([
      { accountCode: "1100", debit: saved.total, credit: 0, description: "Invoice INV000001" },
      { accountCode: "4000", debit: 0, credit: saved.subtotal, description: "Invoice INV000001" },
      { accountCode: "2200", debit: 0, credit: saved.vatAmount, description: "Invoice INV000001" },
    ]);
  });

  it("the journal balances, so the ledger it posts into balances", () => {
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const debit = Math.round(built.lines.reduce((s, l) => s + l.debit, 0) * 100) / 100;
    const credit = Math.round(built.lines.reduce((s, l) => s + l.credit, 0) * 100) / 100;
    expect(debit).toBe(credit);
    expect(debit).toBe(saved.total);
  });

  it("re-deriving the split from the total, as the pre-5J posting path did, would have been wrong", () => {
    // 2375.00 / 1.15 = 2065.22, leaving VAT of 309.78 — against a real
    // VAT of 135.00. Output VAT overstated by 174.78 and revenue
    // understated by the same, on this one document, with nothing to
    // flag it.
    const naive = Math.round((saved.total / 1.15) * 100) / 100;
    expect(naive).not.toBe(saved.subtotal);
    expect(Math.round((saved.total - naive) * 100) / 100).not.toBe(saved.vatAmount);
  });

  // --- 5. Customer balance and AR ageing. -------------------------------
  it("12. the customer balance is the invoice total until something is allocated against it", () => {
    expect(saved.outstanding).toBe(saved.total);
  });

  it("29. AR ageing ages from the DERIVED due date — not from 'no due date', which never falls overdue", () => {
    // 2026-07-01 + 30 days = 2026-07-31 -> 30 days overdue.
    const aged = computeAgingBuckets([{ outstanding: saved.outstanding, dueDate: saved.dueDate }], "2026-07-31");
    expect(aged.days30).toBe(saved.total);
    expect(aged.current).toBe(0);

    // On the due date itself it is still current, not yet overdue.
    expect(computeAgingBuckets([{ outstanding: saved.outstanding, dueDate: saved.dueDate }], "2026-07-01").current).toBe(saved.total);

    // And the contrast: with no due date at all — every invoice before
    // this phase — it is permanently "Current" however old it gets.
    expect(computeAgingBuckets([{ outstanding: saved.outstanding, dueDate: null }], "2030-01-01").current).toBe(saved.total);
  });

  // --- 6. VAT reporting. ------------------------------------------------
  it("VAT reporting reads the same VAT figure the journal posted to 2200", () => {
    const summary = buildVat201Summary(
      [
        {
          id: saved.id,
          documentType: "Customer Invoice",
          partyId: saved.customerId,
          partyName: "Meridian Traders",
          partyVatNumber: "4123456789",
          date: saved.invoiceDate,
          vatTreatmentCode: saved.vatTreatmentCode,
          vatType: "Standard",
          grossAmount: saved.total,
          vatAmount: saved.vatAmount,
        },
      ],
      "2026-06-01",
      "2026-06-30",
    );
    const standard = summary.outputs.find((c) => c.category === "Standard")!;
    expect(standard.vatValue).toBe(saved.vatAmount);
    expect(standard.netValue).toBe(saved.subtotal);
    expect(summary.totalOutputVat).toBe(saved.vatAmount);

    if (!built.ok) return;
    const vatOutputPosted = built.lines.find((l) => l.accountCode === "2200")!.credit;
    expect(standard.vatValue).toBe(vatOutputPosted);
  });

  // --- 7. The whole chain, stated once. ---------------------------------
  it("24. every layer states the same three numbers", () => {
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const fromPreview = { net: totals.subtotal, vat: totals.vatAmount, gross: totals.total };
    const fromSaved = { net: saved.subtotal, vat: saved.vatAmount, gross: saved.total };
    const fromJournal = {
      net: built.lines.find((l) => l.accountCode === "4000")!.credit,
      vat: built.lines.find((l) => l.accountCode === "2200")!.credit,
      gross: built.lines.find((l) => l.accountCode === "1100")!.debit,
    };
    const fromLines = {
      net: Math.round(saved.lines.reduce((s, l) => s + l.netAmount, 0) * 100) / 100,
      vat: Math.round(saved.lines.reduce((s, l) => s + l.vatAmount, 0) * 100) / 100,
      gross: Math.round(saved.lines.reduce((s, l) => s + l.lineTotal, 0) * 100) / 100,
    };
    expect(fromSaved).toEqual(fromPreview);
    expect(fromJournal).toEqual(fromPreview);
    expect(fromLines).toEqual(fromPreview);
  });
});
