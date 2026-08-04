/**
 * Adapter that turns real Sales Invoices/Credit Notes and Supplier
 * Bills/Credit Notes into the generic `VatDocument` shape VAT
 * Intelligence and the VAT Rule Engine evaluate — no new VAT-bearing
 * business object is introduced; this only reshapes what Sales/
 * Purchasing already persist.
 */

import { listSalesInvoices } from "@/server/services/sales-invoice-service";
import { listAllBills } from "@/server/services/purchase-bill-service";
import { listCustomers } from "@/server/services/customer-service";
import { listSuppliers } from "@/server/services/supplier-management-service";
import { listVatTreatments } from "@/server/services/vat-treatment-service";
import type { VatDocument } from "@/server/vat/vat-intelligence";

export async function listVatDocuments(companyId: string): Promise<VatDocument[]> {
  const [invoices, bills, customers, suppliers, treatments] = await Promise.all([
    listSalesInvoices(companyId),
    listAllBills(companyId),
    listCustomers(companyId),
    listSuppliers(companyId),
    listVatTreatments(companyId),
  ]);

  const customerNameById = new Map(customers.map((c) => [c.id, c.name]));
  const supplierVatNumberById = new Map(suppliers.map((s) => [s.id, s.vatNumber || null]));
  const vatTypeByCode = new Map(treatments.map((t) => [t.code, t.vatType]));

  const invoiceDocuments: VatDocument[] = invoices.map((inv) => ({
    id: inv.id,
    documentType: inv.documentType === "Credit Note" ? "Customer Credit Note" : "Customer Invoice",
    partyId: inv.customerId,
    partyName: customerNameById.get(inv.customerId) ?? `Customer #${inv.customerId}`,
    partyVatNumber: null,
    date: inv.invoiceDate,
    vatTreatmentCode: inv.vatTreatmentCode,
    vatType: vatTypeByCode.get(inv.vatTreatmentCode) ?? null,
    grossAmount: inv.total,
    vatAmount: inv.vatAmount,
  }));

  const billDocuments: VatDocument[] = bills
    .filter((b) => b.invoiceDate !== null)
    .map((bill) => ({
      id: bill.id,
      documentType: bill.documentType === "Credit Note" ? "Supplier Credit Note" : "Supplier Bill",
      partyId: bill.supplierId,
      partyName: bill.supplierName,
      partyVatNumber: bill.supplierId !== null ? (supplierVatNumberById.get(bill.supplierId) ?? null) : null,
      date: bill.invoiceDate as string,
      vatTreatmentCode: bill.vatCode ?? "",
      vatType: bill.vatCode ? (vatTypeByCode.get(bill.vatCode) ?? null) : null,
      grossAmount: bill.total,
      vatAmount: bill.vat,
    }));

  return [...invoiceDocuments, ...billDocuments];
}
