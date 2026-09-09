/**
 * Row <-> domain type mappers for the Matching Platform (Module 14). See
 * supabase/migrations/0023_matching_platform.sql.
 */

import type { BankTransactionSplit, MatchingOverride, MerchantMerge, PartyMerge } from "./types";

export type BankTransactionSplitRow = {
  id: number;
  bank_transaction_id: number;
  company_id: string;
  line_order: number;
  amount: number;
  description: string;
  gl_account: string;
  vat_code: string;
  supplier_id: number | null;
  customer_id: number | null;
  project_id: number | null;
  cost_centre_id: number | null;
  department_id: number | null;
  branch_id: number | null;
  inventory_item_id: number | null;
  created_at: string;
};

export function bankTransactionSplitFromRow(row: BankTransactionSplitRow): BankTransactionSplit {
  return {
    id: row.id,
    bankTransactionId: row.bank_transaction_id,
    companyId: row.company_id,
    lineOrder: row.line_order,
    amount: Number(row.amount),
    description: row.description,
    glAccount: row.gl_account,
    vatCode: row.vat_code,
    supplierId: row.supplier_id,
    customerId: row.customer_id,
    projectId: row.project_id,
    costCentreId: row.cost_centre_id,
    departmentId: row.department_id,
    branchId: row.branch_id,
    inventoryItemId: row.inventory_item_id,
    createdAt: row.created_at,
  };
}

export type MerchantMergeRow = {
  id: number;
  company_id: string;
  surviving_merchant_id: number;
  merged_merchant_id: number;
  merged_merchant_name: string;
  transactions_repointed: number;
  performed_by: string;
  performed_at: string;
};

export function merchantMergeFromRow(row: MerchantMergeRow): MerchantMerge {
  return {
    id: row.id,
    companyId: row.company_id,
    survivingMerchantId: row.surviving_merchant_id,
    mergedMerchantId: row.merged_merchant_id,
    mergedMerchantName: row.merged_merchant_name,
    transactionsRepointed: row.transactions_repointed,
    performedBy: row.performed_by,
    performedAt: row.performed_at,
  };
}

export type PartyMergeRow = {
  id: number;
  company_id: string;
  party_type: string;
  surviving_party_id: number;
  merged_party_id: number;
  merged_party_name: string;
  performed_by: string;
  performed_at: string;
};

export function partyMergeFromRow(row: PartyMergeRow): PartyMerge {
  return {
    id: row.id,
    companyId: row.company_id,
    partyType: row.party_type as PartyMerge["partyType"],
    survivingPartyId: row.surviving_party_id,
    mergedPartyId: row.merged_party_id,
    mergedPartyName: row.merged_party_name,
    performedBy: row.performed_by,
    performedAt: row.performed_at,
  };
}

export type MatchingOverrideRow = {
  id: number;
  company_id: string;
  item_type: string;
  item_id: number;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  reason: string;
  performed_by: string;
  performed_at: string;
};

export function matchingOverrideFromRow(row: MatchingOverrideRow): MatchingOverride {
  return {
    id: row.id,
    companyId: row.company_id,
    itemType: row.item_type,
    itemId: row.item_id,
    fieldName: row.field_name,
    oldValue: row.old_value,
    newValue: row.new_value,
    reason: row.reason,
    performedBy: row.performed_by,
    performedAt: row.performed_at,
  };
}
