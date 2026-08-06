/**
 * Service layer for Supplier Bills entered through the Purchasing
 * workflow (Invoice/Credit Note/Debit Note — reusing `ImportedBill`'s
 * `documentType`, see `purchase-bill-repository.ts`'s module docstring
 * for why this is the same table Import Centre uses, not a new one).
 * The real integration point the Purchasing Platform exists for:
 * approving one of these resolves the matching seeded Posting Rule
 * ('Supplier Invoice'/'Supplier Credit Note', seeded in
 * 0007_general_ledger.sql) into a real journal, which flows through the
 * one Posting Engine — exactly mirroring
 * `sales-invoice-service.ts::approveAndPostInvoice`.
 *
 * A Debit Note reuses the 'Supplier Invoice' rule (identical DR
 * Purchases/DR VAT Input/CR Creditors shape) — no separate rule exists
 * or is needed, same as Sales' own Debit Notes.
 *
 * The bill's existing `vat_code` column (previously unused free text) is
 * repurposed to hold the VAT Treatment *code* actually used at creation,
 * so the exact rate can be re-resolved at approval time without adding a
 * new column — reusing what's real rather than duplicating it.
 */

import * as repo from "@/server/repositories/purchase-bill-repository";
import * as journalRepo from "@/server/repositories/journal-repository";
import * as orderRepo from "@/server/repositories/purchase-order-repository";
import * as postingRuleRepo from "@/server/repositories/posting-rule-repository";
import { listAllBills as listAllBillsRepo } from "@/server/repositories/supplier-reconciliation-repository";
import { getSupplier } from "@/server/services/supplier-management-service";
import { buildJournalFromEvent, type BuildJournalLinesResult } from "@/server/services/posting-rule-service";
import { postApprovedJournals } from "@/server/services/posting-engine-service";
import { listVatTreatments } from "@/server/services/vat-treatment-service";
import type { NewJournalLine } from "@/server/repositories/journal-repository";
import type { PostingRuleAmountSource } from "@/server/general-ledger/types";
import { computeLineAmounts } from "@/server/purchasing/line-amounts";
import type { BillPostingStatus, ImportedBill, PurchaseBillLine } from "@/server/accounting/types";
import type { VatTreatment } from "@/server/company-management/types";

/** Every bill company-wide, regardless of `origin` — Supplier Payments'
 * allocation UI needs the full set (imported or Purchasing-entered) to
 * let a payment settle any outstanding bill. Thin re-export of the
 * existing Supplier Reconciliation repository query — not a duplicated
 * data source. */
export const listAllBills = listAllBillsRepo;

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

