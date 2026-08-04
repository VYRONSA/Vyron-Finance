/**
 * Service layer for Recurring Documents — validation, and the
 * generation dispatcher that turns a due template into a real business
 * object by calling the SAME already-shipped service every manually-
 * created document of that type uses. No parallel document-creation
 * logic is introduced anywhere in this file.
 *
 * `document_payload` carries the reusable create-input per
 * `documentType` — reconstructed into the real service's own input type
 * on every run, with today's date substituted in and the template's
 * `numberingPrefix` applied where that service supports an explicit
 * number.
 */

import * as repo from "@/server/repositories/recurring-template-repository";
import * as workflowService from "@/server/services/workflow-service";
import * as auditService from "@/server/services/automation-audit-service";
import * as notificationService from "@/server/services/notification-service";
import * as communicationService from "@/server/services/communication-service";
import { checkOccurrenceDue, computeNextRunDate, type RecurrenceRule } from "@/server/automation/recurrence";
import { RECURRING_DOCUMENT_LABELS, RECURRING_DOCUMENT_TYPES, type GeneratedDocument, type RecurringTemplate } from "@/server/automation/types";

import { createSalesInvoice, approveAndPostInvoice } from "@/server/services/sales-invoice-service";
import { createPurchaseBill, approveAndPostBill } from "@/server/services/purchase-bill-service";
import * as journalRepo from "@/server/repositories/journal-repository";
import { postApprovedJournals } from "@/server/services/posting-engine-service";
import { createAndAutoPost as createInventoryAdjustment } from "@/server/services/inventory-transaction-service";
import { createSalesOrder } from "@/server/repositories/sales-order-repository";
import { createPurchaseOrder } from "@/server/repositories/purchase-order-repository";
import { getCustomerFinancialSummary } from "@/server/services/customer-financial-service";
import { getSupplierFinancialSummary } from "@/server/services/supplier-financial-service";
import { getCustomer, listCustomerContacts } from "@/server/repositories/customer-repository";
import { getSupplier } from "@/server/repositories/supplier-reconciliation-repository";
import { listSupplierContacts } from "@/server/repositories/supplier-management-repository";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

export const listRecurringTemplates = repo.listRecurringTemplates;
export const getRecurringTemplate = repo.getRecurringTemplate;
export const listGeneratedDocuments = repo.listGeneratedDocuments;

function toRecurrenceRule(template: Pick<RecurringTemplate, "frequency" | "intervalCount" | "skipWeekends" | "skipPublicHolidays">): RecurrenceRule {
  return {
    frequency: template.frequency,
    intervalCount: template.intervalCount,
    skipWeekends: template.skipWeekends,
    // No public holiday calendar source exists yet in this codebase —
    // see the migration's own comment. Real flag, empty set for now.
    publicHolidays: [],
  };
}

/** Pure, given the template's own fields — the "Preview Next Execution"
 * requirement. */
export function previewNextExecution(template: Pick<RecurringTemplate, "nextRunDate" | "frequency" | "intervalCount" | "skipWeekends" | "skipPublicHolidays">): string {
  return computeNextRunDate(template.nextRunDate, toRecurrenceRule(template));
}

export async function createRecurringTemplate(companyId: string, input: repo.NewRecurringTemplate): Promise<RecurringTemplate> {
  if (!RECURRING_DOCUMENT_TYPES.includes(input.documentType)) throw new ValidationError(`Invalid document type "${input.documentType}".`);
  if (!input.name?.trim()) throw new ValidationError("Template name is required.");
  if (!input.startDate) throw new ValidationError("Start date is required.");
  return repo.createRecurringTemplate(companyId, { ...input, name: input.name.trim() });
}

export const updateRecurringTemplate = repo.updateRecurringTemplate;

export const pauseRecurringTemplate = (companyId: string, templateId: number, performedBy: string) =>
  repo.updateRecurringTemplate(companyId, templateId, { is_active: false }, performedBy);
export const resumeRecurringTemplate = (companyId: string, templateId: number, performedBy: string) =>
  repo.updateRecurringTemplate(companyId, templateId, { is_active: true }, performedBy);

export type GenerationOutcome = { status: "Success" | "Failed" | "Skipped"; reason?: string; document: GeneratedDocument | null };

