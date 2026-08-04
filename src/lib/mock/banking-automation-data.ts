/**
 * Preview Mode seed data for Banking Automation & Rule Intelligence
 * (Migration Roadmap Module 6). Field shapes match the real domain types
 * exactly, and beneficiaries/references deliberately line up with
 * `transaction-explorer-data.ts`'s own `MOCK_TRANSACTIONS` so Preview
 * Mode tells one coherent story across both modules.
 */

import type { BankingException, BankingRule, Merchant } from "@/server/banking-rules/types";
import { MOCK_COMPANY } from "./financial-data";

const COMPANY_ID = MOCK_COMPANY.id;

export const MOCK_MERCHANTS: Merchant[] = [
  {
    id: 1, companyId: COMPANY_ID, name: "Fenwick Office Supplies", aliases: ["Fenwick Supplies"],
    defaultSupplierId: 1, defaultCustomerId: null, defaultGlAccount: "6100 — Office Supplies", defaultVatCode: "Standard",
    notes: "", createdAt: "2026-06-01T09:00:00Z", updatedAt: "2026-06-01T09:00:00Z",
  },
  {
    id: 2, companyId: COMPANY_ID, name: "Netherfield Freight Ltd", aliases: [],
    defaultSupplierId: 2, defaultCustomerId: null, defaultGlAccount: "6200 — Distribution", defaultVatCode: "Standard",
    notes: "", createdAt: "2026-06-01T09:00:00Z", updatedAt: "2026-06-01T09:00:00Z",
  },
  {
    id: 3, companyId: COMPANY_ID, name: "Card Settlement", aliases: ["Till Settlement"],
    defaultSupplierId: null, defaultCustomerId: null, defaultGlAccount: "", defaultVatCode: "",
    notes: "Card acquirer batch settlement — never has its own supplier account.", createdAt: "2026-06-05T09:00:00Z", updatedAt: "2026-06-05T09:00:00Z",
  },
];

export const MOCK_BANKING_RULES: BankingRule[] = [
  {
    id: 1, companyId: COMPANY_ID, domain: "Banking", ruleType: "Supplier", name: "Fenwick -> Supplier", description: "Recognise Fenwick Office Supplies payments.",
    priority: 100, isActive: true, version: 2, createdAt: "2026-06-01T09:00:00Z", updatedAt: "2026-07-10T09:00:00Z", createdBy: "System", updatedBy: "T. Naidoo",
    conditions: [{ id: 1, field: "beneficiary", operator: "contains", value: "fenwick", value2: null }],
    actions: [{ id: 1, actionType: "set_supplier", targetId: 1, targetText: null }],
  },
  {
    id: 2, companyId: COMPANY_ID, domain: "Banking", ruleType: "GL", name: "Freight -> Distribution", description: "Netherfield Freight always posts to Distribution.",
    priority: 100, isActive: true, version: 1, createdAt: "2026-06-01T09:00:00Z", updatedAt: "2026-06-01T09:00:00Z", createdBy: "System", updatedBy: "System",
    conditions: [{ id: 2, field: "beneficiary", operator: "contains", value: "netherfield", value2: null }],
    actions: [{ id: 2, actionType: "set_gl_account", targetId: null, targetText: "6200 — Distribution" }],
  },
  {
    id: 3, companyId: COMPANY_ID, domain: "Banking", ruleType: "BankFee", name: "Card settlement fees", description: "Resolves to the same account the existing 'Bank Charges' posting rule uses — no new posting rule created.",
    priority: 100, isActive: true, version: 1, createdAt: "2026-06-05T09:00:00Z", updatedAt: "2026-06-05T09:00:00Z", createdBy: "System", updatedBy: "System",
    conditions: [{ id: 3, field: "beneficiary", operator: "equals", value: "card settlement", value2: null }],
    actions: [{ id: 3, actionType: "set_gl_account", targetId: null, targetText: "6100 — Bank Charges" }],
  },
  {
    id: 4, companyId: COMPANY_ID, domain: "Banking", ruleType: "Payroll", name: "Staff Payroll recognition", description: "Flags payroll runs for review rather than auto-posting — no Payroll ledger exists yet to post against.",
    priority: 100, isActive: true, version: 1, createdAt: "2026-06-10T09:00:00Z", updatedAt: "2026-06-10T09:00:00Z", createdBy: "System", updatedBy: "System",
    conditions: [{ id: 4, field: "beneficiary", operator: "contains", value: "staff payroll", value2: null }],
    actions: [{ id: 4, actionType: "flag_for_review", targetId: null, targetText: "MissingInvoice" }],
  },
];

export const MOCK_BANKING_EXCEPTIONS: BankingException[] = [
  {
    id: 1, companyId: COMPANY_ID, bankTransactionId: 497, exceptionType: "UnknownMerchant",
    reason: "No banking rule matched, and no supplier/customer has been identified for \"REF 88213 EFT\".",
    evidence: "Beneficiary: REF 88213 EFT; Description: Unknown EFT; Amount: 610.00.",
    recommendedAction: "Assign a Merchant, Supplier, or Customer, or create a rule that recognises this beneficiary.",
    status: "Open", resolvedBy: null, resolvedAt: null, resolutionNote: null, createdAt: "2026-07-29T14:35:00Z",
  },
  {
    id: 2, companyId: COMPANY_ID, bankTransactionId: 496, exceptionType: "PossibleDuplicate",
    reason: "Possible duplicate: two payments of 4200.00 to Netherfield Freight Ltd within 3 days.",
    evidence: "Transactions 496 and 500 share the same beneficiary, amount, and direction, dated within 3 day(s) of each other.",
    recommendedAction: "Confirm both payments were genuinely separate before allocating either.",
    status: "Open", resolvedBy: null, resolvedAt: null, resolutionNote: null, createdAt: "2026-07-29T14:35:00Z",
  },
  {
    id: 3, companyId: COMPANY_ID, bankTransactionId: 494, exceptionType: "MissingSupplier",
    reason: "\"Unregistered Cleaning Co\" has no matching supplier on file.",
    evidence: "Beneficiary: Unregistered Cleaning Co; Description: Monthly cleaning; Amount: 1850.00.",
    recommendedAction: "Create a supplier record for this beneficiary, or assign an existing one manually.",
    status: "Resolved", resolvedBy: "T. Naidoo", resolvedAt: "2026-07-30T08:00:00Z", resolutionNote: "Added as a one-off — not a registered supplier, coded directly to Cleaning Expenses.", createdAt: "2026-07-29T14:35:00Z",
  },
];
