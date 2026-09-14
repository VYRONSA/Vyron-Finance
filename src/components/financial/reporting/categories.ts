import type { ComponentType } from "react";
import { IconArchive, IconBank, IconBanknote, IconBarChart, IconBookOpen, IconBuilding, IconFileText, IconReceipt, IconShieldCheck, IconSliders, IconSparkles, IconUsers } from "@/components/ui/icons";
import { CATEGORY_LABEL, type ReportCategory } from "@/server/report-centre/types";

export const CATEGORY_INFO: Record<ReportCategory, { label: string; description: string; icon: ComponentType<{ className?: string }> }> = {
  management: { label: CATEGORY_LABEL.management, description: "The owner's pack — performance vs prior periods and budget, cash, receivables, payables, VAT, top customers and suppliers.", icon: IconSparkles },
  financial: { label: CATEGORY_LABEL.financial, description: "Statement of Financial Position, Profit & Loss in every form, Budget vs Actual and Cash Flow — reconciled to the General Ledger.", icon: IconBarChart },
  customers: { label: CATEGORY_LABEL.customers, description: "Ledgers, statements, aging and balances reconciled to Debtors, plus sales, payments and VAT by customer.", icon: IconBuilding },
  suppliers: { label: CATEGORY_LABEL.suppliers, description: "Ledgers, statements, aging and balances reconciled to Creditors, plus purchases, payments and spend by supplier.", icon: IconUsers },
  sales: { label: CATEGORY_LABEL.sales, description: "Sales by customer, product, date, month, category and VAT treatment; registers, trends and gross margin.", icon: IconBanknote },
  purchasing: { label: CATEGORY_LABEL.purchasing, description: "Purchases by supplier, product and period; bill and credit note registers; supplier spend and cost trends.", icon: IconArchive },
  banking: { label: CATEGORY_LABEL.banking, description: "Bank transactions, ledger and reconciliations; deposits, payments, charges and interest; import audits and the transaction lifecycle.", icon: IconBank },
  vat: { label: CATEGORY_LABEL.vat, description: "VAT summary and detail, input and output VAT, VAT by account, customer and supplier, reconciled to the VAT accounts.", icon: IconReceipt },
  "general-ledger": { label: CATEGORY_LABEL["general-ledger"], description: "Trial Balance in every form, General Ledger, account activity and balances, journals and allocation history.", icon: IconBookOpen },
  inventory: { label: CATEGORY_LABEL.inventory, description: "Stock on hand, stock valuation reconciled to the inventory accounts, and stock movements.", icon: IconSliders },
  audit: { label: CATEGORY_LABEL.audit, description: "Audit trail, journal registers, allocation history, import and Xero audits, duplicates and VAT audit.", icon: IconShieldCheck },
  documents: { label: CATEGORY_LABEL.documents, description: "Re-open, print and download any quote, order, invoice, credit note, receipt, purchase order, bill, remittance or statement.", icon: IconFileText },
};
