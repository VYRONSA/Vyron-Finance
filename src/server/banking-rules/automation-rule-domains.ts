/**
 * Per-domain vocabularies for the platform's ONE Rule Engine — Banking
 * got 12 explicitly PRB-named rule types with a rich condition field set
 * (see `types.ts`); every other domain the Recurring Transactions &
 * Autonomous Automation Platform (Module 7) added only got a domain NAME
 * from the PRB's brief, not a list of sub-types, so each gets exactly one
 * generic rule type, mirrored at the same granularity the brief actually
 * specified rather than inventing unrequested detail.
 */

import { BANKING_RULE_TYPES, CONDITION_FIELDS as BANKING_CONDITION_FIELDS, ACTION_TYPES as BANKING_ACTION_TYPES, type RuleDomain } from "./types";

export const DOMAIN_RULE_TYPES: Record<RuleDomain, string[]> = {
  Banking: BANKING_RULE_TYPES,
  Sales: ["SalesAutomation"],
  Purchasing: ["PurchasingAutomation"],
  Inventory: ["InventoryAutomation"],
  GeneralLedger: ["GeneralLedgerAutomation"],
  VAT: ["VatAutomation"],
  Reporting: ["ReportingAutomation"],
  CustomerCommunications: ["CustomerCommunicationAutomation"],
  SupplierCommunications: ["SupplierCommunicationAutomation"],
};

/** One evaluable record shape per domain — every field a rule authored
 * in that domain can reference. Populated as each domain wires a real
 * evaluator against the Rule Engine (see "Deliberately out of scope" in
 * `docs/MIGRATION_ROADMAP.md` for which domains have a real evaluator vs.
 * schema+UI only so far). */
export const DOMAIN_CONDITION_FIELDS: Record<RuleDomain, string[]> = {
  Banking: BANKING_CONDITION_FIELDS,
  Sales: ["customerId", "totalAmount", "daysOverdue", "documentType", "status"],
  Purchasing: ["supplierId", "totalAmount", "daysOverdue", "documentType", "status"],
  Inventory: ["stockItemId", "quantityOnHand", "reorderLevel", "warehouseId"],
  GeneralLedger: ["accountCode", "amount", "journalType"],
  VAT: ["vatCode", "amount", "documentType"],
  Reporting: ["reportType"],
  CustomerCommunications: ["customerId", "daysOverdue", "documentType"],
  SupplierCommunications: ["supplierId", "daysOverdue", "documentType"],
};

export const DOMAIN_ACTION_TYPES: Record<RuleDomain, string[]> = {
  Banking: BANKING_ACTION_TYPES,
  Sales: ["flag_for_review", "create_reminder"],
  Purchasing: ["flag_for_review", "create_reminder"],
  Inventory: ["flag_for_review", "create_reminder"],
  GeneralLedger: ["flag_for_review"],
  VAT: ["flag_for_review"],
  Reporting: ["flag_for_review"],
  CustomerCommunications: ["create_reminder"],
  SupplierCommunications: ["create_reminder"],
};