/** The one real generation dispatcher — every document type reuses an
 * already-shipped, already-tested create (and where the document type
 * naturally posts, approve+post) service. Never throws for a single
 * template's own business-rule failure (e.g. a stale customerId) — that
 * becomes a `Failed` `generated_documents` row plus an
 * `AutomationFailure` notification and audit entry, not an aborted run. */
export async function generateFromTemplate(companyId: string, template: RecurringTemplate, todayIso: string, performedBy = "System"): Promise<GenerationOutcome> {
  const due = checkOccurrenceDue(template.nextRunDate, todayIso, template.endDate, template.maxOccurrences, template.occurrencesGenerated, template.isActive);
  if (!due.isDue) return { status: "Skipped", reason: due.reason ?? undefined, document: null };

  const start = performance.now();

  try {
    const outcome = await dispatchGeneration(companyId, template, todayIso, performedBy);
    const document = await repo.recordGeneratedDocument(companyId, {
      recurringTemplateId: template.id,
      documentType: template.documentType,
      referenceType: outcome.referenceType,
      referenceId: outcome.referenceId,
      status: "Success",
      summary: outcome.summary,
    });

    await auditService.recordAuditEntry(companyId, {
      performedBy,
      actionType: `RecurringGeneration:${template.documentType}`,
      reason: `Scheduled occurrence of "${template.name}".`,
      changes: { summary: outcome.summary },
      journalIds: outcome.journalId ? [outcome.journalId] : [],
      documentType: outcome.referenceType,
      documentId: outcome.referenceId,
      durationMs: Math.round(performance.now() - start),
      isReversible: false,
    });

    const nextRunDate = computeNextRunDate(template.nextRunDate, toRecurrenceRule(template));
    await repo.advanceRecurringTemplate(companyId, template.id, todayIso, nextRunDate);

    return { status: "Success", document };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error.";
    const document = await repo.recordGeneratedDocument(companyId, {
      recurringTemplateId: template.id,
      documentType: template.documentType,
      status: "Failed",
      errorMessage,
    });
    await notificationService.createNotification(companyId, {
      notificationType: "AutomationFailure",
      title: `Recurring template "${template.name}" failed to generate`,
      message: errorMessage,
      severity: "critical",
      relatedType: "RecurringTemplate",
      relatedId: template.id,
    });
    const nextRunDate = computeNextRunDate(template.nextRunDate, toRecurrenceRule(template));
    await repo.advanceRecurringTemplate(companyId, template.id, todayIso, nextRunDate);
    return { status: "Failed", reason: errorMessage, document };
  }
}

type DispatchOutcome = { referenceType: string; referenceId: number | null; journalId?: number | null; summary: string };