const EVENT_TYPE_BY_DOCUMENT: Record<ImportedBill["documentType"], string> = {
  Bill: "Supplier Invoice",
  "Debit Note": "Supplier Invoice",
  "Credit Note": "Supplier Credit Note",
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** One line of a Purchases-entered Bill/Credit Note/Debit Note —
 * "Additional Requirement: Purchase Processing." `costCentreId`/
 * `projectId`/`departmentId` are all optional ("where applicable", per
 * the Board's own wording — not every line needs every dimension). */
export type BillLineInput = {
  description: string;
  glAccount: string;
  vatCode: string;
  costCentreId?: number | null;
  projectId?: number | null;
  departmentId?: number | null;
  quantity: number;
  unitCost: number;
  discount?: number;
};

export type CreatePurchaseBillInput = {
  supplierId: number;
  invoiceNumber: string;
  documentType?: ImportedBill["documentType"];
  invoiceDate: string;
  dueDate?: string | null;
  purchaseOrderId?: number | null;
  goodsReceivedNoteId?: number | null;
  /** Legacy single-amount path — still used by `createBillFromOrder`
   * and any caller that hasn't moved to line capture. */
  glAccount?: string | null;
  vatTreatmentCode?: string;
  subtotal?: number;
  /** New multi-line path — when present and non-empty, this is used
   * instead of `vatTreatmentCode`/`subtotal`/`glAccount` and the header
   * VAT/total become a real roll-up of the lines. */
  lines?: BillLineInput[];
};

export function validateBillInput(input: Pick<CreatePurchaseBillInput, "supplierId" | "invoiceNumber" | "invoiceDate" | "vatTreatmentCode" | "subtotal">): void {
  if (!input.supplierId) throw new ValidationError("Supplier is required.");
  if (!input.invoiceNumber?.trim()) throw new ValidationError("Invoice number is required.");
  if (!input.invoiceDate) throw new ValidationError("Invoice date is required.");
  if (!input.vatTreatmentCode) throw new ValidationError("VAT Treatment is required.");
  if (!input.subtotal || input.subtotal <= 0) throw new ValidationError("Amount must be greater than zero.");
}

export const listPurchaseBills = repo.listPurchaseBills;
export const listPurchaseBillsBySupplier = repo.listPurchaseBillsBySupplier;
export const getPurchaseBill = repo.getPurchaseBill;
export const listBillLines = repo.listPurchaseBillLines;

export type ComputedBillLine = BillLineInput & { discount: number; netAmount: number; vatAmount: number; lineTotal: number };

/** Pure — exported for direct unit testing, same convention this
 * codebase uses for every other double-entry-adjacent arithmetic core
 * (`splitGrossAmount`, `buildJournalLinesFromRule`). The actual net/VAT
 * math is `computeLineAmounts` (`purchasing/line-amounts.ts`), shared
 * with Purchase Orders — this wraps it with Bill-specific validation. */
export function computeBillLine(line: BillLineInput, vatRatePercent: number): ComputedBillLine {
  if (!line.glAccount?.trim()) throw new ValidationError("Every line needs a GL account.");
  if (!line.quantity || line.quantity <= 0) throw new ValidationError(`Line "${line.description || line.glAccount}" needs a quantity greater than zero.`);
  const discount = line.discount ?? 0;
  const { netAmount, vatAmount, lineTotal } = computeLineAmounts(line.quantity, line.unitCost, discount, vatRatePercent);
  if (netAmount <= 0) throw new ValidationError(`Line "${line.description || line.glAccount}" must have a positive net amount.`);
  return { ...line, discount, netAmount, vatAmount, lineTotal };
}

/** Shared between `createPurchaseBill` and `updateBillLines` — computes
 * every line, the header roll-up totals, and the header
 * `glAccount`/`vatCode` summary (a real value when every line agrees,
 * an honest "(Multiple)" placeholder otherwise — never fabricated to
 * look like a single value). */
function summarizeBillLines(lines: BillLineInput[], vatTreatments: VatTreatment[]) {
  const computedLines = lines.map((line) => {
    if (!line.vatCode) throw new ValidationError("Every line needs a VAT code.");
    const treatment = vatTreatments.find((t) => t.code === line.vatCode);
    if (!treatment) throw new ValidationError(`Unknown VAT treatment "${line.vatCode}".`);
    return computeBillLine(line, treatment.rate);
  });

  const subtotal = round2(computedLines.reduce((sum, l) => sum + l.netAmount, 0));
  const vat = round2(computedLines.reduce((sum, l) => sum + l.vatAmount, 0));
  const total = round2(subtotal + vat);
  const distinctAccounts = [...new Set(computedLines.map((l) => l.glAccount))];
  const distinctVatCodes = [...new Set(computedLines.map((l) => l.vatCode))];

  return {
    subtotal,
    vat,
    total,
    glAccount: distinctAccounts.length === 1 ? distinctAccounts[0] : "(Multiple)",
    vatCode: distinctVatCodes.length === 1 ? distinctVatCodes[0] : "(Multiple)",
    repoLines: computedLines.map((l) => ({
      description: l.description,
      glAccount: l.glAccount,
      vatCode: l.vatCode,
      costCentreId: l.costCentreId ?? null,
      projectId: l.projectId ?? null,
      departmentId: l.departmentId ?? null,
      quantity: l.quantity,
      unitCost: l.unitCost,
      discount: l.discount,
      netAmount: l.netAmount,
      vatAmount: l.vatAmount,
      lineTotal: l.lineTotal,
    })),
  };
}

export async function createPurchaseBill(companyId: string, input: CreatePurchaseBillInput): Promise<ImportedBill> {
  if (!input.supplierId) throw new ValidationError("Supplier is required.");
  if (!input.invoiceNumber?.trim()) throw new ValidationError("Invoice number is required.");
  if (!input.invoiceDate) throw new ValidationError("Invoice date is required.");

  const supplier = await getSupplier(companyId, input.supplierId);
  if (!supplier) throw new ValidationError(`No supplier with id ${input.supplierId}.`);

  const vatTreatments = await listVatTreatments(companyId);

  if (input.lines && input.lines.length > 0) {
    const summary = summarizeBillLines(input.lines, vatTreatments);
    const { bill } = await repo.createPurchaseBillWithLines(
      companyId,
      {
        supplierId: input.supplierId,
        supplierName: supplier.name,
        invoiceNumber: input.invoiceNumber,
        documentType: input.documentType,
        invoiceDate: input.invoiceDate,
        dueDate: input.dueDate,
        purchaseOrderId: input.purchaseOrderId,
        goodsReceivedNoteId: input.goodsReceivedNoteId,
        glAccount: summary.glAccount,
        vatCode: summary.vatCode,
      },
      summary.vat,
      summary.total,
      summary.repoLines,
    );
    return bill;
  }

  // Legacy single-amount path — unchanged behaviour for every existing caller.
  validateBillInput(input as Required<Pick<CreatePurchaseBillInput, "vatTreatmentCode" | "subtotal">> & CreatePurchaseBillInput);
  const treatment = vatTreatments.find((t) => t.code === input.vatTreatmentCode);
  if (!treatment) throw new ValidationError(`Unknown VAT treatment "${input.vatTreatmentCode}".`);

  return repo.createPurchaseBill(
    companyId,
    { ...input, supplierName: supplier.name, vatCode: treatment.code },
    input.subtotal!,
    treatment.rate,
  );
}

/** Product Review Board certification — "Correct editing." Only a Draft
 * bill can be edited: once Submitted it's in the approval workflow, and
 * once Approved/Posted a real journal (and possibly a payment
 * allocation) already exists against it — editing those would silently
 * desynchronise the GL from what the accountant sees, exactly the
 * failure mode this codebase's posted-history-is-immutable rule exists
 * to prevent everywhere else. Replaces the whole line set (see
 * `replacePurchaseBillLines`'s own comment for why that's safe for a
 * Draft) and recomputes the header roll-up from scratch — never a
 * partial patch that could drift from the lines' own real totals. */
export async function updateBillLines(companyId: string, billId: number, lines: BillLineInput[]): Promise<ImportedBill> {
  const bill = await requireBill(companyId, billId);
  const status = requirePostingStatus(bill);
  if (status !== "Draft") {
    throw new ValidationError(`Only a Draft ${bill.documentType.toLowerCase()} can be edited (current status: ${status}).`);
  }
  if (lines.length === 0) throw new ValidationError("A bill needs at least one line.");

  const vatTreatments = await listVatTreatments(companyId);
  const summary = summarizeBillLines(lines, vatTreatments);

  const { bill: updated } = await repo.replacePurchaseBillLines(
    companyId,
    billId,
    { vat: summary.vat, total: summary.total, glAccount: summary.glAccount, vatCode: summary.vatCode },
    summary.repoLines,
  );
  return updated;
}

const ALLOWED_TRANSITIONS: Record<BillPostingStatus, BillPostingStatus[]> = {
  Draft: ["Submitted", "Cancelled"],
  Submitted: ["Approved", "Cancelled"],
  Approved: [],
  Posted: [],
  Cancelled: [],
};

export function canTransitionBillStatus(from: BillPostingStatus, to: BillPostingStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

async function requireBill(companyId: string, billId: number): Promise<ImportedBill> {
  const bill = await repo.getPurchaseBill(companyId, billId);
  if (!bill) throw new NotFoundError(`No bill with id ${billId}.`);
  return bill;
}

function requirePostingStatus(bill: ImportedBill): BillPostingStatus {
  if (bill.postingStatus === null) {
    throw new ValidationError(`${bill.invoiceNumber} was imported, not entered through Purchasing, and is not part of the posting workflow.`);
  }
  return bill.postingStatus;
}

export async function submitBill(companyId: string, billId: number): Promise<ImportedBill> {
  const bill = await requireBill(companyId, billId);
  const status = requirePostingStatus(bill);
  if (!canTransitionBillStatus(status, "Submitted")) {
    throw new ValidationError(`Cannot submit ${bill.invoiceNumber} from status ${status}.`);
  }
  return repo.submitBill(companyId, billId);
}

export async function cancelBill(companyId: string, billId: number): Promise<ImportedBill> {
  const bill = await requireBill(companyId, billId);
  const status = requirePostingStatus(bill);
  if (!canTransitionBillStatus(status, "Cancelled")) {
    throw new ValidationError(`Cannot cancel ${bill.invoiceNumber} from status ${status}.`);
  }
  return repo.cancelBill(companyId, billId);
}

/** A Bill/Debit Note whose Purchase Order carries real stock items
 * already had its Inventory value capitalized at Goods Received time
 * (DR Inventory / CR GRNI Clearing — see `goods-received-note-service.ts`).
 * Billing it must clear that GRNI liability, not re-expense the same
 * amount through 'Supplier Invoice' — that would double-count. A Credit
 * Note against a stock-carrying order still uses 'Supplier Credit Note'
 * (a narrower, disclosed simplification — see MIGRATION_ROADMAP.md). */
async function resolveBillEventType(companyId: string, bill: ImportedBill): Promise<string> {
  if (bill.documentType !== "Credit Note" && bill.purchaseOrderId !== null) {
    const order = await orderRepo.getPurchaseOrder(companyId, bill.purchaseOrderId);
    if (order?.lines.some((line) => line.stockItemId !== null)) return "Inventory Bill";
  }
  return EVENT_TYPE_BY_DOCUMENT[bill.documentType];
}

export function lineAmountFor(line: PurchaseBillLine, source: PostingRuleAmountSource): number {
  if (source === "net") return line.netAmount;
  if (source === "vat") return line.vatAmount;
  return line.lineTotal;
}

/** The multi-line counterpart to `buildJournalLinesFromRule`
 * (`posting-rule-service.ts`) — that function takes one `grossAmount`
 * and one variable-role account, which can't express "N lines, each
 * with its own GL account and possibly its own VAT rate." A rule
 * line with no `fixedAccountCode` (the "expense" role — DR Purchases,
 * in the seeded Supplier Invoice rule) expands into one journal line
 * per bill line, using that line's own GL account and its own
 * `amountSource` figure; every fixed-account role (VAT Input,
 * Creditors Control) aggregates across all lines instead of using one
 * blanket rate, since lines may carry different VAT codes. */
async function buildMultiLineBillJournal(companyId: string, lines: PurchaseBillLine[], eventType: string, description: string): Promise<BuildJournalLinesResult> {
  const rule = await postingRuleRepo.getPostingRuleByEventType(companyId, eventType);
  if (!rule) return { ok: false, reason: `No posting rule configured for event type "${eventType}".` };
  if (!rule.isActive) return { ok: false, reason: `Posting rule "${eventType}" is inactive.` };
  if (rule.lines.length === 0) return { ok: false, reason: `Posting rule "${eventType}" has no lines configured.` };

  const journalLines: NewJournalLine[] = [];
  for (const ruleLine of rule.lines) {
    if (ruleLine.fixedAccountCode === null) {
      for (const billLine of lines) {
        const amount = lineAmountFor(billLine, ruleLine.amountSource);
        if (amount === 0) continue;
        journalLines.push({
          accountCode: billLine.glAccount,
          debit: ruleLine.side === "Debit" ? amount : 0,
          credit: ruleLine.side === "Credit" ? amount : 0,
          description: billLine.description || description,
        });
      }
    } else {
      const amount = round2(lines.reduce((sum, l) => sum + lineAmountFor(l, ruleLine.amountSource), 0));
      if (amount === 0) continue;
      journalLines.push({
        accountCode: ruleLine.fixedAccountCode,
        debit: ruleLine.side === "Debit" ? amount : 0,
        credit: ruleLine.side === "Credit" ? amount : 0,
        description,
      });
    }
  }

  if (journalLines.length === 0) return { ok: false, reason: `Posting rule "${eventType}" produced no lines for this bill.` };

  const totalDebit = round2(journalLines.reduce((sum, l) => sum + l.debit, 0));
  const totalCredit = round2(journalLines.reduce((sum, l) => sum + l.credit, 0));
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    return { ok: false, reason: `Posting rule "${eventType}" produced an unbalanced journal (debit ${totalDebit} != credit ${totalCredit}).` };
  }

  return { ok: true, lines: journalLines };
}

/** Approve AND post in one call — same "automatic" pattern as
 * `sales-invoice-service.ts::approveAndPostInvoice`, including the
 * honest Approved-but-unposted fallback when the Posting Engine skips
 * the journal (e.g. a closed Financial Period). */
export async function approveAndPostBill(companyId: string, billId: number): Promise<ImportedBill> {
  const bill = await requireBill(companyId, billId);
  const status = requirePostingStatus(bill);
  if (!canTransitionBillStatus(status, "Approved")) {
    throw new ValidationError(`Cannot approve ${bill.invoiceNumber} from status ${status}.`);
  }

  const eventType = await resolveBillEventType(companyId, bill);
  const description = `${bill.documentType} ${bill.invoiceNumber} — ${bill.supplierName}`;
  const billLines = await repo.listPurchaseBillLines(companyId, billId);

  const built =
    billLines.length > 0
      ? await buildMultiLineBillJournal(companyId, billLines, eventType, description)
      : await buildJournalFromEvent(companyId, eventType, {
          grossAmount: bill.total,
          vatRatePercent: (await listVatTreatments(companyId)).find((t) => t.code === bill.vatCode)?.rate ?? 0,
          description,
        });
  if (!built.ok) {
    throw new ValidationError(`Could not generate a journal for ${bill.invoiceNumber}: ${built.reason}`);
  }

  const journal = await journalRepo.createJournal(companyId, {
    journalType: bill.documentType,
    description,
    reference: bill.invoiceNumber,
    sourceType: "purchase_bill",
    sourceId: bill.id,
    status: "Approved",
    lines: built.lines,
  });

  await repo.approveBill(companyId, billId, journal.id);

  const outcome = await postApprovedJournals(companyId);
  const wasPosted = outcome.posted.some((p) => p.journalId === journal.id);
  if (!wasPosted) {
    const skip = outcome.skipped.find((s) => s.journalId === journal.id);
    throw new ValidationError(
      `${bill.invoiceNumber} was approved but could not be posted${skip ? `: ${skip.reason}` : "."} It remains Approved.`,
    );
  }

  return repo.markBillPosted(companyId, billId);
}

/** Recovery path for the one real gap `approveAndPostBill` can leave
 * behind — mirrors `sales-invoice-service.ts::retryPostInvoice`. */
export async function retryPostBill(companyId: string, billId: number): Promise<ImportedBill> {
  const bill = await requireBill(companyId, billId);
  if (bill.postingStatus !== "Approved") {
    throw new ValidationError(`Only an Approved-but-unposted bill can retry posting (current status: ${bill.postingStatus ?? "not part of the posting workflow"}).`);
  }
  if (bill.journalId === null) throw new ValidationError(`${bill.invoiceNumber} has no linked journal to post.`);

  const outcome = await postApprovedJournals(companyId);
  const wasPosted = outcome.posted.some((p) => p.journalId === bill.journalId);
  if (!wasPosted) {
    const skip = outcome.skipped.find((s) => s.journalId === bill.journalId);
    throw new ValidationError(`${bill.invoiceNumber} still could not be posted${skip ? `: ${skip.reason}` : "."}`);
  }

  return repo.markBillPosted(companyId, billId);
}

/** Real Order -> Bill conversion — "Purchase Orders can be billed" per
 * the completion standard. Mirrors
 * `sales-invoice-service.ts::createInvoiceFromOrder`. Requires the order
 * fully `Received` first, marks every line fully billed, and moves the
 * order to `Billed`.
 *
 * Two paths, chosen automatically from what the order's own lines
 * carry — never a caller flag: when every line is dimensioned (a real
 * GL account and VAT code on each — the Purchase Orders multi-line
 * capture screen), the resulting Bill is built with the *same* lines,
 * same GL accounts, same VAT codes, same cost-centre/project/department
 * allocations, not collapsed into one number. An order with any
 * undimensioned line (captured before this existed, or a Requisition ->
 * Order conversion, which never carries GL/VAT) falls back to the
 * original single-subtotal behaviour, using the caller-supplied
 * `vatTreatmentCode` exactly as before. */
export async function createBillFromOrder(
  companyId: string,
  orderId: number,
  invoiceNumber: string,
  invoiceDate: string,
  vatTreatmentCode: string,
): Promise<ImportedBill> {
  const order = await orderRepo.getPurchaseOrder(companyId, orderId);
  if (!order) throw new NotFoundError(`No purchase order with id ${orderId}.`);
  if (order.status !== "Received") {
    throw new ValidationError(`Only a Received order can be billed (current status: ${order.status}).`);
  }

  const everyLineDimensioned = order.lines.every((l) => l.glAccount && l.vatCode);

  const bill = await createPurchaseBill(
    companyId,
    everyLineDimensioned
      ? {
          supplierId: order.supplierId,
          invoiceNumber,
          invoiceDate,
          purchaseOrderId: order.id,
          lines: order.lines.map((l) => ({
            description: l.description,
            glAccount: l.glAccount!,
            vatCode: l.vatCode!,
            costCentreId: l.costCentreId,
            projectId: l.projectId,
            departmentId: l.departmentId,
            quantity: l.quantity,
            unitCost: l.unitPrice,
            discount: l.discount,
          })),
        }
      : {
          supplierId: order.supplierId,
          invoiceNumber,
          invoiceDate,
          vatTreatmentCode,
          subtotal: round2(order.lines.reduce((sum, l) => sum + l.lineTotal, 0)),
          purchaseOrderId: order.id,
        },
  );

  for (const line of order.lines) {
    await orderRepo.incrementOrderLineQuantity(line.id, "billed_quantity", line.quantity);
  }
  await orderRepo.setOrderStatus(companyId, orderId, "Billed");

  return bill;
}