async function dispatchGeneration(companyId: string, template: RecurringTemplate, todayIso: string, performedBy: string): Promise<DispatchOutcome> {
  const payload = template.documentPayload;
  const numbered = (n: number) => (template.numberingPrefix ? `${template.numberingPrefix}${n}` : undefined);

  switch (template.documentType) {
    case "CustomerInvoice": {
      const p = payload as { customerId: number; vatTreatmentCode: string; lines: { description: string; quantity: number; unitPrice: number; stockItemId?: number | null }[]; notes?: string };
      const invoice = await createSalesInvoice(companyId, {
        customerId: p.customerId,
        invoiceDate: todayIso,
        vatTreatmentCode: p.vatTreatmentCode,
        lines: p.lines,
        notes: p.notes,
      });
      const posted = await approveAndPostInvoice(companyId, invoice.id);
      return { referenceType: "SalesInvoice", referenceId: posted.id, journalId: posted.journalId, summary: `Invoice ${posted.invoiceNumber} for ${posted.total.toFixed(2)}` };
    }

    case "SupplierBill": {
      const p = payload as { supplierId: number; vatTreatmentCode: string; subtotal: number; glAccount?: string | null; invoiceNumber?: string };
      const bill = await createPurchaseBill(companyId, {
        supplierId: p.supplierId,
        invoiceNumber: numbered(template.occurrencesGenerated + 1) ?? `${p.invoiceNumber ?? "AUTO"}-${todayIso}`,
        invoiceDate: todayIso,
        vatTreatmentCode: p.vatTreatmentCode,
        subtotal: p.subtotal,
        glAccount: p.glAccount ?? null,
      });
      const posted = await approveAndPostBill(companyId, bill.id);
      return { referenceType: "SupplierBill", referenceId: posted.id, journalId: posted.journalId, summary: `Bill ${posted.invoiceNumber} for ${posted.total.toFixed(2)}` };
    }

    case "Journal": {
      const p = payload as { journalType: string; description: string; lines: { accountCode: string; debit: number; credit: number; description?: string }[] };
      const journal = await journalRepo.createJournal(companyId, {
        journalType: p.journalType,
        description: `${p.description} (recurring: ${template.name})`,
        reference: template.name,
        sourceType: "recurring_template",
        sourceId: template.id,
        status: "Approved",
        lines: p.lines.map((l) => ({ accountCode: l.accountCode, debit: l.debit, credit: l.credit, description: l.description ?? p.description })),
      });
      const outcome = await postApprovedJournals(companyId);
      const wasPosted = outcome.posted.some((j) => j.journalId === journal.id);
      return { referenceType: "Journal", referenceId: journal.id, journalId: wasPosted ? journal.id : null, summary: `Journal ${journal.journalNumber}${wasPosted ? " posted" : " approved, awaiting posting"}` };
    }

    case "InventoryAdjustment": {
      const p = payload as { warehouseId: number; direction: "Increase" | "Decrease"; lines: { stockItemId: number; quantity: number; unitCost?: number }[]; notes?: string };
      const transaction = await createInventoryAdjustment(companyId, "Adjustment", {
        transactionDate: todayIso,
        warehouseId: p.warehouseId,
        direction: p.direction,
        notes: p.notes ?? `Recurring: ${template.name}`,
        sourceType: "recurring_template",
        sourceId: template.id,
        lines: p.lines,
      });
      return { referenceType: "InventoryTransaction", referenceId: transaction.id, journalId: transaction.journalId, summary: `${transaction.transactionNumber} (${p.direction})` };
    }

    case "PurchaseOrder": {
      const p = payload as { supplierId: number; lines: { description: string; quantity: number; unitPrice: number; stockItemId?: number | null }[]; notes?: string };
      const order = await createPurchaseOrder(companyId, { supplierId: p.supplierId, orderDate: todayIso, notes: p.notes, lines: p.lines });
      return { referenceType: "PurchaseOrder", referenceId: order.id, summary: `Order ${order.orderNumber}` };
    }

    case "SalesOrder": {
      const p = payload as { customerId: number; lines: { description: string; quantity: number; unitPrice: number; stockItemId?: number | null }[]; notes?: string };
      const order = await createSalesOrder(companyId, { customerId: p.customerId, orderDate: todayIso, notes: p.notes, lines: p.lines });
      return { referenceType: "SalesOrder", referenceId: order.id, summary: `Order ${order.orderNumber}` };
    }

    case "CustomerStatement": {
      const p = payload as { customerId: number };
      const customer = await getCustomer(companyId, p.customerId);
      if (!customer) throw new ValidationError(`No customer with id ${p.customerId}.`);
      const summary = await getCustomerFinancialSummary(companyId, customer);
      const overdue = summary.aging.days30 + summary.aging.days60 + summary.aging.days90 + summary.aging.days120Plus;
      const contacts = await listCustomerContacts(customer.id);
      const contact = contacts.find((c) => c.isPrimary) ?? contacts[0];
      // Real, queued, tracked send through the ONE Communication Platform
      // — never a direct/parallel email path. Honestly `Failed` (no
      // provider configured) until a real EmailSender is plugged in;
      // "CustomerStatement" requires approval before it ever leaves the
      // queue, per the RC1 directive's own approval examples.
      const communication = await communicationService.queueCommunication(companyId, {
        module: "Sales",
        businessObjectType: "Customer",
        businessObjectId: customer.id,
        channel: "Email",
        templateCode: "CustomerStatement",
        recipients: [{ type: "Customer", id: customer.id, name: customer.name, address: contact?.email || null }],
        variables: { customerName: customer.name, outstandingBalance: summary.outstandingBalance.toFixed(2), overdueAmount: overdue.toFixed(2) },
        createdBy: performedBy,
      });
      return {
        referenceType: "Communication",
        referenceId: communication.id,
        summary: `Statement queued for ${customer.name}: outstanding ${summary.outstandingBalance.toFixed(2)}, overdue ${overdue.toFixed(2)}`,
      };
    }

    case "SupplierStatement": {
      const p = payload as { supplierId: number };
      const supplier = await getSupplier(companyId, p.supplierId);
      if (!supplier) throw new ValidationError(`No supplier with id ${p.supplierId}.`);
      const summary = await getSupplierFinancialSummary(companyId, p.supplierId, todayIso);
      const contacts = await listSupplierContacts(supplier.id);
      const contact = contacts.find((c) => c.isPrimary) ?? contacts[0];
      const communication = await communicationService.queueCommunication(companyId, {
        module: "Purchasing",
        businessObjectType: "Supplier",
        businessObjectId: supplier.id,
        channel: "Email",
        templateCode: "SupplierStatement",
        recipients: [{ type: "Supplier", id: supplier.id, name: supplier.name, address: contact?.email || null }],
        variables: { supplierName: supplier.name, outstandingBalance: summary.outstandingBalance.toFixed(2) },
        createdBy: performedBy,
      });
      return {
        referenceType: "Communication",
        referenceId: communication.id,
        summary: `Statement queued for ${supplier.name}: outstanding ${summary.outstandingBalance.toFixed(2)}`,
      };
    }

    case "ReminderEmail":
    case "PaymentReminder": {
      const p = payload as { recipientType: "Customer" | "Supplier"; recipientId: number; message?: string };
      const recipient = p.recipientType === "Customer" ? await getCustomer(companyId, p.recipientId) : await getSupplier(companyId, p.recipientId);
      const label = recipient?.name;
      const contact = p.recipientType === "Customer"
        ? (await listCustomerContacts(p.recipientId)).find((c) => c.isPrimary) ?? (await listCustomerContacts(p.recipientId))[0]
        : (await listSupplierContacts(p.recipientId)).find((c) => c.isPrimary) ?? (await listSupplierContacts(p.recipientId))[0];
      // Real, queued, tracked send through the ONE Communication Platform.
      // Previously this created only an in-app Notification Centre entry
      // (no email provider is connected anywhere in this codebase) — the
      // Email attempt now genuinely exists, tracked, retryable, and
      // approval-gated ("Large debtor reminders" per the directive's own
      // approval examples); it stays honestly `Failed` until a real
      // EmailSender is plugged in, never a fabricated "sent" claim.
      const communication = await communicationService.queueCommunication(companyId, {
        module: p.recipientType === "Customer" ? "Sales" : "Purchasing",
        businessObjectType: p.recipientType,
        businessObjectId: p.recipientId,
        channel: "Email",
        templateCode: "PaymentReminder",
        recipients: [{ type: p.recipientType, id: p.recipientId, name: label ?? `${p.recipientType} #${p.recipientId}`, address: contact?.email || null }],
        variables: { recipientName: label ?? `${p.recipientType} #${p.recipientId}`, message: p.message ?? "" },
        createdBy: performedBy,
      });
      return { referenceType: "Communication", referenceId: communication.id, summary: `${RECURRING_DOCUMENT_LABELS[template.documentType]} queued for ${label ?? p.recipientId}` };
    }
  }
}

/** Optionally requires an approval workflow before a NEW template is
 * ever activated — the one real caller of the Workflow Engine this pass
 * wires end-to-end. Only runs when the template was created with a
 * `workflowDefinitionId`; every other template activates immediately, as
 * before. */
export async function requestActivationApproval(companyId: string, templateId: number, performedBy: string) {
  const template = await repo.getRecurringTemplate(companyId, templateId);
  if (!template) throw new NotFoundError(`No recurring template with id ${templateId}.`);
  if (!template.workflowDefinitionId) throw new ValidationError("This template has no workflow attached.");
  const instance = await workflowService.startWorkflow(companyId, template.workflowDefinitionId, "RecurringTemplate", template.id);
  await notificationService.createNotification(companyId, {
    notificationType: "ApprovalRequest",
    title: `Approval requested: activate "${template.name}"`,
    severity: "warning",
    relatedType: "RecurringTemplate",
    relatedId: template.id,
  });
  void performedBy;
  return instance;
}
